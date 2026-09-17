import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { PROCTOR_EVENT_TYPES } from "@/lib/integrity";
import { addProctorEvent, saveSnapshot } from "@/lib/repo";

const EventInput = z.object({
  at: z.string(),
  type: z.enum(PROCTOR_EVENT_TYPES),
  severity: z.enum(["low", "medium", "high"]),
  detail: z.string().max(500).default(""),
  durationSec: z.number().min(0).max(36_000).default(0),
  snapshot: z.string().max(600_000).nullable().default(null),
});

export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (interview.status !== "in_progress") return NextResponse.json({ ok: false });
  const parsed = z.array(EventInput).max(50).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid proctoring payload");
  for (const e of parsed.data) {
    await addProctorEvent({ ...e, interviewId: interview.id, snapshot: e.snapshot ? await saveSnapshot(e.snapshot) : null });
  }
  return NextResponse.json({ ok: true });
}
