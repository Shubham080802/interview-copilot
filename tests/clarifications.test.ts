import { describe, expect, it } from "vitest";
import { demoClarification } from "@/lib/demo";
import { toMarkdown } from "@/lib/export";
import * as repo from "@/lib/repo";
import { clarify, recordAnswer, startEvaluation, startPreparation } from "@/lib/service";
import { answer, config, waitForStatus } from "./helpers";

describe("clarifying questions", () => {
  it("answers scope questions but won't hand over the solution", () => {
    expect(demoClarification("coding", "Can the array contain duplicates?").reply).toMatch(/duplicates/);
    const refusal = demoClarification("coding", "Can you just tell me the solution?");
    expect(refusal.reply).toMatch(/approach/);
    expect(refusal.gave_hint).toBe(false);
  });

  it("are stored with the answer, credited in scoring and included in the report", async () => {
    const interview = await repo.createInterview(config({ rounds: ["coding"], questionsPerRound: 1 }));
    startPreparation(interview.id);
    await waitForStatus(interview.id, "ready");
    await repo.updateInterview(interview.id, { status: "in_progress" });
    const ready = (await repo.getInterview(interview.id))!;
    const q = ready.plan!.rounds[0].questions[0];

    const reply = await clarify(ready, { questionId: q.id, prompt: q.prompt, candidateQuestion: "Is the input sorted?", previous: [] });
    expect(reply.reply.length).toBeGreaterThan(10);
    const clarification = { at: new Date().toISOString(), question: "Is the input sorted?", reply: reply.reply, gaveHint: reply.gave_hint };

    await recordAnswer(ready, answer({ questionId: q.id, roundType: "coding", prompt: q.prompt, answerText: q.rubric.join(". "), clarifications: [clarification] }));
    startEvaluation(interview.id);
    await waitForStatus(interview.id, "completed");

    const [response] = await repo.listResponses(interview.id);
    expect(response.clarifications).toEqual([clarification]);
    const evaluation = (await repo.getInterview(interview.id))!.evaluation!.rounds[0].question_evaluations[0];
    expect(evaluation.strengths).toContain("Asked clarifying questions before answering");

    const md = toMarkdown({ exportedAt: "", interview: (await repo.getInterview(interview.id))!, responses: [response], proctorEvents: [], coachSession: [] });
    expect(md).toContain("**Clarifying questions**");
    expect(md).toContain("Is the input sorted?");
  });
});
