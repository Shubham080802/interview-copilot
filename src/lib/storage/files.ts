import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export interface RecordingReader {
  size: number;
  /** Streams bytes [start, end] inclusive. */
  stream(start: number, end: number): ReadableStream<Uint8Array>;
}

/** Binary storage for proctoring snapshots and interview recordings. */
export interface FileStore {
  kind: "local" | "blob";
  putSnapshot(name: string, data: Uint8Array): Promise<void>;
  getSnapshot(name: string): Promise<Uint8Array | null>;
  deleteSnapshot(name: string): Promise<void>;
  /** Stores one recorder chunk; `seq === 0` starts (or restarts) the part. */
  appendRecordingChunk(interviewId: string, segment: number, seq: number, data: Uint8Array): Promise<void>;
  listRecordingSegments(interviewId: string): Promise<number[]>;
  openRecording(interviewId: string, segment: number): Promise<RecordingReader | null>;
  deleteRecordings(interviewId: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Local disk                                                         */
/* ------------------------------------------------------------------ */

export function localFileStore(dataDir: string): FileStore {
  const snapshots = path.join(dataDir, "snapshots");
  const recordings = path.join(dataDir, "recordings");
  for (const dir of [snapshots, recordings]) fs.mkdirSync(dir, { recursive: true });
  const recordingPath = (id: string, segment: number) =>
    path.join(recordings, segment === 1 ? `${id}.webm` : `${id}.part${segment}.webm`);

  const segmentsOf = (id: string) => {
    const re = new RegExp(`^${id.replace(/-/g, "\\-")}(?:\\.part(\\d+))?\\.webm$`);
    return fs
      .readdirSync(recordings)
      .map((f) => re.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => (m[1] ? Number(m[1]) : 1))
      .sort((a, b) => a - b);
  };

  return {
    kind: "local",
    async putSnapshot(name, data) {
      fs.writeFileSync(path.join(snapshots, name), data);
    },
    async getSnapshot(name) {
      const file = path.join(snapshots, name);
      return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
    },
    async deleteSnapshot(name) {
      fs.rmSync(path.join(snapshots, name), { force: true });
    },
    async appendRecordingChunk(id, segment, seq, data) {
      const file = recordingPath(id, segment);
      if (seq === 0) fs.writeFileSync(file, data);
      else fs.appendFileSync(file, data);
    },
    async listRecordingSegments(id) {
      return segmentsOf(id);
    },
    async openRecording(id, segment) {
      const file = recordingPath(id, segment);
      if (!fs.existsSync(file)) return null;
      return {
        size: fs.statSync(file).size,
        stream: (start, end) => Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>,
      };
    },
    async deleteRecordings(id) {
      for (const segment of segmentsOf(id)) fs.rmSync(recordingPath(id, segment), { force: true });
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Vercel Blob (private store)                                        */
/* ------------------------------------------------------------------ */

/** The subset of @vercel/blob used here — injectable so tests can use an in-memory fake. */
export interface BlobClient {
  put(pathname: string, body: Uint8Array | Buffer, options: { access: "private"; contentType: string; addRandomSuffix: false; allowOverwrite: true }): Promise<unknown>;
  get(pathname: string, options: { access: "private" }): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ blobs: { pathname: string; size: number }[]; cursor?: string; hasMore: boolean }>;
  del(pathnames: string[]): Promise<void>;
}

export async function vercelBlobClient(): Promise<BlobClient> {
  const blob = await import("@vercel/blob");
  return {
    put: (pathname, body, options) => blob.put(pathname, Buffer.from(body), options),
    get: (pathname, options) => blob.get(pathname, options),
    list: (options) => blob.list(options),
    del: (pathnames) => blob.del(pathnames),
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Blob objects can't be appended to, so each recorder chunk is its own private blob
 * (`recordings/<id>/<part>/<seq>.webm`) and parts are stitched together when read.
 */
export function blobFileStore(client: BlobClient): FileStore {
  const listAll = async (prefix: string) => {
    const blobs: { pathname: string; size: number }[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.list({ prefix, cursor, limit: 1000 });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return blobs;
  };
  const chunkPath = (id: string, segment: number, seq: number) => `recordings/${id}/${segment}/${String(seq).padStart(6, "0")}.webm`;
  const chunksOf = async (id: string, segment: number) =>
    (await listAll(`recordings/${id}/${segment}/`)).sort((a, b) => a.pathname.localeCompare(b.pathname));

  return {
    kind: "blob",
    async putSnapshot(name, data) {
      await client.put(`snapshots/${name}`, data, { access: "private", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: true });
    },
    async getSnapshot(name) {
      const result = await client.get(`snapshots/${name}`, { access: "private" }).catch(() => null);
      return result?.stream ? readAll(result.stream) : null;
    },
    async deleteSnapshot(name) {
      await client.del([`snapshots/${name}`]);
    },
    async appendRecordingChunk(id, segment, seq, data) {
      if (seq === 0) {
        const stale = await chunksOf(id, segment);
        if (stale.length) await client.del(stale.map((b) => b.pathname));
      }
      await client.put(chunkPath(id, segment, seq), data, { access: "private", contentType: "video/webm", addRandomSuffix: false, allowOverwrite: true });
    },
    async listRecordingSegments(id) {
      const segments = new Set<number>();
      for (const b of await listAll(`recordings/${id}/`)) {
        const segment = Number(b.pathname.split("/")[2]);
        if (Number.isInteger(segment)) segments.add(segment);
      }
      return [...segments].sort((a, b) => a - b);
    },
    async openRecording(id, segment) {
      const chunks = await chunksOf(id, segment);
      if (!chunks.length) return null;
      const size = chunks.reduce((s, c) => s + c.size, 0);
      return {
        size,
        stream: (start, end) => {
          let offset = 0;
          const ranges = chunks
            .map((c) => {
              const from = offset;
              offset += c.size;
              return { pathname: c.pathname, from, to: offset - 1 };
            })
            .filter((c) => c.to >= start && c.from <= end);
          let i = 0;
          return new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (i >= ranges.length) return controller.close();
              const c = ranges[i++];
              const result = await client.get(c.pathname, { access: "private" });
              if (!result?.stream) return controller.error(new Error(`Missing recording chunk ${c.pathname}`));
              const bytes = await readAll(result.stream);
              controller.enqueue(bytes.subarray(Math.max(0, start - c.from), Math.min(bytes.length, end - c.from + 1)));
            },
          });
        },
      };
    },
    async deleteRecordings(id) {
      const all = await listAll(`recordings/${id}/`);
      for (let i = 0; i < all.length; i += 500) await client.del(all.slice(i, i + 500).map((b) => b.pathname));
    },
  };
}
