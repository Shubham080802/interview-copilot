import { NextResponse } from "next/server";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { startPreparation } from "@/lib/service";

/** Retry preparation (optionally forcing demo mode). */
export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (!["failed", "ready"].includes(interview.status)) return fail("Interview is not in a state that can be re-prepared");
  const body = (await req.json().catch(() => ({}))) as { demo?: boolean };
  startPreparation(interview.id, Boolean(body.demo));
  return NextResponse.json({ ok: true });
}
