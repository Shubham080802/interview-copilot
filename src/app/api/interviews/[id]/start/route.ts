import { NextResponse } from "next/server";
import { cameraRequired, fail, loadInterview, type IdParams } from "@/lib/api";
import { isCameraLive, updateInterview } from "@/lib/repo";

export async function POST(_req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  if (interview.status !== "ready" && interview.status !== "in_progress") return fail("Interview is not ready");
  if (!await isCameraLive(interview.id)) return cameraRequired();
  if (interview.status === "ready") await updateInterview(interview.id, { status: "in_progress", startedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
