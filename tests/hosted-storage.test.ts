// Runs the shared suites against hosted storage: Postgres (PGlite, same adapter as Neon) + private Blob store (fake client).
import { afterAll, beforeAll } from "vitest";
import { setStorageForTests } from "@/lib/storage";
import { blobFileStore } from "@/lib/storage/files";
import type { SqlDb } from "@/lib/storage/sql";
import { fakeBlobClient, pgliteDb } from "./fakes";
import { cameraSuite } from "./suites/camera";
import { lifecycleSuite } from "./suites/lifecycle";

let sql: SqlDb;
beforeAll(async () => {
  sql = await pgliteDb();
  await setStorageForTests({ sql, files: blobFileStore(fakeBlobClient()), hosted: true });
});
afterAll(async () => {
  await setStorageForTests(undefined);
  await sql.close?.();
});

lifecycleSuite();
cameraSuite();
