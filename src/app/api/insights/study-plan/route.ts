import { NextResponse } from "next/server";
import { describeError } from "@/lib/ai/client";
import { fail } from "@/lib/api";
import { studyPlan } from "@/lib/service";

// AI calls and background preparation/evaluation can take minutes on hosted platforms.
export const maxDuration = 300;

export async function POST() {
  try {
    return NextResponse.json(await studyPlan());
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
