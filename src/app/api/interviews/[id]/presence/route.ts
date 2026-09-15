import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, loadInterview, type IdParams } from "@/lib/api";
import { setCameraPresence } from "@/lib/repo";

/**
 * Camera heartbeat. The interview room reports every few seconds whether a live, unblocked
 * camera is streaming; answers are only accepted while the latest heartbeat is recent and "on".
 */
export async function POST(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (interview.status !== "ready" && interview.status !== "in_progress") return NextResponse.json({ ok: false });
  const parsed = z.object({ cameraOn: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid presence payload");
  setCameraPresence(interview.id, parsed.data.cameraOn);
  return NextResponse.json({ ok: true });
}
