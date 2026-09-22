import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { currentUserId } from "@/lib/current-user";
import { createInterview, listInterviews } from "@/lib/repo";
import { InterviewConfigSchema } from "@/lib/schemas";
import { startPreparation } from "@/lib/service";

// AI calls and background preparation/evaluation can take minutes on hosted platforms.
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json(await listInterviews(await currentUserId()));
}

export async function POST(req: Request) {
  const parsed = InterviewConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(", "));
  const interview = await createInterview(parsed.data, await currentUserId());
  startPreparation(interview.id);
  return NextResponse.json(interview, { status: 201 });
}
