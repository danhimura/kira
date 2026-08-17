import type { PresentationState } from "./types";

/**
 * Section 17 - a state machine independent of the Agent Runtime's own
 * (section 16). It never inspects runtime internals directly - it only
 * ever reacts to `agent.state.changed` events arriving over the wire, the
 * same way any other event consumer would (section 18: "O avatar não deve
 * consultar o Agent Runtime para descobrir seu estado. Ele recebe eventos.").
 *
 * This deliberately has no transition-validity table like the runtime FSM
 * does - the runtime is already the deterministic authority on which
 * transitions are legal; this side just mirrors whatever it reports.
 */
const AGENT_TO_PRESENTATION: Record<string, PresentationState> = {
  IDLE: "IDLE",
  LISTENING: "LISTENING",
  UNDERSTANDING: "LISTENING",
  PLANNING: "THINKING",
  POLICY_CHECK: "THINKING",
  WAITING_CONFIRMATION: "WAITING",
  EXECUTING: "FOCUSED",
  OBSERVING: "THINKING",
  EVALUATING: "THINKING",
  SUCCESS: "SUCCESS",
  FAILED: "ERROR",
  CANCELLED: "SURPRISED",
  BLOCKED: "ERROR",
};

export class PresentationStateMachine {
  private state: PresentationState = "IDLE";
  private readonly listeners = new Set<(state: PresentationState) => void>();

  get current(): PresentationState {
    return this.state;
  }

  /** Feed it the runtime's `agent.state.changed` payload - `{ to: AgentState }`. */
  onAgentStateChanged(to: string): void {
    const mapped = AGENT_TO_PRESENTATION[to];
    if (mapped) this.setState(mapped);
  }

  reset(): void {
    this.setState("IDLE");
  }

  subscribe(listener: (state: PresentationState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: PresentationState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
