import { createInterface } from "node:readline";
import { EventBus } from "./runtime/events/EventBus.js";
import { SessionManager, type Session } from "./runtime/session/SessionManager.js";
import { DEFAULT_LIMITS, type SessionLimits } from "./runtime/session/Limits.js";
import { ToolRegistry } from "./tools/registry/ToolRegistry.js";
import { registerBuiltinTools } from "./tools/index.js";
import { ToolExecutor, type ToolResult } from "./runtime/executor/ToolExecutor.js";
import type { ToolDefinition } from "./tools/registry/ToolDefinition.js";
import type { Trace } from "./telemetry/tracing/Trace.js";
import { OllamaProvider } from "./llm/ollama/OllamaProvider.js";
import { SYSTEM_PROMPT } from "./llm/prompts/system.js";
import { IntentProcessor } from "./runtime/intent/IntentProcessor.js";
import { Planner } from "./runtime/planner/Planner.js";
import { ObservationManager, type Observation } from "./runtime/observation/ObservationManager.js";
import { GoalEvaluator } from "./runtime/evaluator/GoalEvaluator.js";
import { ConversationManager } from "./runtime/conversation/ConversationManager.js";
import { PolicyEngine } from "./runtime/policy/PolicyEngine.js";
import { InterruptManager } from "./runtime/interrupt/InterruptManager.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:30b-a3b-instruct-2507-q4_K_M";

const events = new EventBus();
const sessions = new SessionManager(events);
const registry = new ToolRegistry();
registerBuiltinTools(registry);

const llm = new OllamaProvider({ host: OLLAMA_HOST, model: OLLAMA_MODEL });
const intentProcessor = new IntentProcessor(llm);
const planner = new Planner(llm);
const observationManager = new ObservationManager();
const evaluator = new GoalEvaluator(llm);
const conversation = new ConversationManager();
const policyEngine = new PolicyEngine();

events.on("*", (event) => {
  if (process.env.AYMI_DEBUG_EVENTS) {
    console.log(`  [event] ${event.name}`, JSON.stringify(event.data));
  }
});

/**
 * Section 12 - a timeout (UNKNOWN) is not a failure. For idempotent tools
 * it's safe to retry automatically, bounded by the same-tool-retry limit;
 * for anything else the UNKNOWN result is surfaced as-is.
 */
async function runToolWithRetry(
  executor: ToolExecutor,
  tool: ToolDefinition<any, any> | undefined,
  name: string,
  args: unknown,
  trace: Trace,
  maxRetries: number,
  interrupt: InterruptManager
): Promise<ToolResult> {
  let result = await executor.run(name, args, trace, interrupt);
  let attempts = 0;
  while (result.status === "UNKNOWN" && tool?.idempotency === "yes" && attempts < maxRetries) {
    attempts++;
    trace.record("TOOL_RETRY", { tool: name, attempt: attempts, reason: "UNKNOWN_RESULT" });
    result = await executor.run(name, args, trace, interrupt);
  }
  return result;
}

type TurnOutcome = "SUCCESS" | "FAILED" | "ASK_USER" | "LIMIT_REACHED" | "CANCELLED";
type Confirm = (message: string, signal: AbortSignal) => Promise<boolean>;

