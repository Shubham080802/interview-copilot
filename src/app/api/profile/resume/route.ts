import { NextResponse } from "next/server";
import { describeError } from "@/lib/ai/client";
import { fail } from "@/lib/api";
import { ImportError, MAX_RESUME_BYTES } from "@/lib/importers";
import { importResume } from "@/lib/service";

/** Reads an uploaded resume and returns a profile draft for the user to review (nothing is saved here). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Choose a resume file to upload");
  if (file.size > MAX_RESUME_BYTES) return fail("Resume files must be 10 MB or smaller");
  try {
    return NextResponse.json(await importResume(new Uint8Array(await file.arrayBuffer()), file.name));
  } catch (err) {
    return fail(err instanceof ImportError ? err.message : describeError(err), err instanceof ImportError ? 400 : 500);
  }
}
