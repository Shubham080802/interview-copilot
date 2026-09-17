import { describe, expect, it } from "vitest";
import { otherVoiceTranscript, pruneOlderThan, RECOGNITION_DELAY_MS, wordCount } from "@/lib/voice-id/transcript";

describe("otherVoiceTranscript", () => {
  const entries = [
    { text: "I would start by clarifying the constraints", at: 1_000 }, // candidate
    { text: "use a hash map", at: 12_500 }, // other voice, delivered shortly after its window
    { text: "store the index", at: 14_000 }, // other voice
    { text: "so the complexity is linear", at: 30_000 }, // candidate again
  ];
  const intervals = [{ start: 9_000, end: 11_000 }, { start: 12_000, end: 14_000 }];

  it("keeps only words recognized while another voice was heard (allowing recognition delay)", () => {
    expect(otherVoiceTranscript(entries, intervals)).toBe("use a hash map store the index");
  });

  it("ignores text delivered after the recognition delay", () => {
    expect(otherVoiceTranscript([{ text: "late", at: 11_000 + RECOGNITION_DELAY_MS + 1 }], [{ start: 9_000, end: 11_000 }])).toBe("");
  });

  it("returns nothing without other-voice intervals", () => {
    expect(otherVoiceTranscript(entries, [])).toBe("");
  });
});

describe("helpers", () => {
  it("counts words and prunes old items", () => {
    expect(wordCount("  use a  hash map ")).toBe(4);
    expect(wordCount("")).toBe(0);
    expect(pruneOlderThan([{ at: 0 }, { at: 50_000 }], 60_000, 30_000)).toEqual([{ at: 50_000 }]);
    expect(pruneOlderThan([{ end: 0 }, { end: 45_000 }], 60_000, 30_000)).toEqual([{ end: 45_000 }]);
  });
});
