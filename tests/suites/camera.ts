import { describe, expect, it, vi } from "vitest";
import { POST as clarifyRoute } from "@/app/api/interviews/[id]/clarify/route";
import { POST as presenceRoute } from "@/app/api/interviews/[id]/presence/route";
import { POST as proctorRoute } from "@/app/api/interviews/[id]/proctor/route";
import { GET as recordingGet, POST as recordingPost } from "@/app/api/interviews/[id]/recording/route";
import { POST as responsesRoute } from "@/app/api/interviews/[id]/responses/route";
import { POST as startRoute } from "@/app/api/interviews/[id]/start/route";
import * as repo from "@/lib/repo";
import { startPreparation } from "@/lib/service";
import { config, jsonRequest as json, routeCtx as ctx, waitForStatus } from "../helpers";

async function readyInterview() {
  const interview = await repo.createInterview(config({ rounds: ["behavioral"], questionsPerRound: 1 }));
  startPreparation(interview.id);
  await waitForStatus(interview.id, "ready");
  return (await repo.getInterview(interview.id))!;
}

const answerBody = (questionId: string) => ({
  questionId,
  roundType: "behavioral",
  prompt: "Tell me about a conflict",
  answerText: "A detailed answer",
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  endedAt: new Date().toISOString(),
});

