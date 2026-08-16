import { EventEmitter } from "node:events";

// Event catalog from spec section 18. The presentation layer (voice/avatar,
// future sprints) must only ever react to these events - it must never poll
// the Agent Runtime for its state.
export type AgentEventName =
  | "agent.state.changed"
  | "agent.goal.started"
  | "agent.goal.completed"
  | "agent.goal.failed"
  | "tool.requested"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.timeout"
  | "confirmation.requested"
  | "confirmation.accepted"
  | "confirmation.denied"
  | "speech.started"
  | "speech.chunk"
  | "speech.finished"
  | "speech.interrupted"
  | "avatar.state.changed"
  | "avatar.expression.changed"
  | "session.started"
  | "session.finished";

export interface AgentEvent<TData = unknown> {
  name: AgentEventName;
  sessionId: string;
  turnId?: string;
  traceId?: string;
  timestamp: string;
  data: TData;
}

export type AgentEventListener = (event: AgentEvent) => void;

/**
 * Process-local event bus. In later sprints this can be fanned out over
 * WebSocket to the UI/avatar without the runtime knowing anything changed -
 * subscribers only ever see AgentEvent objects.
 */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit<TData = unknown>(
    name: AgentEventName,
    sessionId: string,
    data: TData,
    extra?: { turnId?: string; traceId?: string }
  ): void {
    const event: AgentEvent<TData> = {
      name,
      sessionId,
      turnId: extra?.turnId,
      traceId: extra?.traceId,
      timestamp: new Date().toISOString(),
      data,
    };
    this.emitter.emit(name, event);
    this.emitter.emit("*", event);
  }

  on(name: AgentEventName | "*", listener: AgentEventListener): () => void {
    this.emitter.on(name, listener);
    return () => this.emitter.off(name, listener);
  }
}
