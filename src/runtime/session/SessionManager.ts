import { randomUUID } from "node:crypto";
import { getDb } from "../../storage/db.js";
import { EventBus } from "../events/EventBus.js";
import { Trace } from "../../telemetry/tracing/Trace.js";
import { AgentStateMachine } from "../state/StateMachine.js";
import type { ChatMessage } from "../../llm/provider/LLMProvider.js";

export interface Session {
  id: string;
  startedAt: string;
  stateMachine: AgentStateMachine;
  /** trace_id of the most recently finished turn, becomes parent_trace_id of the next one. */
  lastTraceId?: string;
  /** In-memory chat history for this session (Sprint 1 - Conversation Manager stub). */
  messages: ChatMessage[];
}

export interface Turn {
  id: string;
  traceId: string;
  parentTraceId?: string;
  inputText: string;
  startedAt: string;
  trace: Trace;
}

/**
 * Section 6 - Session Manager. Owns session_id/turn_id/trace_id/parent_trace_id
 * and the session's state machine. A session does not depend on any frontend
 * process being alive.
 */
export class SessionManager {
  constructor(private readonly events: EventBus) {}

  createSession(): Session {
    const id = randomUUID();
    const startedAt = new Date().toISOString();

    getDb()
      .prepare(`INSERT INTO sessions (id, started_at) VALUES (?, ?)`)
      .run(id, startedAt);

    const session: Session = {
      id,
      startedAt,
      stateMachine: new AgentStateMachine(id, this.events),
      messages: [],
    };

    this.events.emit("session.started", id, { startedAt });
    return session;
  }

  startTurn(session: Session, inputText: string): Turn {
    const id = randomUUID();
    const traceId = randomUUID().slice(0, 8);
    const parentTraceId = session.lastTraceId;
    const startedAt = new Date().toISOString();

    getDb()
      .prepare(
        `INSERT INTO turns (id, session_id, trace_id, parent_trace_id, input_text, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, session.id, traceId, parentTraceId ?? null, inputText, startedAt);

    session.stateMachine.bindTurn(id, traceId);

    return {
      id,
      traceId,
      parentTraceId,
      inputText,
      startedAt,
      trace: new Trace(session.id, id, traceId),
    };
  }

  finishTurn(
    session: Session,
    turn: Turn,
    outputText: string | undefined,
    finalStatus: "SUCCESS" | "FAILED" | "CANCELLED" | "BLOCKED"
  ): void {
    getDb()
      .prepare(
        `UPDATE turns SET output_text = ?, final_status = ?, finished_at = ? WHERE id = ?`
      )
      .run(outputText ?? null, finalStatus, new Date().toISOString(), turn.id);

    session.lastTraceId = turn.traceId;
  }

  closeSession(session: Session): void {
    getDb()
      .prepare(`UPDATE sessions SET finished_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), session.id);

    this.events.emit("session.finished", session.id, {});
  }
}
