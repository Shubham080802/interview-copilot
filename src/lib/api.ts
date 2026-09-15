import "server-only";
import { NextResponse } from "next/server";
import { getInterview } from "./repo";

export type IdParams = { params: Promise<{ id: string }> };

export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export const CAMERA_REQUIRED_MESSAGE = "Your camera must be on for the whole interview. Turn it back on to continue.";

/** 409 response when the interview's camera heartbeat is missing or stale. */
export const cameraRequired = () => NextResponse.json({ error: CAMERA_REQUIRED_MESSAGE, code: "camera_required" }, { status: 409 });

export async function loadInterview(ctx: IdParams) {
  const { id } = await ctx.params;
  return getInterview(id);
}
