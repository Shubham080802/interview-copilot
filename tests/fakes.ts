import { PGlite } from "@electric-sql/pglite";
import type { BlobClient } from "@/lib/storage/files";
import { postgresAdapter, type Row, type SqlDb } from "@/lib/storage/sql";

/** In-process Postgres (PGlite) behind the same adapter production uses for Neon. */
export async function pgliteDb(): Promise<SqlDb> {
  const pg = new PGlite();
  await pg.waitReady;
  return postgresAdapter(
    async (text, params) => (await pg.query(text, params)).rows as Row[],
    () => pg.close(),
  );
}

/** In-memory stand-in for the @vercel/blob API (private store). */
export function fakeBlobClient(): BlobClient & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    async put(pathname, body, options) {
      if (options.access !== "private") throw new Error("blobs must be private");
      if (store.has(pathname) && !options.allowOverwrite) throw new Error("exists");
      store.set(pathname, new Uint8Array(body));
    },
    async get(pathname) {
      const data = store.get(pathname);
      if (!data) return null;
      return { statusCode: 200, stream: new Response(data.slice()).body! };
    },
    async list({ prefix, cursor, limit = 1000 }) {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + Math.min(limit, 2)); // tiny pages to exercise pagination
      const next = start + page.length;
      return {
        blobs: page.map((pathname) => ({ pathname, size: store.get(pathname)!.length })),
        hasMore: next < all.length,
        cursor: next < all.length ? String(next) : undefined,
      };
    },
    async del(pathnames) {
      for (const p of pathnames) store.delete(p);
    },
  };
}