async function runTurn(
  session: Session,
  executor: ToolExecutor,
  inputText: string,
  limits: SessionLimits,
  interrupt: InterruptManager,
  confirm: Confirm
): Promise<void> {
  const turn = sessions.startTurn(session, inputText);
  const sm = session.stateMachine;
  const startedAt = Date.now();

  // A pending ASK_USER from a previous turn leaves the FSM in LISTENING
  // already (section 16 - LISTENING is not terminal); only transition into
  // it from IDLE for a fresh turn.
  if (sm.current === "IDLE") sm.transition("LISTENING");
  turn.trace.record("INPUT", { text: inputText });

  sm.transition("UNDERSTANDING");
  const intent = await intentProcessor.process(inputText, conversation.recentSummary(session.messages));
  turn.trace.record("INTENT", intent);
  conversation.append(session.messages, { role: "user", content: inputText });

  events.emit("agent.goal.started", session.id, { goal: intent.goal }, { turnId: turn.id, traceId: turn.traceId });

  const observations: Observation[] = [];
  let toolCallCount = 0;
  let lastToolKey: string | undefined;
  let sameToolStreak = 0;
  let finalMessage: string | undefined;
  let outcome: TurnOutcome | undefined;

  const cancelNow = (): void => {
    turn.trace.record("CANCELLED", {});
    sm.transition("CANCELLED");
    finalMessage = "Operação cancelada pelo usuário.";
    outcome = "CANCELLED";
  };

  cycles: for (let cycle = 1; cycle <= limits.maxSteps; cycle++) {
    if (interrupt.isCancelRequested()) {
      cancelNow();
      break cycles;
    }

    sm.transition("PLANNING");
    const plan = await planner.plan(intent, registry.list().map((t) => t.name), observations);
    turn.trace.record("PLAN", plan);

    sm.transition("POLICY_CHECK");
    turn.trace.record("POLICY_CHECK");

    sm.transition("EXECUTING");

    let assistantDraft: string | undefined;
    let limitReached: string | undefined;

    innerLoop: for (let round = 0; round < 6; round++) {
      if (Date.now() - startedAt > limits.maxExecutionTimeMs) {
        limitReached = "max_execution_time";
        break innerLoop;
      }
      if (interrupt.isCancelRequested()) break innerLoop;

      const chatMessages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        { role: "system" as const, content: `Plano atual:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` },
        ...session.messages,
      ];
      const result = await llm.chat(chatMessages, registry.describeForLlm());

      if (!result.toolCalls?.length) {
        assistantDraft = result.content ?? "";
        conversation.append(session.messages, { role: "assistant", content: assistantDraft });
        break innerLoop;
      }

      conversation.append(session.messages, { role: "assistant", content: result.content ?? "" });

      for (const call of result.toolCalls) {
        if (toolCallCount >= limits.maxToolCalls) {
          limitReached = "max_tool_calls";
          break innerLoop;
        }
        if (interrupt.isCancelRequested()) break innerLoop;
        toolCallCount++;

        const key = `${call.name}:${JSON.stringify(call.arguments)}`;
        sameToolStreak = key === lastToolKey ? sameToolStreak + 1 : 0;
        lastToolKey = key;
        if (sameToolStreak >= limits.maxSameToolRetries) {
          limitReached = "max_same_tool_retries";
          break innerLoop;
        }

        const tool = registry.get(call.name);
        let toolResult: ToolResult;

        if (!tool) {
          // Let the executor produce the canonical TOOL_NOT_FOUND result - no policy decision applies to a tool that doesn't exist.
          toolResult = await executor.run(call.name, call.arguments, turn.trace, interrupt);
        } else {
          const decision = policyEngine.decide(tool, { approvedThisSession: session.approvedTools });
          turn.trace.record("POLICY_DECISION", { tool: call.name, decision });

          if (decision.decision === "DENY") {
            toolResult = executor.reject(call.name, "POLICY_DENIED", decision.reason, turn.trace);
          } else if (decision.decision === "REQUIRE_CONFIRMATION") {
            sm.transition("WAITING_CONFIRMATION");
            events.emit(
              "confirmation.requested",
              session.id,
              { tool: call.name, reason: decision.reason },
              { turnId: turn.id, traceId: turn.traceId }
            );

            const approved = await confirm(
              `Confirmar execução de "${call.name}" (${decision.reason})? [s/N] `,
              interrupt.signal
            ).catch(() => false);

            sm.transition("EXECUTING");

            if (approved) {
              events.emit("confirmation.accepted", session.id, { tool: call.name }, { turnId: turn.id, traceId: turn.traceId });
              session.approvedTools.add(tool.name);
              toolResult = await runToolWithRetry(
                executor,
                tool,
                call.name,
                call.arguments,
                turn.trace,
                limits.maxSameToolRetries,
                interrupt
              );
            } else {
              events.emit("confirmation.denied", session.id, { tool: call.name }, { turnId: turn.id, traceId: turn.traceId });
              toolResult = executor.reject(
                call.name,
                "CONFIRMATION_DENIED",
                "O usuário não autorizou esta ação.",
                turn.trace
              );
            }
          } else {
            toolResult = await runToolWithRetry(
              executor,
              tool,
              call.name,
              call.arguments,
              turn.trace,
              limits.maxSameToolRetries,
              interrupt
            );
          }
        }

        const observation = observationManager.observe(toolResult);
        observations.push(observation);
        Object.assign(session.worldState, observation.stateDelta);
        turn.trace.record("OBSERVATION", observation);

        conversation.append(session.messages, {
          role: "tool",
          name: call.name,
          toolCallId: call.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    if (interrupt.isCancelRequested()) {
      cancelNow();
      break cycles;
    }

    sm.transition("OBSERVING");
    turn.trace.record("OBSERVATION_SUMMARY", { cycle, count: observations.length });

    sm.transition("EVALUATING");

    if (limitReached) {
      turn.trace.record("LIMIT_REACHED", { reason: limitReached });
      sm.transition("FAILED");
      finalMessage = `Não consegui concluir dentro dos limites de execução (${limitReached}).`;
      outcome = "LIMIT_REACHED";
      break cycles;
    }

    const evaluation = await evaluator.evaluate(intent, observations, assistantDraft);
    turn.trace.record("GOAL_EVALUATION", evaluation);

    if (evaluation.verdict === "COMPLETE") {
      sm.transition("SUCCESS");
      finalMessage = evaluation.userMessage;
      outcome = "SUCCESS";
      break cycles;
    }
    if (evaluation.verdict === "FAIL") {
      sm.transition("FAILED");
      finalMessage = evaluation.userMessage;
      outcome = "FAILED";
      break cycles;
    }
    if (evaluation.verdict === "ASK_USER") {
      sm.transition("LISTENING");
      finalMessage = evaluation.userMessage;
      outcome = "ASK_USER";
      break cycles;
    }
    // REPLAN - loop continues; EVALUATING -> PLANNING is a valid transition
    // for the next cycle, unless we've exhausted max_steps (handled below).
  }

  if (!outcome) {
    // Ran out of replanning cycles (section 31 - max_steps). The FSM is
    // still at EVALUATING from the last cycle's REPLAN verdict.
    turn.trace.record("LIMIT_REACHED", { reason: "max_steps" });
    sm.transition("FAILED");
    finalMessage = "Não consegui concluir o objetivo dentro do número máximo de replanejamentos.";
    outcome = "LIMIT_REACHED";
  }

  console.log(`\n${finalMessage}\n`);
  if (process.env.AYMI_DEBUG_TRACE) {
    console.log(turn.trace.render());
    console.log();
  }

  if (outcome === "SUCCESS") {
    events.emit("agent.goal.completed", session.id, {}, { turnId: turn.id, traceId: turn.traceId });
    sessions.finishTurn(session, turn, finalMessage, "SUCCESS");
    sm.transition("IDLE");
  } else if (outcome === "ASK_USER") {
    sessions.finishTurn(session, turn, finalMessage, "ASK_USER");
    // Stay in LISTENING - the next user message continues straight to
    // UNDERSTANDING without re-entering LISTENING from IDLE.
  } else if (outcome === "CANCELLED") {
    sessions.finishTurn(session, turn, finalMessage, "CANCELLED");
    sm.transition("IDLE");
  } else {
    events.emit("agent.goal.failed", session.id, { reason: outcome }, { turnId: turn.id, traceId: turn.traceId });
    sessions.finishTurn(session, turn, finalMessage, "FAILED");
    sm.transition("IDLE");
  }
}

/**
 * Reads lines on demand from a readline.Interface, one at a time, safely
 * interleaving the main input prompt with confirmation prompts.
 *
 * Neither of Node's two built-in consumption styles fits: `rl.question()`
 * only arms a one-shot `line` listener per call, so lines that arrive
 * before the *next* question() call (e.g. piped/redirected input, which
 * readline can flush faster than the consumer re-arms) are silently
 * dropped; and `for await...of rl` is documented as unsafe to mix with
 * concurrent `rl.question()` calls. Buffering every `line` event ourselves
 * and handing them out on demand avoids both failure modes and works the
 * same way for a real interactive TTY.
 */
class LineReader {
  private readonly buffer: string[] = [];
  private readonly waiting: Array<{ resolve: (line: string) => void; reject: (err: unknown) => void }> = [];

  constructor(rl: import("node:readline").Interface) {
    rl.on("line", (line: string) => {
      const pending = this.waiting.shift();
      if (pending) pending.resolve(line);
      else this.buffer.push(line);
    });
    rl.on("close", () => {
      while (this.waiting.length) {
        const err = new Error("Interface closed");
        (err as NodeJS.ErrnoException).code = "ERR_USE_AFTER_CLOSE";
        this.waiting.shift()!.reject(err);
      }
    });
  }

  next(promptText: string, signal?: AbortSignal): Promise<string> {
    process.stdout.write(promptText);

    if (this.buffer.length) return Promise.resolve(this.buffer.shift()!);

    return new Promise<string>((resolve, reject) => {
      const entry = { resolve, reject };
      const onAbort = () => {
        const idx = this.waiting.indexOf(entry);
        if (idx !== -1) this.waiting.splice(idx, 1);
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
  }
}

async function main(): Promise<void> {
  console.log("aymi - Agent Runtime (Sprint 3)");
  console.log(`Modelo: ${OLLAMA_MODEL} @ ${OLLAMA_HOST}`);
  console.log(`Ferramentas registradas: ${registry.list().map((t) => t.name).join(", ")}`);
  console.log('Digite sua mensagem (ou "sair" para encerrar). Ctrl+C cancela a operação atual; Ctrl+C de novo encerra o programa.\n');

  const session = sessions.createSession();
  const executor = new ToolExecutor(registry, events, session.id);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lineReader = new LineReader(rl);

  const shutdown = () => {
    sessions.closeSession(session);
    try {
      rl.close();
    } catch {
      /* already closed */
    }
    // Set the exit code and let Node drain pending handles on its own -
    // process.exit() can race libuv's own handle-close teardown on Windows.
    process.exitCode = 0;
  };

  // Section 32 - first Ctrl+C is a soft cancel of whatever turn is running;
  // a second Ctrl+C (or one with nothing running) is a hard stop.
  let activeInterrupt: InterruptManager | undefined;
  process.on("SIGINT", () => {
    if (activeInterrupt && !activeInterrupt.isCancelRequested()) {
      activeInterrupt.requestCancel();
      console.log("\n[cancelamento solicitado - Ctrl+C novamente para encerrar o programa]");
    } else {
      shutdown();
    }
  });

  const confirm: Confirm = async (message, signal) => {
    const answer = (await lineReader.next(message, signal)).trim().toLowerCase();
    return answer === "s" || answer === "sim" || answer === "y" || answer === "yes";
  };

  while (true) {
    let raw: string;
    try {
      raw = await lineReader.next("> ");
    } catch (err) {
      // stdin reached EOF (e.g. piped/redirected input) while awaiting a line.
      if ((err as NodeJS.ErrnoException)?.code === "ERR_USE_AFTER_CLOSE") break;
      throw err;
    }

    const input = raw.trim();
    if (!input) continue;
    if (input.toLowerCase() === "sair" || input.toLowerCase() === "exit") break;

    const interrupt = new InterruptManager();
    activeInterrupt = interrupt;
    await runTurn(session, executor, input, DEFAULT_LIMITS, interrupt, confirm);
    activeInterrupt = undefined;
  }

  shutdown();
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
