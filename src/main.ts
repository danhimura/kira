import { createInterface } from "node:readline/promises";
import { EventBus } from "./runtime/events/EventBus.js";
import { SessionManager, type Session } from "./runtime/session/SessionManager.js";
import { ToolRegistry } from "./tools/registry/ToolRegistry.js";
import { registerBuiltinTools } from "./tools/index.js";
import { ToolExecutor } from "./runtime/executor/ToolExecutor.js";
import { OllamaProvider } from "./llm/ollama/OllamaProvider.js";
import { SYSTEM_PROMPT } from "./llm/prompts/system.js";
import type { ChatMessage } from "./llm/provider/LLMProvider.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:30b-a3b-instruct-2507-q4_K_M";
const MAX_TOOL_ROUNDTRIPS = 5; // section 31 - max_tool_calls per turn

const events = new EventBus();
const sessions = new SessionManager(events);
const registry = new ToolRegistry();
registerBuiltinTools(registry);

const llm = new OllamaProvider({ host: OLLAMA_HOST, model: OLLAMA_MODEL });

events.on("*", (event) => {
  if (process.env.AYMI_DEBUG_EVENTS) {
    console.log(`  [event] ${event.name}`, JSON.stringify(event.data));
  }
});

async function runTurn(session: Session, executor: ToolExecutor, inputText: string): Promise<void> {
  const turn = sessions.startTurn(session, inputText);
  const sm = session.stateMachine;

  sm.transition("LISTENING");
  turn.trace.record("INPUT", { text: inputText });

  sm.transition("UNDERSTANDING");
  session.messages.push({ role: "user", content: inputText });

  sm.transition("PLANNING");
  turn.trace.record("PLAN");

  sm.transition("POLICY_CHECK");
  turn.trace.record("POLICY_CHECK");

  sm.transition("EXECUTING");
  events.emit("agent.goal.started", session.id, { inputText }, { turnId: turn.id, traceId: turn.traceId });

  const chatMessages = (): ChatMessage[] => [
    { role: "system", content: SYSTEM_PROMPT },
    ...session.messages,
  ];

  let finalContent: string | undefined;
  let failure: string | undefined;

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDTRIPS; round++) {
      if (round === MAX_TOOL_ROUNDTRIPS) {
        failure = "LIMIT_REACHED: max tool round-trips exceeded for this turn.";
        turn.trace.record("LIMIT_REACHED", { maxToolRoundtrips: MAX_TOOL_ROUNDTRIPS });
        break;
      }

      const result = await llm.chat(chatMessages(), registry.describeForLlm());

      if (!result.toolCalls?.length) {
        finalContent = result.content ?? "";
        session.messages.push({ role: "assistant", content: finalContent });
        break;
      }

      // Record the assistant's intent to call tools, then execute each one
      // through the ToolExecutor - never directly.
      session.messages.push({
        role: "assistant",
        content: result.content ?? "",
      });

      for (const call of result.toolCalls) {
        const toolResult = await executor.run(call.name, call.arguments, turn.trace);
        session.messages.push({
          role: "tool",
          name: call.name,
          toolCallId: call.id,
          content: JSON.stringify(toolResult),
        });
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    turn.trace.record("ERROR", { message: failure });
  }

  sm.transition("OBSERVING");
  turn.trace.record("OBSERVATION", { hasFinalContent: Boolean(finalContent) });

  sm.transition("EVALUATING");
  turn.trace.record("GOAL_EVALUATION");

  if (failure) {
    sm.transition("FAILED");
    events.emit("agent.goal.failed", session.id, { reason: failure }, { turnId: turn.id, traceId: turn.traceId });
    console.log(`\n[FALHA] ${failure}\n`);
    sessions.finishTurn(session, turn, undefined, "FAILED");
  } else {
    sm.transition("SUCCESS");
    events.emit("agent.goal.completed", session.id, {}, { turnId: turn.id, traceId: turn.traceId });
    console.log(`\n${finalContent}\n`);
    sessions.finishTurn(session, turn, finalContent, "SUCCESS");
  }

  if (process.env.AYMI_DEBUG_TRACE) {
    console.log(turn.trace.render());
    console.log();
  }

  sm.transition("IDLE");
}

async function main(): Promise<void> {
  console.log("aymi - Agent Runtime (Sprint 1)");
  console.log(`Modelo: ${OLLAMA_MODEL} @ ${OLLAMA_HOST}`);
  console.log(`Ferramentas registradas: ${registry.list().map((t) => t.name).join(", ")}`);
  console.log('Digite sua mensagem (ou "sair" para encerrar).\n');

  const session = sessions.createSession();
  const executor = new ToolExecutor(registry, events, session.id);
  const rl = createInterface({ input: process.stdin, output: process.stdout });

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
  process.on("SIGINT", shutdown);

  rl.setPrompt("> ");
  rl.prompt();

  for await (const rawLine of rl) {
    const input = rawLine.trim();
    if (input.toLowerCase() === "sair" || input.toLowerCase() === "exit") break;

    if (input) await runTurn(session, executor, input);
    // Piped/redirected input can close the interface between iterations;
    // re-prompting is only meaningful for an interactive TTY anyway.
    try {
      rl.prompt();
    } catch {
      /* interface already closed - the for-await loop will end on its own */
    }
  }

  shutdown();
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
