import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("database migration", () => {
  it("adds new columns to a database created by an earlier version", async () => {
    // Simulate a database from before camera presence existed.
    const dir = process.env.DATA_DIR!;
    fs.mkdirSync(dir, { recursive: true });
    const old = new DatabaseSync(path.join(dir, "interviews.db"));
    old.exec(`CREATE TABLE interviews (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, prep_stage TEXT NOT NULL DEFAULT '',
      error TEXT, config TEXT NOT NULL, research TEXT, plan TEXT, zoom TEXT, started_at TEXT, ended_at TEXT,
      evaluation TEXT, integrity TEXT, generated_by TEXT)`);
    old.prepare("INSERT INTO interviews (id, created_at, status, config) VALUES ('oldInterview1', '2026-01-01', 'completed', '{}')").run();
    old.close();

    const repo = await import("@/lib/repo");
    expect(repo.getInterview("oldInterview1")?.status).toBe("completed");
    repo.setCameraPresence("oldInterview1", true);
    expect(repo.isCameraLive("oldInterview1")).toBe(true);
  });
});
