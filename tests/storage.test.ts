import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { blobFileStore } from "@/lib/storage/files";
import { ensureSchema, openSqlite, recoverInterruptedTasks, toPostgresPlaceholders, type SqlDb } from "@/lib/storage/sql";
import { fakeBlobClient, pgliteDb } from "./fakes";

const opened: SqlDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.close?.();
});

async function insertTask(db: SqlDb, id: string, status: string, updatedAt: string | null) {
  await db.run("INSERT INTO interviews (id, created_at, updated_at, status, config) VALUES (?, ?, ?, ?, '{}')", [id, "2026-01-01T00:00:00.000Z", updatedAt, status]);
}

describe("SQL storage", () => {
  it("converts placeholders for Postgres", () => {
    expect(toPostgresPlaceholders("SELECT * FROM t WHERE a = ? AND b IN (?, ?)")).toBe("SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)");
  });

  it("migrates a SQLite database created by an earlier version", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ic-migrate-"));
    const file = path.join(dir, "interviews.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE interviews (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, prep_stage TEXT NOT NULL DEFAULT '',
      error TEXT, config TEXT NOT NULL, research TEXT, plan TEXT, zoom TEXT, started_at TEXT, ended_at TEXT, evaluation TEXT, integrity TEXT, generated_by TEXT);
      CREATE TABLE coach_messages (id TEXT PRIMARY KEY, interview_id TEXT NOT NULL, created_at TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);`);
    old.prepare("INSERT INTO interviews (id, created_at, status, config) VALUES ('oldInterview1', '2026-01-01', 'completed', '{}')").run();
    old.close();

    const db = await openSqlite(file);
    opened.push(db);
    await ensureSchema(db);
    await ensureSchema(db); // idempotent
    await db.run("UPDATE interviews SET last_camera_at = ?, updated_at = ? WHERE id = ?", ["2026-09-15T00:00:00.000Z", "2026-09-15T00:00:00.000Z", "oldInterview1"]);
    expect(await db.get("SELECT status, last_camera_at FROM interviews WHERE id = ?", ["oldInterview1"])).toEqual({ status: "completed", last_camera_at: "2026-09-15T00:00:00.000Z" });
    const columns = await db.all<{ name: string }>("PRAGMA table_info(coach_messages)");
    expect(columns.map((c) => c.name)).toContain("seq");
  });

  it("creates the schema on Postgres idempotently", async () => {
    const db = await pgliteDb();
    opened.push(db);
    await ensureSchema(db);
    await ensureSchema(db);
    await insertTask(db, "pgInterview1", "ready", null);
    expect((await db.get("SELECT status FROM interviews WHERE id = ?", ["pgInterview1"]))?.status).toBe("ready");
  });

  it("locally, recovers every unfinished background task at startup", async () => {
    const db = await pgliteDb();
    opened.push(db);
    await ensureSchema(db);
    await insertTask(db, "localPrep001", "preparing", new Date().toISOString());
    await insertTask(db, "localEval001", "evaluating", new Date().toISOString());
    await insertTask(db, "localDone001", "completed", new Date().toISOString());
    await recoverInterruptedTasks(db, 0);
    const rows = await db.all<{ id: string; status: string; error: string | null }>("SELECT id, status, error FROM interviews ORDER BY id");
    expect(rows.find((r) => r.id === "localPrep001")).toMatchObject({ status: "failed" });
    expect(rows.find((r) => r.id === "localEval001")?.error).toMatch(/Evaluation was interrupted/);
    expect(rows.find((r) => r.id === "localDone001")?.status).toBe("completed");
  });

  it("when hosted, only recovers tasks that stopped updating (other instances may still be working)", async () => {
    const db = await pgliteDb();
    opened.push(db);
    await ensureSchema(db);
    await insertTask(db, "freshTask001", "evaluating", new Date().toISOString());
    await insertTask(db, "staleTask001", "evaluating", new Date(Date.now() - 20 * 60_000).toISOString());
    await recoverInterruptedTasks(db, 15 * 60_000);
    expect((await db.get("SELECT status FROM interviews WHERE id = ?", ["freshTask001"]))?.status).toBe("evaluating");
    expect((await db.get("SELECT status FROM interviews WHERE id = ?", ["staleTask001"]))?.status).toBe("failed");
  });
});

describe("Blob file store", () => {
  it("keeps everything private and paginates listings", async () => {
    const client = fakeBlobClient();
    const store = blobFileStore(client);
    for (let seq = 0; seq < 5; seq++) await store.appendRecordingChunk("blobInterview", 1, seq, new TextEncoder().encode(String(seq)));
    await store.appendRecordingChunk("blobInterview", 3, 0, new TextEncoder().encode("x"));
    expect(await store.listRecordingSegments("blobInterview")).toEqual([1, 3]);
    const rec = (await store.openRecording("blobInterview", 1))!;
    expect(rec.size).toBe(5);
    expect(await new Response(rec.stream(1, 3)).text()).toBe("123");
    await store.deleteRecordings("blobInterview");
    expect(client.store.size).toBe(0);
  });
});
