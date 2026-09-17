import { describe, expect, it } from "vitest";
import { POST as assistRoute } from "@/app/api/interviews/[id]/assist-check/route";
import { POST as finishRoute } from "@/app/api/interviews/[id]/finish/route";
import { POST as presenceRoute } from "@/app/api/interviews/[id]/presence/route";
import { POST as proctorRoute } from "@/app/api/interviews/[id]/proctor/route";
import { POST as responsesRoute } from "@/app/api/interviews/[id]/responses/route";
import { POST as startRoute } from "@/app/api/interviews/[id]/start/route";
import * as repo from "@/lib/repo";
import { startPreparation } from "@/lib/service";
import { config, jsonRequest as json, routeCtx as ctx, waitForStatus } from "../helpers";

async function codingInterviewInProgress() {
  const interview = await repo.createInterview(config({ rounds: ["coding"], questionsPerRound: 1 }));
  startPreparation(interview.id);
  await waitForStatus(interview.id, "ready");
  await presenceRoute(json({ cameraOn: true }), ctx(interview.id));
  await startRoute(json({}), ctx(interview.id));
  const ready = (await repo.getInterview(interview.id))!;
  return { interview: ready, question: ready.plan!.rounds[0].questions[0] };
}

/** Cancelling interviews when someone nearby is helping, run against every storage backend. */
export function assistanceSuite() {
  describe("someone nearby helping the candidate", () => {
    it("cancels the interview with 'Cheating determined. Good Bye' and keeps the evidence", async () => {
      const { interview, question } = await codingInterviewInProgress();
      const insightsBefore = (await repo.getInsights()).sessionCount;
      const res = await assistRoute(
        // Someone nearby reads out the model answer for whichever question was asked.
        json({ questionId: question.id, prompt: question.prompt, transcript: `just tell them: ${question.ideal_answer_outline}` }),
        ctx(interview.id),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ cancelled: true, message: "Cheating determined. Good Bye", verdict: "high" });

      const cancelled = (await repo.getInterview(interview.id))!;
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.endedAt).toBeTruthy();
      expect(cancelled.integrity).toMatchObject({ score: 0, level: "high_risk", cheatingDetermined: true });
      expect(cancelled.integrity!.terminatedReason).toMatch(/cheating determined/);
      const events = await repo.listProctorEvents(interview.id);
      expect(events.find((e) => e.type === "assistance")?.detail).toContain(question.ideal_answer_outline.slice(0, 30));
      expect(events.some((e) => e.type === "terminated")).toBe(true);

      // It can't be continued, re-checked or evaluated, and doesn't feed the long-term profile.
      const answer = await responsesRoute(json({ questionId: question.id, roundType: "coding", prompt: question.prompt, answerText: "x", startedAt: new Date().toISOString(), endedAt: new Date().toISOString() }), ctx(interview.id));
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect((await assistRoute(json({ questionId: question.id, prompt: question.prompt, transcript: `tell them ${question.ideal_answer_outline}` }), ctx(interview.id))).status).toBeGreaterThanOrEqual(400);
      await finishRoute(json({}), ctx(interview.id));
      const after = (await repo.getInterview(interview.id))!;
      expect(after.status).toBe("cancelled");
      expect(after.evaluation).toBeNull();
      expect((await repo.getInsights()).sessionCount).toBe(insightsBefore);
    });

    it("still records proctoring evidence queued just before the cancellation, but not afterwards", async () => {
      const { interview, question } = await codingInterviewInProgress();
      const warnedAt = new Date().toISOString();
      await assistRoute(json({ questionId: question.id, prompt: question.prompt, transcript: `just tell them: ${question.ideal_answer_outline}` }), ctx(interview.id));
      const later = new Date(Date.now() + 60_000).toISOString();
      const event = (at: string, type: string) => ({ at, type, severity: "high", detail: "queued", durationSec: 0, snapshot: null });
      const res = await proctorRoute(json([event(warnedAt, "other_voice"), event(later, "other_voice"), event(warnedAt, "terminated")]), ctx(interview.id));
      expect((await res.json()).accepted).toBe(1);
      const cancelled = (await repo.getInterview(interview.id))!;
      expect(cancelled.integrity!.counts.other_voice).toBe(1);
      expect(cancelled.integrity!.cheatingDetermined).toBe(true);
    });

    it("lets the interview continue when the speech isn't about the interview", async () => {
      const { interview, question } = await codingInterviewInProgress();
      const res = await assistRoute(json({ questionId: question.id, prompt: question.prompt, transcript: "dinner is ready, do you want some tea" }), ctx(interview.id));
      expect(await res.json()).toMatchObject({ cancelled: false, verdict: "low" });
      expect((await repo.getInterview(interview.id))!.status).toBe("in_progress");
      expect(await repo.listProctorEvents(interview.id)).toHaveLength(0);
    });

    it("keeps weaker, topic-related speech as evidence without cancelling", async () => {
      const { interview, question } = await codingInterviewInProgress();
      const res = await assistRoute(json({ questionId: question.id, prompt: question.prompt, transcript: `is that the ${question.topic} problem again` }), ctx(interview.id));
      const body = await res.json();
      expect(body.cancelled).toBe(false);
      expect((await repo.getInterview(interview.id))!.status).toBe("in_progress");
      if (body.verdict === "medium") {
        const [event] = await repo.listProctorEvents(interview.id);
        expect(event).toMatchObject({ type: "assistance", severity: "medium" });
      }
    });
  });
}
