import { EventBus } from "./events/EventBus.js";
import { SessionManager, type Session } from "./session/SessionManager.js";
import type { SessionLimits } from "./session/Limits.js";
import { ToolRegistry } from "../tools/registry/ToolRegistry.js";
import { registerBuiltinTools } from "../tools/index.js";
import { ToolExecutor, type ToolResult } from "./executor/ToolExecutor.js";
import type { ToolDefinition } from "../tools/registry/ToolDefinition.js";
import type { Trace } from "../telemetry/tracing/Trace.js";
import { OllamaProvider } from "../llm/ollama/OllamaProvider.js";
import { SYSTEM_PROMPT } from "../llm/prompts/system.js";
import { IntentProcessor } from "./intent/IntentProcessor.js";
import { Planner } from "./planner/Planner.js";
import { ObservationManager, type Observation } from "./observation/ObservationManager.js";
import { GoalEvaluator } from "./evaluator/GoalEvaluator.js";
import { ConversationManager, truncateToolResult } from "./conversation/ConversationManager.js";
import { PolicyEngine } from "./policy/PolicyEngine.js";
import type { InterruptManager } from "./interrupt/InterruptManager.js";

export type TurnOutcome = "SUCCESS" | "FAILED" | "ASK_USER" | "LIMIT_REACHED" | "CANCELLED";
export type Confirm = (message: string, signal: AbortSignal) => Promise<boolean>;

export interface TurnResult {
  outcome: TurnOutcome;
  finalMessage: string;
  turnId: string;
  traceId: string;
  observations: Observation[];
  trace: Trace;
}

/**
 * Everything the runtime needs, constructed once and shared by both the CLI
 * (main.ts) and the Sprint 5 Evaluation Harness - so an eval case exercises
 * the exact same code path a real user turn does, never a reimplementation.
 */
export interface AgentRuntimeDeps {
  events: EventBus;
  sessions: SessionManager;
  registry: ToolRegistry;
  llm: OllamaProvider;
  intentProcessor: IntentProcessor;
  planner: Planner;
  observationManager: ObservationManager;
  evaluator: GoalEvaluator;
  conversation: ConversationManager;
  policyEngine: PolicyEngine;
}

export function createAgentRuntime(options?: {
  ollamaHost?: string;
  ollamaModel?: string;
  ollamaNumCtx?: number;
}): AgentRuntimeDeps {
  const ollamaHost = options?.ollamaHost ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const ollamaModel = options?.ollamaModel ?? process.env.OLLAMA_MODEL ?? "qwen3:30b-a3b-instruct-2507-q4_K_M";
  const ollamaNumCtx = options?.ollamaNumCtx ?? (process.env.OLLAMA_NUM_CTX ? Number(process.env.OLLAMA_NUM_CTX) : undefined);

  const events = new EventBus();
  const sessions = new SessionManager(events);
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);

  const llm = new OllamaProvider({ host: ollamaHost, model: ollamaModel, numCtx: ollamaNumCtx });

  return {
    events,
    sessions,
    registry,
    llm,
    intentProcessor: new IntentProcessor(llm),
    planner: new Planner(llm),
    observationManager: new ObservationManager(),
    evaluator: new GoalEvaluator(llm),
    conversation: new ConversationManager(),
    policyEngine: new PolicyEngine(),
  };
}

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

export interface RunTurnOptions {
  /** Suppress console output - used by the Evaluation Harness so a full case run doesn't spam stdout. */
  quiet?: boolean;
}

/**
 * Runs one full turn: UNDERSTANDING -> { PLANNING -> POLICY_CHECK ->
 * EXECUTING -> OBSERVING -> EVALUATING } cycles -> a terminal-ish outcome.
 * This is the single code path used by both the interactive CLI and the
 * Evaluation Harness (section 28) - the harness supplies its own `confirm`/
 * `interrupt` so it can auto-approve, auto-deny, or simulate a mid-turn
 * cancellation without a real user.
 */
export async function runTurn(
  deps: AgentRuntimeDeps,
  session: Session,
  executor: ToolExecutor,
  inputText: string,
  limits: SessionLimits,
  interrupt: InterruptManager,
  confirm: Confirm,
  options?: RunTurnOptions
): Promise<TurnResult> {
  const { events, sessions, registry, llm, intentProcessor, planner, observationManager, evaluator, conversation, policyEngine } =
    deps;
  const quiet = options?.quiet ?? false;

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

        // Recorded here, once per proposed call, regardless of what the
        // Policy Engine decides next - section 18's "tool.requested"
        // reflects what the LLM proposed, not what actually ran.
        turn.trace.record("TOOL_REQUEST", { tool: call.name, args: call.arguments });
        events.emit(
          "tool.requested",
          session.id,
          { tool: call.name, args: call.arguments },
          { turnId: turn.id, traceId: turn.traceId }
        );

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
          content: truncateToolResult(toolResult, limits.maxToolResultChars),
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

  if (!quiet) {
    console.log(`\n${finalMessage}\n`);
    if (process.env.AYMI_DEBUG_TRACE) {
      console.log(turn.trace.render());
      console.log();
    }
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

  return {
    outcome,
    finalMessage: finalMessage ?? "",
    turnId: turn.id,
    traceId: turn.traceId,
    observations,
    trace: turn.trace,
  };
}
