import { NextResponse } from "next/server";
import { getInsights, listInterviews } from "@/lib/repo";

export async function GET() {
  return NextResponse.json({ insights: await getInsights(), interviews: await listInterviews() });
}
