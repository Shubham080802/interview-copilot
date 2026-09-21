import { describe, expect, it } from "vitest";
import { SpeechBuffer } from "@/lib/voice-id/speech-buffer";

const SAMPLE_RATE = 16_000;
const CHUNK = 512; // 32 ms
const WINDOW = 2 * SAMPLE_RATE;
const HOP = SAMPLE_RATE;

const buffer = () => new SpeechBuffer({ windowSamples: WINDOW, hopSamples: HOP, sampleRate: SAMPLE_RATE });
/** A chunk filled with a constant value, so the origin of every sample in a window is recognisable. */
const chunkOf = (value: number) => new Float32Array(CHUNK).fill(value);

function speak(b: SpeechBuffer, seconds: number, value: number, levelDb = -20) {
  const windows = [];
  for (let i = 0; i < Math.round((seconds * SAMPLE_RATE) / CHUNK); i++) {
    const window = b.add(chunkOf(value), levelDb, true);
    if (window) windows.push(window);
  }
  return windows;
}

function silence(b: SpeechBuffer, seconds: number) {
  for (let i = 0; i < Math.round((seconds * SAMPLE_RATE) / CHUNK); i++) b.add(chunkOf(0), -70, false);
}

describe("speech window assembly", () => {
  it("emits a window once two seconds of speech are collected", () => {
    const b = buffer();
    expect(speak(b, 1.5, 0.5)).toHaveLength(0);
    const windows = speak(b, 0.6, 0.5);
    expect(windows).toHaveLength(1);
    expect(windows[0].samples).toHaveLength(WINDOW);
    expect(windows[0].levelDb).toBe(-20);
  });

  it("never mixes speech from before and after a long pause in one window", () => {
    const b = buffer();
    speak(b, 1.5, 0.5); // the candidate says something short
    silence(b, 30); // …then stops for half a minute
    const windows = speak(b, 2.1, -0.5); // somebody else starts talking
    expect(windows).toHaveLength(1);
    // Every sample must come from the second speaker, not from the stale buffer.
    expect([...windows[0].samples].every((s) => s === -0.5)).toBe(true);
  });

  it("keeps an utterance together across a breath-length pause", () => {
    const b = buffer();
    speak(b, 1.5, 0.5);
    silence(b, 0.3);
    const windows = speak(b, 0.6, 0.5);
    expect(windows).toHaveLength(1);
  });

  it("discards a fragment that is followed by a pause", () => {
    const b = buffer();
    speak(b, 0.3, 0.5);
    silence(b, 0.8);
    expect(speak(b, 1.8, 0.5)).toHaveLength(0); // the fragment no longer counts towards the window
  });

  it("overlaps consecutive windows by the hop length", () => {
    const b = buffer();
    expect(speak(b, 2.05, 0.5)).toHaveLength(1);
    expect(speak(b, 1.05, 0.5)).toHaveLength(1); // only one more second of speech is needed
  });

  it("reports the median level of the window", () => {
    const b = buffer();
    speak(b, 1, 0.5, -40);
    const windows = speak(b, 1.1, 0.5, -10);
    expect(windows).toHaveLength(1);
    expect(windows[0].levelDb).toBeLessThanOrEqual(-10);
    expect(windows[0].levelDb).toBeGreaterThanOrEqual(-40);
  });

  it("forgets everything on reset", () => {
    const b = buffer();
    speak(b, 1.9, 0.5);
    b.reset();
    expect(speak(b, 1.9, 0.5)).toHaveLength(0);
  });
});
