import { getDb } from "../../storage/db.js";

export interface TraceEntry {
  sessionId: string;
  turnId?: string;
  traceId?: string;
  ts: string;
  type: string;
  data?: unknown;
}

/**
 * Append-only trace for a single turn. Persists to SQLite (section 27 -
 * replay groundwork) and can render the section 26 console format.
 */
export class Trace {
  private entries: TraceEntry[] = [];

  constructor(
    private readonly sessionId: string,
    private readonly turnId: string,
    private readonly traceId: string
  ) {}

  record(type: string, data?: unknown): void {
    const entry: TraceEntry = {
      sessionId: this.sessionId,
      turnId: this.turnId,
      traceId: this.traceId,
      ts: new Date().toISOString(),
      type,
      data,
    };
    this.entries.push(entry);

    const db = getDb();
    db.prepare(
      `INSERT INTO trace_events (session_id, turn_id, trace_id, ts, type, data_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      entry.sessionId,
      entry.turnId ?? null,
      entry.traceId ?? null,
      entry.ts,
      entry.type,
      data === undefined ? null : JSON.stringify(data)
    );
  }

  all(): readonly TraceEntry[] {
    return this.entries;
  }

  /** Renders the trace in the "TRACE 91AB" console format from section 26. */
  render(): string {
    const lines = [`TRACE ${this.traceId}`, ""];
    for (const e of this.entries) {
      const time = e.ts.slice(11, 19);
      lines.push(`${time} ${e.type}`);
    }
    return lines.join("\n");
  }
}
