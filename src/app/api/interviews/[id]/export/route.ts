import { fail, loadInterview, type IdParams } from "@/lib/api";
import { toHtml, toMarkdown, type InterviewBundle } from "@/lib/export";
import { listCoachMessages, listProctorEvents, listResponses } from "@/lib/repo";

export async function GET(req: Request, ctx: IdParams) {
  const interview = await loadInterview(ctx);
  if (!interview) return fail("Interview not found", 404);
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const bundle: InterviewBundle = {
    exportedAt: new Date().toISOString(),
    interview,
    responses: await listResponses(interview.id),
    proctorEvents: await listProctorEvents(interview.id),
    coachSession: await listCoachMessages(interview.id),
  };
  const slug = `${interview.config.company}-${interview.config.role}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  const file = `interview-${slug}-${interview.createdAt.slice(0, 10)}`;

  if (format === "md") {
    return new Response(toMarkdown(bundle), {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${file}.md"` },
    });
  }
  if (format === "html") {
    const inline = new URL(req.url).searchParams.has("print");
    const html = toHtml(bundle).replace("</body>", inline ? "<script>window.onload=()=>window.print()</script></body>" : "</body>");
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...(inline ? {} : { "Content-Disposition": `attachment; filename="${file}.html"` }),
      },
    });
  }
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${file}.json"` },
  });
}
