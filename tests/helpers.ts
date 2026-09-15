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
