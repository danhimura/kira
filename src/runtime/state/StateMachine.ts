import { EventBus } from "../events/EventBus.js";
import type { Trace } from "../../telemetry/tracing/Trace.js";

// Section 16: the agent runtime state machine. Transitions are validated in
// code (R3 - determinism outside of reasoning), never decided by the LLM.
export type AgentState =
  | "IDLE"
  | "LISTENING"
  | "UNDERSTANDING"
  | "PLANNING"
  | "POLICY_CHECK"
  | "WAITING_CONFIRMATION"
  | "EXECUTING"
  | "OBSERVING"
  | "EVALUATING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED";

// EXECUTING -> WAITING_CONFIRMATION (Sprint 3): the Policy Engine's decision
// isn't known until the LLM actually proposes a specific tool call, so the
// confirmation gate is per-call, not a single checkpoint before EXECUTING.
const TRANSITIONS: Record<AgentState, AgentState[]> = {
  IDLE: ["LISTENING"],
  LISTENING: ["UNDERSTANDING", "CANCELLED"],
  UNDERSTANDING: ["PLANNING", "CANCELLED"],
  PLANNING: ["POLICY_CHECK", "CANCELLED"],
  POLICY_CHECK: ["WAITING_CONFIRMATION", "EXECUTING", "BLOCKED", "CANCELLED"],
  WAITING_CONFIRMATION: ["EXECUTING", "CANCELLED"],
  EXECUTING: ["OBSERVING", "FAILED", "CANCELLED", "WAITING_CONFIRMATION"],
  OBSERVING: ["EVALUATING", "CANCELLED"],
  EVALUATING: ["SUCCESS", "PLANNING", "LISTENING", "FAILED", "CANCELLED"],
  SUCCESS: ["IDLE"],
  FAILED: ["IDLE"],
  CANCELLED: ["IDLE"],
  BLOCKED: ["IDLE"],
};

export const TERMINAL_STATES: ReadonlySet<AgentState> = new Set([
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
]);

export class InvalidTransitionError extends Error {
  constructor(from: AgentState, to: AgentState) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class AgentStateMachine {
  private state: AgentState = "IDLE";

  constructor(
    private readonly sessionId: string,
    private readonly events: EventBus,
    private turnId?: string,
    private traceId?: string,
    private trace?: Trace
  ) {}

  get current(): AgentState {
    return this.state;
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.has(this.state);
  }

  /** Trace is optional so a bare, trace-less state machine can still be used in isolation (e.g. unit tests). */
  bindTurn(turnId: string, traceId: string, trace?: Trace): void {
    this.turnId = turnId;
    this.traceId = traceId;
    this.trace = trace;
  }

  transition(to: AgentState): AgentState {
    const allowed = TRANSITIONS[this.state];
    if (!allowed.includes(to)) {
      throw new InvalidTransitionError(this.state, to);
    }
    const from = this.state;
    this.state = to;
    // Persisted alongside the rest of the turn's trace (section 27 replay,
    // section 28 evaluation-harness expected_state_transitions) - not just
    // the ephemeral EventBus emission below.
    this.trace?.record("STATE_CHANGED", { from, to });
    this.events.emit(
      "agent.state.changed",
      this.sessionId,
      { from, to },
      { turnId: this.turnId, traceId: this.traceId }
    );
    return this.state;
  }
}
