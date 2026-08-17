// Section 17 - the presentation state machine's states. Independent of the
// Agent Runtime's own state machine (section 16) - a different concern
// entirely, driven by agent events rather than owning them.
export type PresentationState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "FOCUSED"
  | "SPEAKING"
  | "WAITING"
  | "SUCCESS"
  | "ERROR"
  | "SURPRISED";

// Section 22 - what the Animation Controller actually resolves to display,
// after priority resolution between the base presentation state and the
// independent "is speaking" / "confirmation pending" signals.
export type Expression = "idle" | "listening" | "thinking" | "focused" | "speaking" | "waiting" | "success" | "error" | "surprised";

export interface AgentEvent {
  name: string;
  sessionId: string;
  turnId?: string;
  traceId?: string;
  timestamp: string;
  data: unknown;
}
