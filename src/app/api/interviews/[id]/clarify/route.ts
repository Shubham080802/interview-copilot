import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { clarify, MAX_CLARIFICATIONS } from "@/lib/service";

const ClarifyInput = z.object({
  questionId: z.string().max(80),
  prompt: z.string().max(4000),
  question: z.string().trim().min(1).max(2000),
  previous: z
    .array(z.object({ at: z.string(), question: z.string().max(2000), reply: z.string().max(4000), gaveHint: z.boolean() }))
    .max(MAX_CLARIFICATIONS)
    .default([]),
});

export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (interview.status !== "in_progress") return fail("Interview is not in progress");
  const parsed = ClarifyInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Type or speak your question first");
  if (parsed.data.previous.length >= MAX_CLARIFICATIONS) return fail(`You can ask up to ${MAX_CLARIFICATIONS} clarifying questions per question.`);

  const reply = await clarify(interview, {
    questionId: parsed.data.questionId,
    prompt: parsed.data.prompt,
    candidateQuestion: parsed.data.question,
    previous: parsed.data.previous,
  });
  return NextResponse.json({ at: new Date().toISOString(), question: parsed.data.question, reply: reply.reply, gaveHint: reply.gave_hint });
}
