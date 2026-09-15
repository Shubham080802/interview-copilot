import { NextResponse } from "next/server";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { updateInterview } from "@/lib/repo";

export async function POST(_req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (interview.status !== "ready" && interview.status !== "in_progress") return fail("Interview is not ready");
  if (interview.status === "ready") updateInterview(interview.id, { status: "in_progress", startedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
