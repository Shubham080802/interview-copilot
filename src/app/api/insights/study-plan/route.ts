import { NextResponse } from "next/server";
import { describeError } from "@/lib/ai/client";
import { fail } from "@/lib/api";
import { studyPlan } from "@/lib/service";

export async function POST() {
  try {
    return NextResponse.json(await studyPlan());
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
