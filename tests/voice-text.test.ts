import { describe, expect, it } from "vitest";
import { splitIntoSpeechChunks, trimSilence } from "@/lib/voice-text";

describe("splitIntoSpeechChunks", () => {
  it("splits interviewer speech into sentences so playback can start early", () => {
    expect(splitIntoSpeechChunks("Hi, I'm Alex.  Tell me about a conflict!   Why did it happen?")).toEqual([
      "Hi, I'm Alex.",
      "Tell me about a conflict!",
      "Why did it happen?",
    ]);
  });

  it("keeps trailing text without punctuation and ignores empty input", () => {
    expect(splitIntoSpeechChunks("Walk me through your approach")).toEqual(["Walk me through your approach"]);
    expect(splitIntoSpeechChunks("   ")).toEqual([]);
  });

  it("breaks very long sentences at commas or spaces without losing words", () => {
    const long = `${"We will discuss scaling, caching, queues, databases and trade-offs in depth, ".repeat(6)}and then wrap up.`;
    const chunks = splitIntoSpeechChunks(long, 120);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " ").trim());
  });
});

describe("trimSilence", () => {
  it("removes leading and trailing silence but keeps a short margin", () => {
    const rate = 1000;
    const samples = new Float32Array(1000);
    samples.fill(0.5, 400, 600); // speech from 0.4 s to 0.6 s
    const trimmed = trimSilence(samples, rate, 0.01, 50);
    expect(trimmed.length).toBe(200 + 2 * 50);
    expect(trimmed[50]).toBe(0.5);
  });

  it("returns nothing for pure silence", () => {
    expect(trimSilence(new Float32Array(100), 1000)).toHaveLength(0);
  });
});
