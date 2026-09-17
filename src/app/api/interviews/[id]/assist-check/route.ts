import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, interviewTerminated, loadInterview, type IdParams } from "@/lib/api";
import { getTermination } from "@/lib/repo";
import { checkAssistance } from "@/lib/service";

// The AI check is a short call, but allow for slow responses.
export const maxDuration = 60;

const AssistInput = z.object({
  questionId: z.string().max(80),
  prompt: z.string().max(4000),
  transcript: z.string().trim().min(1).max(4000),
});

/** Checks speech recognized from another voice near the candidate; cancels the interview if it is clearly help. */
export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (interview.status !== "in_progress") return fail("Interview is not in progress");
  const termination = await getTermination(interview.id);
  if (termination) return interviewTerminated(termination.detail);
  const parsed = AssistInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid speech payload");
  const result = await checkAssistance(interview, parsed.data);
  return NextResponse.json({ cancelled: result.cancelled, message: result.message ?? null, verdict: result.check.confidence, method: result.method });
}
