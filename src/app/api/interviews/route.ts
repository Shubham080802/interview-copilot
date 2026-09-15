import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { createInterview, listInterviews } from "@/lib/repo";
import { InterviewConfigSchema } from "@/lib/schemas";
import { startPreparation } from "@/lib/service";

export async function GET() {
  return NextResponse.json(listInterviews());
}

export async function POST(req: Request) {
  const parsed = InterviewConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(", "));
  const interview = createInterview(parsed.data);
  startPreparation(interview.id);
  return NextResponse.json(interview, { status: 201 });
}
