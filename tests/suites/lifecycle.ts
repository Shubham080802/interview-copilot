import { describe, expect, it } from "vitest";
import { toHtml, toMarkdown } from "@/lib/export";
import * as repo from "@/lib/repo";
import { recordAnswer, retryAnswer, startEvaluation, startPreparation } from "@/lib/service";
import { answer, config, waitForStatus } from "../helpers";

async function prepared(overrides = {}) {
  const interview = await repo.createInterview(config(overrides));
  startPreparation(interview.id);
  await waitForStatus(interview.id, "ready");
  await repo.updateInterview(interview.id, { status: "in_progress", startedAt: new Date().toISOString() });
  return (await repo.getInterview(interview.id))!;
}

/** End-to-end interview behaviour, run against every storage backend. */
export function lifecycleSuite() {
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
      await repo.addProctorEvent({ interviewId: interview.id, at: new Date().toISOString(), type: "tab_hidden", severity: "medium", detail: "hidden", durationSec: 5, snapshot: null });

      startEvaluation(interview.id);
      await waitForStatus(interview.id, "completed");

      const done = (await repo.getInterview(interview.id))!;
      const responses = await repo.listResponses(interview.id);
      expect(responses).toHaveLength(7);
      expect(responses[1].isFollowUp).toBe(true); // insertion order preserved
      const evaluated = done.evaluation!.rounds.flatMap((r) => r.question_evaluations.map((q) => q.response_id));
      expect(new Set(evaluated)).toEqual(new Set(responses.map((r) => r.id)));
      expect(done.integrity!.counts.tab_hidden).toBe(1);
      expect(done.evaluation!.overall.overall_score).toBeGreaterThan(0);

      const insights = await repo.getInsights();
      expect(insights.sessionCount).toBe(1);
      expect(insights.nextFocus.length).toBeGreaterThan(0);

      const retry = await retryAnswer(done, responses[0], "A much longer answer about a concrete project example with trade-offs, pitfalls and a measurable outcome.", "");
      expect(retry.score).toBeGreaterThanOrEqual(0);
      expect((await repo.getResponse(responses[0].id))!.retries).toHaveLength(1);

      const next = await prepared();
      const previousPrompts = new Set(questions.map(({ q }) => q.prompt));
      const repeated = next.plan!.rounds.flatMap((r) => r.questions).filter((q) => previousPrompts.has(q.prompt));
      expect(repeated).toHaveLength(0);
    });

    it("does not touch insights when nothing was answered", async () => {
      const before = (await repo.getInsights()).sessionCount;
      const interview = await prepared({ rounds: ["hr"], questionsPerRound: 1 });
      startEvaluation(interview.id);
      await waitForStatus(interview.id, "completed");
      expect((await repo.getInterview(interview.id))!.evaluation!.rounds).toHaveLength(0);
      expect((await repo.getInsights()).sessionCount).toBe(before);
    });

    it("keeps profile, coach chat order, snapshots and deletes everything for an interview", async () => {
      await repo.saveProfile({ name: "Priya", headline: "Engineer", experienceYears: 5, resume: "Go" });
      expect((await repo.getProfile()).name).toBe("Priya");

      const interview = await prepared({ rounds: ["behavioral"], questionsPerRound: 1 });
      for (const [role, text] of [["user", "first"], ["assistant", "second"], ["user", "third"]] as const) {
        await repo.addCoachMessage(interview.id, role, text);
      }
      expect((await repo.listCoachMessages(interview.id)).map((m) => m.content)).toEqual(["first", "second", "third"]);

      const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")}`;
      const snapshot = (await repo.saveSnapshot(jpeg))!;
      expect(await repo.getSnapshot(snapshot)).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
      expect(await repo.getSnapshot("../../etc/passwd")).toBeNull();
      await repo.addProctorEvent({ interviewId: interview.id, at: new Date().toISOString(), type: "no_face", severity: "high", detail: "", durationSec: 4, snapshot });
      await repo.appendRecordingChunk(interview.id, 1, 0, new Uint8Array([1, 2, 3]));

      await repo.deleteInterview(interview.id);
      expect(await repo.getInterview(interview.id)).toBeNull();
      expect(await repo.listCoachMessages(interview.id)).toHaveLength(0);
      expect(await repo.listProctorEvents(interview.id)).toHaveLength(0);
      expect(await repo.getSnapshot(snapshot)).toBeNull();
      expect(await repo.openRecording(interview.id, 1)).toBeNull();
    });

    it("exports markdown and escapes user content in HTML", async () => {
      const interview = await prepared({ rounds: ["behavioral"], questionsPerRound: 1 });
      const q = interview.plan!.rounds[0].questions[0];
      await recordAnswer(interview, answer({ questionId: q.id, roundType: "behavioral", prompt: q.prompt, answerText: 'I said <script>alert("x")</script> in the meeting' }));
      startEvaluation(interview.id);
      await waitForStatus(interview.id, "completed");

      const bundle = {
        exportedAt: new Date().toISOString(),
        interview: (await repo.getInterview(interview.id))!,
        responses: await repo.listResponses(interview.id),
        proctorEvents: [],
        coachSession: [],
      };
      expect(toMarkdown(bundle)).toContain("## Question by question");
      const html = toHtml(bundle);
      expect(html).not.toContain("<script>alert");
      expect(html).toContain("&lt;script&gt;");
    });

    it("rejects path-traversal style ids", async () => {
      expect(await repo.getInterview("../../etc/passwd")).toBeNull();
      expect(repo.isValidId("abcDEF_12-3")).toBe(true);
    });
  });
}
