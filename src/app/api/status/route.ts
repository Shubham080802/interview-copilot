import { NextResponse } from "next/server";
import { aiEnabled, MODEL } from "@/lib/ai/client";
import type { AppStatus } from "@/lib/types";
import { zoomConfigured } from "@/lib/zoom";

export async function GET() {
  const status: AppStatus = { aiMode: aiEnabled() ? "ai" : "demo", model: MODEL, zoomConfigured: zoomConfigured() };
  return NextResponse.json(status);
}
