import { vi, expect } from "vitest";
import * as repo from "@/lib/repo";
import { InterviewConfigSchema, type InterviewConfig } from "@/lib/schemas";
import type { InterviewResponse } from "@/lib/types";

export function config(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return InterviewConfigSchema.parse({
    field: "Software Engineering",
    role: "Backend Engineer",
    seniority: "mid",
    company: "Acme",
    requirements: "Go, PostgreSQL, Kubernetes",
    rounds: ["technical", "coding", "behavioral"],
    questionsPerRound: 2,
    ...overrides,
  });
}

export function answer(overrides: Partial<InterviewResponse> = {}): Omit<InterviewResponse, "id" | "retries" | "interviewId"> {
  const now = new Date().toISOString();
  return {
    questionId: "technical-1",
    roundType: "technical",
    prompt: "Question",
    isFollowUp: false,
    parentResponseId: null,
    answerText: "",
    code: "",
    codeLanguage: "",
    skipped: false,
    startedAt: now,
    endedAt: now,
    durationSec: 60,
    wordsPerMinute: 130,
    fillerCount: 0,
    ...overrides,
  };
}

export const waitForStatus = (id: string, status: string) =>
  vi.waitFor(async () => expect((await repo.getInterview(id))?.status).toBe(status), { timeout: 10_000, interval: 20 });

export const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

export const jsonRequest = (body: unknown) =>
  new Request("http://test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
