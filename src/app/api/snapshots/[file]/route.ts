import { fail } from "@/lib/api";
import { getSnapshot } from "@/lib/repo";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const data = await getSnapshot(file);
  if (!data) return fail("Not found", 404);
  return new Response(Buffer.from(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
