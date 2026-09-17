import { describe, expect, it } from "vitest";
import type { PlanQuestion } from "@/lib/schemas";
import { heuristicAssistanceCheck, isCheating } from "@/lib/voice-id/assistance";

const twoSum: PlanQuestion = {
  id: "coding-1",
  prompt: "Given an array of integers and a target, return the indices of two numbers that add up to the target.",
  kind: "coding",
  topic: "Arrays & hashing",
  difficulty: "easy",
  why_asked: "",
  rubric: ["clarify constraints", "brute force first", "hash map O(n) solution", "edge cases (duplicates, no answer)", "complexity analysis"],
  ideal_answer_outline: "Use a hash map from value to index; for each number check whether target minus the number is already present.",
  follow_up_hints: ["What if the array were sorted?"],
  time_limit_seconds: 900,
  starter_code: null,
  language_hint: null,
};

const check = (transcript: string, question: PlanQuestion | null = twoSum) =>
  heuristicAssistanceCheck({ transcript, question, prompt: question?.prompt ?? "Tell me about yourself" });

describe("heuristicAssistanceCheck", () => {
  it("flags someone feeding the candidate the solution as cheating", () => {
    const result = check("just tell them to use a hash map, store each number with its index and check the target minus the number");
    expect(result).toMatchObject({ related_to_interview: true, helping_candidate: true, confidence: "high" });
    expect(isCheating(result)).toBe(true);
    expect(result.evidence_quote).toContain("hash map");
  });

  it("does not flag unrelated conversation nearby", () => {
    for (const speech of ["hey dinner is ready, do you want some tea", "I'm going to the store, back in ten minutes", "can you turn the television down please"]) {
      const result = check(speech);
      expect(result.helping_candidate).toBe(false);
      expect(isCheating(result)).toBe(false);
    }
  });

  it("does not treat encouragement as help", () => {
    expect(isCheating(check("good luck, you've got this, you will do great"))).toBe(false);
  });

  it("is conservative about a single incidental topic word", () => {
    const result = check("where did you put the map of the city");
    expect(isCheating(result)).toBe(false);
  });

  it("keeps weaker topic overlap as a non-cancelling verdict", () => {
    const result = check("that array of numbers thing again");
    expect(result.confidence).not.toBe("high");
    expect(isCheating(result)).toBe(false);
  });

  it("only cancels on a high-confidence related and helping verdict", () => {
    expect(isCheating({ related_to_interview: true, helping_candidate: true, confidence: "medium", reason: "", evidence_quote: "" })).toBe(false);
    expect(isCheating({ related_to_interview: false, helping_candidate: true, confidence: "high", reason: "", evidence_quote: "" })).toBe(false);
    expect(isCheating({ related_to_interview: true, helping_candidate: true, confidence: "high", reason: "", evidence_quote: "" })).toBe(true);
  });
});