/** Camera-on enforcement and recording parts, run against every storage backend. */
export function cameraSuite() {
  describe("camera presence", () => {
    it("is live only while a recent 'on' heartbeat exists", async () => {
      const { id } = await readyInterview();
      expect(await repo.isCameraLive(id)).toBe(false);
      await repo.setCameraPresence(id, true);
      expect(await repo.isCameraLive(id)).toBe(true);
      expect(await repo.isCameraLive(id, Date.now() + repo.CAMERA_HEARTBEAT_MAX_AGE_MS + 1000)).toBe(false);
      await repo.setCameraPresence(id, false);
      expect(await repo.isCameraLive(id)).toBe(false);
    });

    it("the interview can't start, take answers or clarifications with the camera off", async () => {
      const interview = await readyInterview();
      const q = interview.plan!.rounds[0].questions[0];

      const blockedStart = await startRoute(json({}), ctx(interview.id));
      expect(blockedStart.status).toBe(409);
      expect((await blockedStart.json()).code).toBe("camera_required");

      expect((await presenceRoute(json({ cameraOn: true }), ctx(interview.id))).status).toBe(200);
      expect((await startRoute(json({}), ctx(interview.id))).status).toBe(200);
      expect((await responsesRoute(json(answerBody(q.id)), ctx(interview.id))).status).toBe(200);

      await presenceRoute(json({ cameraOn: false }), ctx(interview.id));
      const blockedAnswer = await responsesRoute(json(answerBody(q.id)), ctx(interview.id));
      expect(blockedAnswer.status).toBe(409);
      expect((await blockedAnswer.json()).error).toMatch(/camera must be on/i);
      expect((await clarifyRoute(json({ questionId: q.id, prompt: q.prompt, question: "Any situation?" }), ctx(interview.id))).status).toBe(409);
      expect(await repo.listResponses(interview.id)).toHaveLength(1);

      await presenceRoute(json({ cameraOn: true }), ctx(interview.id));
      expect((await clarifyRoute(json({ questionId: q.id, prompt: q.prompt, question: "Any situation?" }), ctx(interview.id))).status).toBe(200);
    });

    it("a stale heartbeat blocks answers", async () => {
      const interview = await readyInterview();
      await presenceRoute(json({ cameraOn: true }), ctx(interview.id));
      await startRoute(json({}), ctx(interview.id));
      vi.useFakeTimers({ now: Date.now() + repo.CAMERA_HEARTBEAT_MAX_AGE_MS + 5000, toFake: ["Date"] });
      try {
        const res = await responsesRoute(json(answerBody(interview.plan!.rounds[0].questions[0].id)), ctx(interview.id));
        expect(res.status).toBe(409);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("automatic termination (another voice after a warning)", () => {
    it("records other-voice events and refuses to continue once terminated", async () => {
      const interview = await readyInterview();
      const q = interview.plan!.rounds[0].questions[0];
      await presenceRoute(json({ cameraOn: true }), ctx(interview.id));
      expect((await startRoute(json({}), ctx(interview.id))).status).toBe(200);

      const event = (type: string, detail: string) => ({ at: new Date().toISOString(), type, severity: "high", detail, durationSec: 0, snapshot: null });
      expect((await proctorRoute(json([event("other_voice", "Another voice detected nearby (similarity 0.12)")]), ctx(interview.id))).status).toBe(200);
      expect(await repo.getTermination(interview.id)).toBeNull();
      expect((await responsesRoute(json(answerBody(q.id)), ctx(interview.id))).status).toBe(200); // a warning alone doesn't stop the interview

      const reason = "another voice was heard again within 2 minutes of a warning";
      await proctorRoute(json([event("other_voice", "Another voice detected nearby (similarity 0.09)"), event("terminated", reason)]), ctx(interview.id));
      expect((await repo.getTermination(interview.id))?.detail).toBe(reason);

      for (const res of [
        await responsesRoute(json(answerBody(q.id)), ctx(interview.id)),
        await clarifyRoute(json({ questionId: q.id, prompt: q.prompt, question: "Can I continue?" }), ctx(interview.id)),
        await startRoute(json({}), ctx(interview.id)),
      ]) {
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("terminated");
      }
      expect(await repo.listResponses(interview.id)).toHaveLength(1);
    });

    it("rejects unknown proctoring event types", async () => {
      const interview = await readyInterview();
      await presenceRoute(json({ cameraOn: true }), ctx(interview.id));
      await startRoute(json({}), ctx(interview.id));
      const res = await proctorRoute(json([{ at: new Date().toISOString(), type: "made_up", severity: "high", detail: "", durationSec: 0, snapshot: null }]), ctx(interview.id));
      expect(res.status).toBe(400);
    });
  });

  describe("recording parts", () => {
    it("stores each reconnect as a separate part and serves them with range support", async () => {
      const interview = await readyInterview();
      await presenceRoute(json({ cameraOn: true }), ctx(interview.id));
      await startRoute(json({}), ctx(interview.id));

      const chunk = (segment: number, seq: number, text: string) =>
        recordingPost(new Request("http://test", { method: "POST", headers: { "x-seq": String(seq), "x-segment": String(segment) }, body: text }), ctx(interview.id));
      await chunk(1, 0, "part-one-");
      await chunk(1, 1, "more");
      await chunk(1, 2, "-end");
      await chunk(2, 0, "part-two");
      expect((await chunk(99, 0, "x")).status).toBe(400);

      expect((await repo.getInterview(interview.id))!.recordingSegments).toEqual([1, 2]);
      const part1 = await recordingGet(new Request("http://test?segment=1"), ctx(interview.id));
      expect(part1.headers.get("content-type")).toBe("audio/webm"); // voice conversation only, no video
      expect(await part1.text()).toBe("part-one-more-end");
      expect(await (await recordingGet(new Request("http://test?segment=2"), ctx(interview.id))).text()).toBe("part-two");
      expect((await recordingGet(new Request("http://test?segment=3"), ctx(interview.id))).status).toBe(404);

      // Range spanning chunk boundaries: bytes 5..14 of "part-one-more-end" → "one-more-e"
      const ranged = await recordingGet(new Request("http://test?segment=1", { headers: { range: "bytes=5-14" } }), ctx(interview.id));
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toBe("bytes 5-14/17");
      expect(await ranged.text()).toBe("one-more-e");

      // Restarting a part (seq 0) replaces its previous content.
      await chunk(2, 0, "fresh");
      expect(await (await recordingGet(new Request("http://test?segment=2"), ctx(interview.id))).text()).toBe("fresh");

      await repo.deleteInterview(interview.id);
      expect(await repo.openRecording(interview.id, 1)).toBeNull();
      expect(await repo.openRecording(interview.id, 2)).toBeNull();
    });
  });
}
