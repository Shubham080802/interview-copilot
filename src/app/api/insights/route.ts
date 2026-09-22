import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/current-user";
import { getInsights, listInterviews } from "@/lib/repo";

export async function GET() {
  const userId = await currentUserId();
  return NextResponse.json({ insights: await getInsights(userId), interviews: await listInterviews(userId) });
}
