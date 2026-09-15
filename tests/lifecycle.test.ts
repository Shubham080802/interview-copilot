import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { toHtml, toMarkdown } from "@/lib/export";
import * as repo from "@/lib/repo";
import { recordAnswer, retryAnswer, startEvaluation, startPreparation } from "@/lib/service";
import { answer, config } from "./helpers";

const waitForStatus = (id: string, status: string) =>
  vi.waitFor(() => expect(repo.getInterview(id)?.status).toBe(status), { timeout: 5000, interval: 20 });

async function prepared(overrides = {}) {
  const interview = repo.createInterview(config(overrides));
  startPreparation(interview.id);
  await waitForStatus(interview.id, "ready");
  repo.updateInterview(interview.id, { status: "in_progress", startedAt: new Date().toISOString() });
  return repo.getInterview(interview.id)!;
}

describe("interview lifecycle (demo mode)", () => {
  it("prepares, records answers with follow-ups, evaluates, and updates long-term insights", async () => {
    const interview = await prepared();
    expect(interview.generatedBy).toBe("demo");
    const questions = interview.plan!.rounds.flatMap((r) => r.questions.map((q) => ({ q, round: r.type })));
    expect(questions).toHaveLength(6);

    const first = questions[0];
    const { response, followUp } = await recordAnswer(interview, answer({ questionId: first.q.id, roundType: first.round, prompt: first.q.prompt, answerText: "I used Go at work." }));
    expect(followUp.ask_follow_up).toBe(true);

    await recordAnswer(interview, answer({ questionId: first.q.id, roundType: first.round, prompt: followUp.follow_up_question!, isFollowUp: true, parentResponseId: response.id, answerText: "I would add better tests." }));
    for (const { q, round } of questions.slice(1)) {
      await recordAnswer(interview, answer({ questionId: q.id, roundType: round, prompt: q.prompt, answerText: `${q.ideal_answer_outline} ${q.rubric.join(", ")}` }));
    }
    repo.addProctorEvent({ interviewId: interview.id, at: new Date().toISOString(), type: "tab_hidden", severity: "medium", detail: "hidden", durationSec: 5, snapshot: null });

    startEvaluation(interview.id);
    await waitForStatus(interview.id, "completed");

    const done = repo.getInterview(interview.id)!;
    const responses = repo.listResponses(interview.id);
    expect(responses).toHaveLength(7);
    const evaluated = done.evaluation!.rounds.flatMap((r) => r.question_evaluations.map((q) => q.response_id));
    expect(new Set(evaluated)).toEqual(new Set(responses.map((r) => r.id)));
    expect(done.integrity!.counts.tab_hidden).toBe(1);
    expect(done.evaluation!.overall.overall_score).toBeGreaterThan(0);

    const insights = repo.getInsights();
    expect(insights.sessionCount).toBe(1);
    expect(insights.nextFocus.length).toBeGreaterThan(0);

    // Practice retries are stored on the response.
    const retry = await retryAnswer(done, responses[0], "A much longer answer about a concrete project example with trade-offs, pitfalls and a measurable outcome.", "");
    expect(retry.score).toBeGreaterThanOrEqual(0);
    expect(repo.getResponse(responses[0].id)!.retries).toHaveLength(1);

    // The next interview avoids repeating questions from this one.
    const next = await prepared();
    const previousPrompts = new Set(questions.map(({ q }) => q.prompt));
    const repeated = next.plan!.rounds.flatMap((r) => r.questions).filter((q) => previousPrompts.has(q.prompt));
    expect(repeated).toHaveLength(0);
  });

  it("does not touch insights when nothing was answered", async () => {
    const before = repo.getInsights().sessionCount;
    const interview = await prepared({ rounds: ["hr"], questionsPerRound: 1 });
    startEvaluation(interview.id);
    await waitForStatus(interview.id, "completed");
    expect(repo.getInterview(interview.id)!.evaluation!.rounds).toHaveLength(0);
    expect(repo.getInsights().sessionCount).toBe(before);
  });

  it("marks interviews interrupted by a server restart as failed so they can be retried", async () => {
    const interview = repo.createInterview(config());
    repo.updateInterview(interview.id, { status: "evaluating" });
    // Simulate a process restart: drop the cached connection so the next call reopens the database.
    db().close();
    delete (globalThis as { __interviewDb?: unknown }).__interviewDb;
    const reloaded = repo.getInterview(interview.id)!;
    expect(reloaded.status).toBe("failed");
    expect(reloaded.error).toMatch(/interrupted/i);
  });

  it("exports markdown and escapes user content in HTML", async () => {
    const interview = await prepared({ rounds: ["behavioral"], questionsPerRound: 1 });
    const q = interview.plan!.rounds[0].questions[0];
    await recordAnswer(interview, answer({ questionId: q.id, roundType: "behavioral", prompt: q.prompt, answerText: 'I said <script>alert("x")</script> in the meeting' }));
    startEvaluation(interview.id);
    await waitForStatus(interview.id, "completed");

    const bundle = {
      exportedAt: new Date().toISOString(),
      interview: repo.getInterview(interview.id)!,
      responses: repo.listResponses(interview.id),
      proctorEvents: [],
      coachSession: [],
    };
    const md = toMarkdown(bundle);
    expect(md).toContain("# Interview report — Backend Engineer at Acme");
    expect(md).toContain("## Question by question");
    const html = toHtml(bundle);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("rejects path-traversal style ids", () => {
    expect(repo.getInterview("../../etc/passwd")).toBeNull();
    expect(repo.isValidId("abcDEF_12-3")).toBe(true);
  });
});
