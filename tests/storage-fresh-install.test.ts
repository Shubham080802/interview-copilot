import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openSqlite } from "@/lib/storage/sql";

/** A fresh clone has no data directory: the app has to create it rather than fail to start. */
const root = path.join(os.tmpdir(), `ic-fresh-${Date.now()}`);
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("first run", () => {
  it("creates the data directory when opening the database", async () => {
    const file = path.join(root, "data", "interviews.db");
    expect(fs.existsSync(path.dirname(file))).toBe(false);
    const db = await openSqlite(file);
    expect(fs.existsSync(file)).toBe(true);
    await db.close?.();
  });
});
