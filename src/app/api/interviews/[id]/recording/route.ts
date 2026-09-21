import { NextResponse } from "next/server";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { appendRecordingChunk, deleteRecording, openRecording } from "@/lib/repo";

// Hosted platforms cap request bodies (~4.5 MB on Vercel); recorder chunks are far smaller.
const MAX_CHUNK = 4 * 1024 * 1024;
const MAX_SEGMENTS = 50;

function parseSegment(value: string | null): number | null {
  const n = Number(value ?? "1");
  return Number.isInteger(n) && n >= 1 && n <= MAX_SEGMENTS ? n : null;
}

/** Stores one MediaRecorder chunk of a recording part. `x-seq: 0` starts the part. */
export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (!interview.config.recordVideo) return fail("Recording is disabled for this interview");
  if (interview.status !== "in_progress") return fail("Interview is not in progress");
  const segment = parseSegment(req.headers.get("x-segment"));
  const seq = Number(req.headers.get("x-seq") ?? "0");
  if (!segment || !Number.isInteger(seq) || seq < 0 || seq > 100_000) return fail("Invalid recording part");
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > MAX_CHUNK) return fail("Chunk too large", 413);
  await appendRecordingChunk(interview.id, segment, seq, buf);
  return NextResponse.json({ ok: true });
}

/** Streams a recording part (`?segment=n`) with HTTP range support so it can be scrubbed. */
export async function GET(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  const params = new URL(req.url).searchParams;
  const segment = parseSegment(params.get("segment"));
  if (!interview || !segment) return fail("Recording not found", 404);
  const recording = await openRecording(interview.id, segment);
  if (!recording) return fail("Recording not found", 404);

  const { size } = recording;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  const download = params.has("download");
  // Recordings hold the voice conversation only (audio/webm). Older video recordings still play as audio.
  const headers: Record<string, string> = { "Content-Type": "audio/webm", "Accept-Ranges": "bytes" };
  if (download) headers["Content-Disposition"] = `attachment; filename="interview-${interview.id}${segment > 1 ? `-part${segment}` : ""}.webm"`;

  if (range && !download) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(recording.stream(start, end), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(recording.stream(0, size - 1), { headers: { ...headers, "Content-Length": String(size) } });
}

/** Deletes one part of the conversation audio (`?segment=n`). The interview itself is kept. */
export async function DELETE(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (interview.status === "in_progress") return fail("The interview is still running", 409);
  const segment = parseSegment(new URL(req.url).searchParams.get("segment"));
  if (!segment) return fail("Invalid recording part");
  await deleteRecording(interview.id, segment);
  return NextResponse.json({ ok: true });
}
