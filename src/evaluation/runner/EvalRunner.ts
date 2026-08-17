import { ToolExecutor } from "../../runtime/executor/ToolExecutor.js";
import { InterruptManager } from "../../runtime/interrupt/InterruptManager.js";
import { DEFAULT_LIMITS } from "../../runtime/session/Limits.js";
import { createAgentRuntime, runTurn, type Confirm, type TurnResult } from "../../runtime/AgentRuntime.js";
import type { Intent } from "../../runtime/intent/IntentProcessor.js";
import type { EvalCase } from "../cases/Case.js";
import { evaluateCase, type RequirementResult } from "../assertions/assertions.js";

export interface RunCapture {
  turnResult: TurnResult;
  toolCallSequence: string[];
  stateTransitions: Array<{ from: string; to: string }>;
  intent?: Intent;
}

export interface CaseRunResult {
  case: EvalCase;
  capture: RunCapture;
  results: RequirementResult[];
  verdict: "PASS" | "FAIL";
}

/**
 * Section 28 - runs one case against the *real* Agent Runtime (a fresh
 * session/registry/Ollama connection per case, so cases never leak state
 * into each other), then grades it per section 29.
 */
export async function runCase(kase: EvalCase): Promise<CaseRunResult> {
  await kase.setup?.();

  const runtime = createAgentRuntime();
  const session = runtime.sessions.createSession();
  const executor = new ToolExecutor(runtime.registry, runtime.events, session.id);
  const interrupt = new InterruptManager();

  if (kase.cancelAfterToolCalls !== undefined) {
    let completed = 0;
    runtime.events.on("tool.completed", () => {
      completed++;
      if (completed >= kase.cancelAfterToolCalls!) interrupt.requestCancel();
    });
  }

  const confirm: Confirm = async () => kase.confirmBehavior !== "deny";

  let turnResult: TurnResult;
  try {
    turnResult = await runTurn(runtime, session, executor, kase.input, DEFAULT_LIMITS, interrupt, confirm, { quiet: true });
  } finally {
    runtime.sessions.closeSession(session);
  }

  const entries = turnResult.trace.all();
  const toolCallSequence = entries
    .filter((e) => e.type === "TOOL_REQUEST")
    .map((e) => (e.data as { tool: string }).tool);
  const stateTransitions = entries
    .filter((e) => e.type === "STATE_CHANGED")
    .map((e) => e.data as { from: string; to: string });
  const intent = entries.find((e) => e.type === "INTENT")?.data as Intent | undefined;

  const capture: RunCapture = { turnResult, toolCallSequence, stateTransitions, intent };
  const { results, verdict } = evaluateCase(kase, capture);

  await kase.cleanup?.();

  return { case: kase, capture, results, verdict };
}

export async function runCases(cases: EvalCase[]): Promise<CaseRunResult[]> {
  const results: CaseRunResult[] = [];
  for (const kase of cases) {
    results.push(await runCase(kase));
  }
  return results;
}
