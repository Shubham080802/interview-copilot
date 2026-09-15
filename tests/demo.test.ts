import { describe, expect, it } from "vitest";
import { demoEvaluateRound, demoFollowUp, demoPlan, demoRetry } from "@/lib/demo";
import { computeIntegrity } from "@/lib/integrity";
import type { Interview, InterviewResponse, StoredInsights } from "@/lib/types";
import { answer, config } from "./helpers";

const noHistory: StoredInsights = {
  strengths: [], weaknesses: [], topics_mastered: [], topics_to_revisit: [], recurring_patterns: [],
  sessionCount: 0, nextFocus: [], updatedAt: "", studyPlan: null,
};

describe("demoPlan", () => {
  it("creates the requested rounds and question counts with unique ids", () => {
    const plan = demoPlan(config({ rounds: ["technical", "coding", "system_design"], questionsPerRound: 3 }), noHistory, []);
    expect(plan.rounds.map((r) => r.type)).toEqual(["technical", "coding", "system_design"]);
    plan.rounds.forEach((r) => expect(r.questions).toHaveLength(3));
    const ids = plan.rounds.flatMap((r) => r.questions.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("personalises prompts with the company and gives coding questions starter code", () => {
    const plan = demoPlan(config({ company: "Globex" }), noHistory, []);
    expect(JSON.stringify(plan)).toContain("Globex");
    const coding = plan.rounds.find((r) => r.type === "coding")!;
    coding.questions.forEach((q) => {
      expect(q.kind).toBe("coding");
      expect(q.starter_code).toBeTruthy();
    });
  });

  it("prefers questions that were not asked in earlier interviews", () => {
    const first = demoPlan(config({ rounds: ["behavioral"], questionsPerRound: 2 }), noHistory, []);
    const asked = first.rounds[0].questions.map((q) => q.prompt);
    const second = demoPlan(config({ rounds: ["behavioral"], questionsPerRound: 2 }), noHistory, asked);
    second.rounds[0].questions.forEach((q) => expect(asked).not.toContain(q.prompt));
  });
});

describe("demo scoring", () => {
  const plan = demoPlan(config({ rounds: ["technical"], questionsPerRound: 2 }), noHistory, []);
  const q = plan.rounds[0].questions[1]; // latency debugging question
  const interview = { plan } as Interview;
  const response = (text: string, extra: Partial<InterviewResponse> = {}) =>
    ({ ...answer({ questionId: q.id, answerText: text, ...extra }), id: text.slice(0, 8) || "empty", interviewId: "i", retries: [] }) as InterviewResponse;

  it("scores thorough answers above thin ones and zero for skips", () => {
    const strong = response(
      "First I would check recent changes and roll back the deploy to stabilise. Then I'd look at metrics and tracing to find where time goes, form and test hypotheses, check database or dependency bottlenecks such as slow queries or connection pools, fix it, verify under load, and communicate with a post-mortem. ".repeat(2),
    );
    const weak = response("I would look at logs.");
    const skipped = response("", { skipped: true });
    const round = demoEvaluateRound(interview, "technical", [strong, weak, skipped]);
    const [s, w, k] = round.question_evaluations;
    expect(s.score).toBeGreaterThan(w.score);
    expect(k).toMatchObject({ score: 0, verdict: "no_answer" });
    expect(w.missed_points.length).toBeGreaterThan(s.missed_points.length);
  });

  it("asks a follow-up only for short first answers", () => {
    expect(demoFollowUp("Too short.", false, []).ask_follow_up).toBe(true);
    expect(demoFollowUp("Too short.", true, []).ask_follow_up).toBe(false);
    expect(demoFollowUp("word ".repeat(80), false, []).ask_follow_up).toBe(false);
  });

  it("reports improvement on a better retry", () => {
    const r = demoRetry(1, "rollback the deploy, check metrics and tracing, test hypotheses about database bottlenecks, then communicate in a post-mortem", q.rubric);
    expect(r.improved).toBe(true);
    expect(r.score).toBeGreaterThan(1);
  });

  it("integrity report is independent of answer quality", () => {
    expect(computeIntegrity([]).score).toBe(100);
  });
});
