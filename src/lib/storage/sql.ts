import "server-only";

export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

/** Minimal async SQL interface implemented for SQLite (local) and Postgres (hosted). Queries use `?` placeholders. */
export interface SqlDb {
  dialect: "sqlite" | "postgres";
  all<T extends Row = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T extends Row = Row>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  close?(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Schema (portable between SQLite and Postgres)                      */
/* ------------------------------------------------------------------ */

const TABLES = [
  `CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS interviews (
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
  )`,
  `CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS responses_interview ON responses(interview_id, seq)`,
  `CREATE TABLE IF NOT EXISTS proctor_events (
    id TEXT PRIMARY KEY,
    interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS proctor_interview ON proctor_events(interview_id, at)`,
  `CREATE TABLE IF NOT EXISTS coach_messages (
    id TEXT PRIMARY KEY,
    interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS insights (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  )`,
  // Per-user replacements for the old singleton `profile`/`insights` tables above, which can never
  // hold more than one row each (their CHECK constraint forced id = 1 for everyone). The old tables
  // are left in place, unused, so upgrading needs no destructive migration.
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_insights (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`,
];

/** Columns added after the first release: [table, column, definition]. */
const ADDED_COLUMNS: [string, string, string][] = [
  ["interviews", "last_camera_at", "TEXT"],
  ["interviews", "updated_at", "TEXT"],
  ["coach_messages", "seq", "INTEGER NOT NULL DEFAULT 0"],
  ["interviews", "user_id", "TEXT"],
];

/** Tenant id used for data that predates per-user accounts, and for every request when no login is configured. */
export const LEGACY_USER_ID = "legacy";

export async function ensureSchema(db: SqlDb): Promise<void> {
  for (const statement of TABLES) await db.run(statement);
  for (const [table, column, definition] of ADDED_COLUMNS) {
    if (db.dialect === "postgres") {
      await db.run(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    } else {
      const columns = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
      if (!columns.some((c) => c.name === column)) await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  // One-time, idempotent: tag pre-existing rows so they keep working under the new per-user tables.
  await db.run(`UPDATE interviews SET user_id = ? WHERE user_id IS NULL`, [LEGACY_USER_ID]);
  await db.run(
    `INSERT INTO profiles (user_id, data) SELECT ?, data FROM profile WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = ?)`,
    [LEGACY_USER_ID, LEGACY_USER_ID],
  );
  await db.run(
    `INSERT INTO user_insights (user_id, data) SELECT ?, data FROM insights WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM user_insights WHERE user_id = ?)`,
    [LEGACY_USER_ID, LEGACY_USER_ID],
  );
}

/**
 * Preparation and evaluation run as background tasks. If the process running one stopped,
 * the interview would stay "preparing"/"evaluating" forever — mark it failed so the UI offers a retry.
 * Locally (one process) every unfinished task is interrupted at startup; when hosted, other instances
 * may still be working, so only tasks untouched for `staleAfterMs` are recovered.
 */
export async function recoverInterruptedTasks(db: SqlDb, staleAfterMs: number): Promise<void> {
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
  await db.run(
    `UPDATE interviews SET status = 'failed', prep_stage = 'Interrupted',
       error = CASE status WHEN 'preparing' THEN 'Preparation was interrupted before it finished. Retry to continue.'
                           ELSE 'Evaluation was interrupted before it finished. Retry to continue.' END
     WHERE status IN ('preparing', 'evaluating') AND (updated_at IS NULL OR updated_at <= ?)`,
    [cutoff],
  );
}

/* ------------------------------------------------------------------ */
/*  Adapters                                                           */
/* ------------------------------------------------------------------ */

/** Local SQLite file via Node's built-in node:sqlite. */
export async function openSqlite(file: string): Promise<SqlDb> {
  const { DatabaseSync } = await import("node:sqlite");
  const fs = await import("node:fs");
  const path = await import("node:path");
  // The data directory isn't in the repository, so it may not exist on a fresh clone.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    dialect: "sqlite",
    all: async <T extends Row>(sql: string, params: SqlValue[] = []) => conn.prepare(sql).all(...params) as T[],
    get: async <T extends Row>(sql: string, params: SqlValue[] = []) => conn.prepare(sql).get(...params) as T | undefined,
    run: async (sql: string, params: SqlValue[] = []) => {
      conn.prepare(sql).run(...params);
    },
    close: async () => conn.close(),
  };
}

/** Converts `?` placeholders to Postgres `$1, $2…` (placeholders never appear inside our string literals). */
export function toPostgresPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/** Postgres through any `query(text, params) → rows` function (Neon in production, PGlite in tests). */
export function postgresAdapter(query: (text: string, params: SqlValue[]) => Promise<Row[]>, close?: () => Promise<void>): SqlDb {
  const exec = (sql: string, params: SqlValue[] = []) => query(toPostgresPlaceholders(sql), params);
  return {
    dialect: "postgres",
    all: async <T extends Row>(sql: string, params?: SqlValue[]) => (await exec(sql, params)) as T[],
    get: async <T extends Row>(sql: string, params?: SqlValue[]) => (await exec(sql, params))[0] as T | undefined,
    run: async (sql: string, params?: SqlValue[]) => {
      await exec(sql, params);
    },
    close,
  };
}

export async function openNeon(connectionString: string): Promise<SqlDb> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(connectionString);
  return postgresAdapter((text, params) => sql.query(text, params) as Promise<Row[]>);
}

export function toJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export function fromJson<T>(value: unknown): T | null {
  return typeof value === "string" ? (JSON.parse(value) as T) : null;
}
