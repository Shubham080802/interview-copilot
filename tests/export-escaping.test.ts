import { describe, expect, it } from "vitest";
import { toHtml, type InterviewBundle } from "@/lib/export";

/**
 * The printable report embeds text the app did not write — company research comes from web search.
 * None of it may turn into markup or attributes in the exported HTML.
 */
function bundleWithSource(title: string, url: string): InterviewBundle {
  return {
    exportedAt: new Date().toISOString(),
    responses: [],
    proctorEvents: [],
    coachSession: [],
    interview: {
      id: "test",
      createdAt: new Date().toISOString(),
      status: "completed",
      prepStage: "",
      error: null,
      config: { role: "Backend Engineer", company: "ACME" },
      research: { summary: "Summary", sources: [{ title, url }] },
      plan: null,
      zoom: null,
      startedAt: null,
      endedAt: null,
      evaluation: null,
      integrity: null,
      recordingSegments: [],
      hasRecording: false,
      generatedBy: "ai",
    },
  } as unknown as InterviewBundle;
}

describe("HTML export escaping", () => {
  it("keeps a quote in a source URL inside the href attribute", () => {
    const html = toHtml(bundleWithSource("Source", 'https://evil.test/" onmouseover="alert(1'));
    expect(html).not.toMatch(/<a [^>]*onmouseover/);
    expect(html).not.toContain('href="https://evil.test/"');
  });

  it("escapes markup in a source title", () => {
    const html = toHtml(bundleWithSource('"><img src=x onerror=alert(1)>', "https://ok.test/"));
    expect(html).not.toContain("<img");
  });

  it("escapes quotes in the company name used in the title", () => {
    const html = toHtml(bundleWithSource("Source", "https://ok.test/"));
    expect(html).toContain("<title>Interview report — Backend Engineer at ACME</title>");
  });
});
