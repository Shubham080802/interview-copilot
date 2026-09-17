import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { computeIntegrity, PROCTOR_EVENT_TYPES } from "@/lib/integrity";
import { addProctorEvent, listProctorEvents, saveSnapshot, updateInterview } from "@/lib/repo";

const EventInput = z.object({
  at: z.string(),
  type: z.enum(PROCTOR_EVENT_TYPES),
  severity: z.enum(["low", "medium", "high"]),
  detail: z.string().max(500).default(""),
  durationSec: z.number().min(0).max(36_000).default(0),
  snapshot: z.string().max(600_000).nullable().default(null),
});

/** Events the browser sends in batches may still be queued when the server cancels an interview. */
const LATE_EVIDENCE_WINDOW_MS = 2 * 60_000;

export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  const cancelled = interview.status === "cancelled" && interview.endedAt !== null;
  if (interview.status !== "in_progress" && !cancelled) return NextResponse.json({ ok: false });
  if (cancelled && Date.now() - Date.parse(interview.endedAt!) > LATE_EVIDENCE_WINDOW_MS) return NextResponse.json({ ok: false });

  const parsed = z.array(EventInput).max(50).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid proctoring payload");

  // After a cancellation, only accept evidence from before it, and never client-sent verdicts.
  const events = cancelled
    ? parsed.data.filter((e) => Date.parse(e.at) <= Date.parse(interview.endedAt!) && e.type !== "assistance" && e.type !== "terminated")
    : parsed.data;
  for (const e of events) {
    await addProctorEvent({ ...e, interviewId: interview.id, snapshot: e.snapshot ? await saveSnapshot(e.snapshot) : null });
  }
  if (cancelled && events.length) {
    await updateInterview(interview.id, { integrity: computeIntegrity(await listProctorEvents(interview.id)) });
  }
  return NextResponse.json({ ok: true, accepted: events.length });
}
