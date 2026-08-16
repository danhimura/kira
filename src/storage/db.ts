import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = new URL("../../storage/aymi.sqlite", import.meta.url).pathname
  // strip the leading slash Windows file URLs get ("/C:/...")
  .replace(/^\/([a-zA-Z]:)/, "$1");

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      parent_trace_id TEXT,
      input_text TEXT NOT NULL,
      output_text TEXT,
      final_status TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS trace_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      trace_id TEXT,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT
    );
  `);

  return db;
}
