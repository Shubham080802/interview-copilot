import fs from "node:fs";
import path from "node:path";
import { SNAPSHOT_DIR } from "@/lib/db";
import { fail } from "@/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{16}\.jpg$/.test(file)) return fail("Not found", 404);
  const full = path.join(SNAPSHOT_DIR, file);
  if (!fs.existsSync(full)) return fail("Not found", 404);
  return new Response(fs.readFileSync(full), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
