import { NextResponse } from "next/server";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { deleteInterview, listProctorEvents, listResponses } from "@/lib/repo";

export async function GET(_req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  return NextResponse.json({
    interview,
    responses: await listResponses(interview.id),
    proctorEvents: await listProctorEvents(interview.id),
  });
}

export async function DELETE(_req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  await deleteInterview(interview.id, interview.userId);
  return NextResponse.json({ ok: true });
}
