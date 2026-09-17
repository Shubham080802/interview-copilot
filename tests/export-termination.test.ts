import { describe, expect, it } from "vitest";
import { toMarkdown } from "@/lib/export";
import { computeIntegrity } from "@/lib/integrity";
import type { Interview } from "@/lib/types";
import { config } from "./helpers";

describe("report export", () => {
  it("states when an interview was ended automatically", () => {
    const at = new Date().toISOString();
    const base = { id: "e", interviewId: "exportTest1", at, severity: "high" as const, durationSec: 0, snapshot: null };
    const integrity = computeIntegrity([
      { ...base, type: "other_voice", detail: "Another voice detected nearby (similarity 0.10)" },
      { ...base, type: "terminated", detail: "another voice was heard again within 2 minutes of a warning" },
    ]);
    const interview = { id: "exportTest1", createdAt: at, config: config(), integrity, evaluation: null, research: null, generatedBy: "demo" } as unknown as Interview;
    const md = toMarkdown({ exportedAt: at, interview, responses: [], proctorEvents: [], coachSession: [] });
    expect(md).toContain("**Interview ended automatically:** another voice was heard again within 2 minutes of a warning.");
    expect(md).toContain("high risk");
  });
});
