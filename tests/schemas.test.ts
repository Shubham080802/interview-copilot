import { describe, expect, it } from "vitest";
import { InterviewConfigSchema } from "@/lib/schemas";

describe("InterviewConfigSchema", () => {
  it("applies sensible defaults", () => {
    const c = InterviewConfigSchema.parse({ field: "Design", role: "Product Designer", seniority: "senior", company: "Figma", rounds: ["behavioral"] });
    expect(c).toMatchObject({ questionsPerRound: 3, difficulty: "adaptive", proctoring: true, recordVideo: true, zoomMode: "none" });
  });

  it("rejects missing required fields and empty rounds", () => {
    expect(InterviewConfigSchema.safeParse({ field: "x", role: "", seniority: "mid", company: "y", rounds: ["hr"] }).success).toBe(false);
    expect(InterviewConfigSchema.safeParse({ field: "x", role: "r", seniority: "mid", company: "y", rounds: [] }).success).toBe(false);
  });

  it("caps questions per round", () => {
    expect(InterviewConfigSchema.safeParse({ field: "x", role: "r", seniority: "mid", company: "y", rounds: ["hr"], questionsPerRound: 20 }).success).toBe(false);
  });
});

describe("meeting link", () => {
  const base = { field: "Backend", role: "Engineer", seniority: "mid", company: "ACME", rounds: ["technical"] };
  it("accepts an empty or web link and rejects other schemes", () => {
    expect(InterviewConfigSchema.safeParse({ ...base, zoomUrl: "" }).success).toBe(true);
    expect(InterviewConfigSchema.safeParse({ ...base, zoomUrl: "https://zoom.us/j/123" }).success).toBe(true);
    expect(InterviewConfigSchema.safeParse({ ...base, zoomUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});
