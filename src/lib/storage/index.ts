import "server-only";
import path from "node:path";
import { blobFileStore, localFileStore, vercelBlobClient, type FileStore } from "./files";
import { ensureSchema, openNeon, openSqlite, recoverInterruptedTasks, type SqlDb } from "./sql";

export interface Storage {
  sql: SqlDb;
  files: FileStore;
  hosted: boolean;
}

// Local-only data directory; the ignore hint stops the bundler tracing the whole project into serverless functions.
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"));

// Hosted functions may run for up to 5 minutes; a task untouched for longer is considered dead.
const HOSTED_STALE_TASK_MS = 15 * 60 * 1000;

const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

/** True when running with hosted storage (Postgres + Vercel Blob). */
export function isHosted(): boolean {
  return Boolean(databaseUrl());
}

async function createStorage(): Promise<Storage> {
  const url = databaseUrl();
  if (process.env.VERCEL && (!url || !process.env.BLOB_READ_WRITE_TOKEN)) {
    throw new Error(
      "Hosted storage is not configured. Connect a Postgres database (DATABASE_URL) and a Vercel Blob store (BLOB_READ_WRITE_TOKEN) to this Vercel project.",
    );
  }
  const sql = url ? await openNeon(url) : await openSqlite(path.join(DATA_DIR, "interviews.db"));
  const files = process.env.BLOB_READ_WRITE_TOKEN ? blobFileStore(await vercelBlobClient()) : localFileStore(DATA_DIR);
  await ensureSchema(sql);
  await recoverInterruptedTasks(sql, url ? HOSTED_STALE_TASK_MS : 0);
  return { sql, files, hosted: Boolean(url) };
}

// Survives dev hot reloads so the database isn't reopened on every edit.
const holder = globalThis as unknown as { __interviewStorage?: Promise<Storage> };

export function storage(): Promise<Storage> {
  if (!holder.__interviewStorage) {
    holder.__interviewStorage = createStorage().catch((err) => {
      holder.__interviewStorage = undefined; // allow a retry on the next request
      throw err;
    });
  }
  return holder.__interviewStorage;
}

/** Test hook: use a specific database/file store (or reset with `undefined`). */
export async function setStorageForTests(next: { sql: SqlDb; files: FileStore; hosted?: boolean; recoverMs?: number } | undefined) {
  if (!next) {
    holder.__interviewStorage = undefined;
    return;
  }
  await ensureSchema(next.sql);
  if (next.recoverMs !== undefined) await recoverInterruptedTasks(next.sql, next.recoverMs);
  holder.__interviewStorage = Promise.resolve({ sql: next.sql, files: next.files, hosted: next.hosted ?? false });
}
