import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { recordingPath } from "@/lib/repo";

const MAX_CHUNK = 50 * 1024 * 1024;

/** Appends one MediaRecorder chunk. `x-seq: 0` starts a fresh file. */
export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (!interview.config.recordVideo) return fail("Recording is disabled for this interview");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_CHUNK) return fail("Chunk too large", 413);
  const file = recordingPath(interview.id);
  if (req.headers.get("x-seq") === "0") fs.writeFileSync(file, buf);
  else fs.appendFileSync(file, buf);
  return NextResponse.json({ ok: true });
}

/** Streams the recording with HTTP range support so the video can be scrubbed. */
export async function GET(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview?.hasRecording) return fail("Recording not found", 404);
  const file = recordingPath(interview.id);
  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  const download = new URL(req.url).searchParams.has("download");
  const headers: Record<string, string> = { "Content-Type": "video/webm", "Accept-Ranges": "bytes" };
  if (download) headers["Content-Disposition"] = `attachment; filename="interview-${interview.id}.webm"`;

  if (range && !download) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
