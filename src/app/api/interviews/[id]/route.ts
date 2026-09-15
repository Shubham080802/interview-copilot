import { NextResponse } from "next/server";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { deleteInterview, listProctorEvents, listResponses } from "@/lib/repo";

export async function GET(_req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  return NextResponse.json({
    interview,
    responses: listResponses(interview.id),
    proctorEvents: listProctorEvents(interview.id),
  });
}

export async function DELETE(_req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  deleteInterview(interview.id);
  return NextResponse.json({ ok: true });
}
