import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
export const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
export const RECORDING_DIR = path.join(DATA_DIR, "recordings");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  prep_stage TEXT NOT NULL DEFAULT '',
  error TEXT,
  config TEXT NOT NULL,
  research TEXT,
  plan TEXT,
  zoom TEXT,
  started_at TEXT,
  ended_at TEXT,
  evaluation TEXT,
  integrity TEXT,
  generated_by TEXT
);
CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS responses_interview ON responses(interview_id, seq);
CREATE TABLE IF NOT EXISTS proctor_events (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proctor_interview ON proctor_events(interview_id, at);
CREATE TABLE IF NOT EXISTS coach_messages (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);
`;

let migrated = false;
const globalForDb = globalThis as unknown as { __interviewDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!globalForDb.__interviewDb) {
    for (const dir of [DATA_DIR, SNAPSHOT_DIR, RECORDING_DIR]) fs.mkdirSync(dir, { recursive: true });
    const conn = new DatabaseSync(path.join(DATA_DIR, "interviews.db"));
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    conn.exec(SCHEMA);
    recoverInterruptedTasks(conn);
    globalForDb.__interviewDb = conn;
  }
  // The connection survives dev hot reloads, so apply migrations once per loaded module version.
  if (!migrated) {
    migrate(globalForDb.__interviewDb);
    migrated = true;
  }
  return globalForDb.__interviewDb;
}

/** Adds columns introduced after the first release to existing databases. */
function migrate(conn: DatabaseSync) {
  const columns = new Set(conn.prepare("PRAGMA table_info(interviews)").all().map((c) => c.name as string));
  if (!columns.has("last_camera_at")) conn.exec("ALTER TABLE interviews ADD COLUMN last_camera_at TEXT");
}

/**
 * Preparation and evaluation run as in-process background tasks. If the server stopped
 * while one was running, the interview would otherwise stay "preparing"/"evaluating"
 * forever — mark it failed so the UI offers a retry.
 */
function recoverInterruptedTasks(conn: DatabaseSync) {
  conn
    .prepare(
      `UPDATE interviews SET status = 'failed', prep_stage = 'Interrupted',
         error = CASE status WHEN 'preparing' THEN 'Preparation was interrupted because the server restarted. Retry to continue.'
                             ELSE 'Evaluation was interrupted because the server restarted. Retry to continue.' END
       WHERE status IN ('preparing', 'evaluating')`,
    )
    .run();
}

export function toJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export function fromJson<T>(value: unknown): T | null {
  return typeof value === "string" ? (JSON.parse(value) as T) : null;
}
