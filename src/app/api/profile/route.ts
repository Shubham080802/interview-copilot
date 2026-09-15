import { NextResponse } from "next/server";
import { z } from "zod";
import { fail } from "@/lib/api";
import { getProfile, saveProfile } from "@/lib/repo";

const ProfileInput = z.object({
  name: z.string().max(120).default(""),
  headline: z.string().max(200).default(""),
  experienceYears: z.coerce.number().min(0).max(60).default(0),
  resume: z.string().max(50_000).default(""),
});

export async function GET() {
  return NextResponse.json(await getProfile());
}

export async function PUT(req: Request) {
  const parsed = ProfileInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid profile");
  return NextResponse.json(await saveProfile(parsed.data));
}
