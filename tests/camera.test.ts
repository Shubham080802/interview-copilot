import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { POST as clarifyRoute } from "@/app/api/interviews/[id]/clarify/route";
import { POST as presenceRoute } from "@/app/api/interviews/[id]/presence/route";
import { GET as recordingGet, POST as recordingPost } from "@/app/api/interviews/[id]/recording/route";
import { POST as responsesRoute } from "@/app/api/interviews/[id]/responses/route";
import { POST as startRoute } from "@/app/api/interviews/[id]/start/route";
import { computeIntegrity } from "@/lib/integrity";
import * as repo from "@/lib/repo";
import { startPreparation } from "@/lib/service";
import { config } from "./helpers";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown) => new Request("http://test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function readyInterview() {
  const interview = repo.createInterview(config({ rounds: ["behavioral"], questionsPerRound: 1 }));
  startPreparation(interview.id);
  await vi.waitFor(() => expect(repo.getInterview(interview.id)?.status).toBe("ready"), { timeout: 5000, interval: 20 });
  return repo.getInterview(interview.id)!;
}

const answerBody = (questionId: string) => ({
  questionId,
  roundType: "behavioral",
  prompt: "Tell me about a conflict",
  answerText: "A detailed answer",
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  endedAt: new Date().toISOString(),
});

describe("camera presence", () => {
  it("is live only while a recent 'on' heartbeat exists", async () => {
    const { id } = await readyInterview();
    expect(repo.isCameraLive(id)).toBe(false);
    repo.setCameraPresence(id, true);
    expect(repo.isCameraLive(id)).toBe(true);
    expect(repo.isCameraLive(id, Date.now() + repo.CAMERA_HEARTBEAT_MAX_AGE_MS + 1000)).toBe(false);
    repo.setCameraPresence(id, false);
    expect(repo.isCameraLive(id)).toBe(false);
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

    // Camera turns off mid-interview.
    await presenceRoute(json({ cameraOn: false }), ctx(interview.id));
    const blockedAnswer = await responsesRoute(json(answerBody(q.id)), ctx(interview.id));
    expect(blockedAnswer.status).toBe(409);
    expect((await blockedAnswer.json()).error).toMatch(/camera must be on/i);
    const blockedClarify = await clarifyRoute(json({ questionId: q.id, prompt: q.prompt, question: "Any situation?" }), ctx(interview.id));
    expect(blockedClarify.status).toBe(409);
    expect(repo.listResponses(interview.id)).toHaveLength(1);

    // Camera back on.
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

  it("camera-off gaps lower integrity and are explained", () => {
    const report = computeIntegrity([
      { id: "e", interviewId: "i", at: new Date().toISOString(), type: "camera_off", severity: "high", detail: "Camera covered for 40s", durationSec: 40, snapshot: null },
    ]);
    expect(report.score).toBeLessThan(80);
    expect(report.awaySeconds).toBe(40);
    expect(report.notes.join(" ")).toMatch(/camera was off 1 time\(s\), about 40s/);
  });
});

describe("recording parts", () => {
  it("stores each reconnect as a separate part and serves them individually", async () => {
    const interview = await readyInterview();
    await presenceRoute(json({ cameraOn: true }), ctx(interview.id));
    await startRoute(json({}), ctx(interview.id));

    const chunk = (segment: number, seq: number, text: string) =>
      recordingPost(new Request("http://test", { method: "POST", headers: { "x-seq": String(seq), "x-segment": String(segment) }, body: text }), ctx(interview.id));
    await chunk(1, 0, "part-one-");
    await chunk(1, 1, "more");
    await chunk(2, 0, "part-two");
    expect((await chunk(99, 0, "x")).status).toBe(400);

    const saved = repo.getInterview(interview.id)!;
    expect(saved.recordingSegments).toEqual([1, 2]);
    expect(await (await recordingGet(new Request("http://test?segment=1"), ctx(interview.id))).text()).toBe("part-one-more");
    expect(await (await recordingGet(new Request("http://test?segment=2"), ctx(interview.id))).text()).toBe("part-two");
    expect((await recordingGet(new Request("http://test?segment=3"), ctx(interview.id))).status).toBe(404);

    repo.deleteInterview(interview.id);
    expect(fs.existsSync(repo.recordingPath(interview.id, 1))).toBe(false);
    expect(fs.existsSync(repo.recordingPath(interview.id, 2))).toBe(false);
  });
});
