import { NextResponse } from "next/server";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { updateInterview } from "@/lib/repo";
import { startEvaluation } from "@/lib/service";

// AI calls and background preparation/evaluation can take minutes on hosted platforms.
export const maxDuration = 300;

/** Ends the interview (or re-runs a failed evaluation) and starts evaluation in the background. */
export async function POST(_req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  const canEvaluate =
    interview.status === "in_progress" ||
    interview.status === "completed" ||
    (interview.status === "failed" && interview.plan !== null);
  if (!canEvaluate) return fail("This interview cannot be evaluated yet");
  if (!interview.endedAt) await updateInterview(interview.id, { endedAt: new Date().toISOString() });
  startEvaluation(interview.id);
  return NextResponse.json({ ok: true });
}
