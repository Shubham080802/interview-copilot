import { NextResponse } from "next/server";
import { z } from "zod";
import { describeError } from "@/lib/ai/client";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { getResponse } from "@/lib/repo";
import { retryAnswer } from "@/lib/service";

// AI calls and background preparation/evaluation can take minutes on hosted platforms.
export const maxDuration = 300;

const RetryInput = z.object({
  responseId: z.string().max(40),
  answerText: z.string().max(50_000).default(""),
  code: z.string().max(100_000).default(""),
});

export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  const parsed = RetryInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid retry payload");
  const response = await getResponse(parsed.data.responseId);
  if (!response || response.interviewId !== interview.id) return fail("Answer not found", 404);
  if (!parsed.data.answerText.trim() && !parsed.data.code.trim()) return fail("Type or speak an answer first");
  try {
    return NextResponse.json(await retryAnswer(interview, response, parsed.data.answerText, parsed.data.code));
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
