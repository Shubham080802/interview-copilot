import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { ROUND_TYPES } from "@/lib/schemas";
import { recordAnswer } from "@/lib/service";
import { countFillers, wordsPerMinute } from "@/lib/speech-metrics";

const AnswerInput = z.object({
  questionId: z.string().max(80),
  roundType: z.enum(ROUND_TYPES),
  prompt: z.string().max(4000),
  isFollowUp: z.boolean().default(false),
  parentResponseId: z.string().max(40).nullable().default(null),
  answerText: z.string().max(50_000).default(""),
  code: z.string().max(100_000).default(""),
  codeLanguage: z.string().max(40).default(""),
  skipped: z.boolean().default(false),
  startedAt: z.string(),
  endedAt: z.string(),
  speakingSeconds: z.number().min(0).default(0),
});

export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (interview.status !== "in_progress") return fail("Interview is not in progress");
  const parsed = AnswerInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid answer payload");

  const { speakingSeconds, ...a } = parsed.data;
  const durationSec = Math.max(0, Math.round((Date.parse(a.endedAt) - Date.parse(a.startedAt)) / 1000));
  const result = await recordAnswer(interview, {
    ...a,
    durationSec,
    wordsPerMinute: wordsPerMinute(a.answerText, speakingSeconds || durationSec),
    fillerCount: countFillers(a.answerText),
  });
  return NextResponse.json(result);
}
