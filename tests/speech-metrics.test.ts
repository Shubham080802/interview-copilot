import { describe, expect, it } from "vitest";
import { countFillers, wordCount, wordsPerMinute } from "@/lib/speech-metrics";

describe("speech metrics", () => {
  it("counts filler words and phrases", () => {
    expect(countFillers("Um, so I basically, you know, like built it")).toBe(4);
    expect(countFillers("I designed the likelihood model")).toBe(0);
  });

  it("counts words", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  one two   three ")).toBe(3);
  });

  it("computes speaking pace and ignores very short durations", () => {
    expect(wordsPerMinute("word ".repeat(150), 60)).toBe(150);
    expect(wordsPerMinute("hello there", 2)).toBe(0);
  });
});
