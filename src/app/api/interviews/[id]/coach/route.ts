import { NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled, describeError } from "@/lib/ai/client";
import { streamCoachReply } from "@/lib/ai/engine";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { demoCoachReply } from "@/lib/demo";
import { addCoachMessage, clearCoachMessages, listCoachMessages, listResponses } from "@/lib/repo";

// AI calls and background preparation/evaluation can take minutes on hosted platforms.
export const maxDuration = 300;

export async function GET(_req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  return NextResponse.json(await listCoachMessages(interview.id));
}

export async function DELETE(_req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  await clearCoachMessages(interview.id);
  return NextResponse.json({ ok: true });
}

/** Streams the coach's reply as plain text. */
export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview?.evaluation) return fail("The interview has not been evaluated yet", 400);
  const parsed = z.object({ message: z.string().trim().min(1).max(8000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Message is required");

  await addCoachMessage(interview.id, "user", parsed.data.message);
  const history = await listCoachMessages(interview.id);
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      let reply = "";
      try {
        if (interview.generatedBy === "ai" && aiEnabled()) {
          for await (const chunk of streamCoachReply(interview, await listResponses(interview.id), history)) {
            reply += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        } else {
          reply = demoCoachReply(interview, parsed.data.message);
          controller.enqueue(encoder.encode(reply));
        }
      } catch (err) {
        const msg = `\n\n**Error:** ${describeError(err)}`;
        reply += msg;
        controller.enqueue(encoder.encode(msg));
      } finally {
        if (reply) await addCoachMessage(interview.id, "assistant", reply);
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
