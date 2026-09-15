import "server-only";
import { NextResponse } from "next/server";
import { getInterview } from "./repo";

export type IdParams = { params: Promise<{ id: string }> };

export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function loadInterview(ctx: IdParams) {
  const { id } = await ctx.params;
  return getInterview(id);
}
