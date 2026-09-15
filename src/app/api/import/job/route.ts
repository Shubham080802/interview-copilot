import { NextResponse } from "next/server";
import { z } from "zod";
import { describeError } from "@/lib/ai/client";
import { fail } from "@/lib/api";
import { ImportError } from "@/lib/importers";
import { importJobPosting } from "@/lib/service";

// AI calls and background preparation/evaluation can take minutes on hosted platforms.
export const maxDuration = 300;

const JobInput = z.union([
  z.object({ url: z.string().trim().min(1).max(2000) }),
  z.object({ text: z.string().trim().min(50, "Paste the full job description").max(60_000) }),
]);

/** Extracts interview setup fields from a job posting link or pasted description. */
export async function POST(req: Request) {
  const parsed = JobInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Provide a job posting link or paste the description");
  try {
    return NextResponse.json(await importJobPosting(parsed.data));
  } catch (err) {
    return fail(err instanceof ImportError ? err.message : describeError(err), err instanceof ImportError ? 400 : 500);
  }
}
