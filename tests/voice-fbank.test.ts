import { describe, expect, it } from "vitest";
import { averageEmbedding, computeFbank, cosineSimilarity, NUM_MEL_BINS, resampleTo16k } from "@/lib/voice-id/fbank";

/** Deterministic voice-like chirp (150 → 1200 Hz with harmonics), 1.5 s at 16 kHz. */
function chirp(): Float32Array {
  const signal = new Float32Array(24_000);
  for (let i = 0; i < signal.length; i++) {
    const t = i / 16_000;
    const phase = 2 * Math.PI * (150 * t + 350 * t * t);
    signal[i] = 0.3 * Math.sin(phase) + 0.1 * Math.sin(2 * phase) + 0.05 * Math.sin(3 * phase);
  }
  return signal;
}

describe("computeFbank", () => {
  it("matches the WeSpeaker reference feature extractor (transformers.js) on a fixed signal", () => {
    // Reference values generated with @huggingface/transformers WeSpeakerFeatureExtractor.
    const reference = { frames: 148, values: [[0, 0, -0.4799], [0, 40, -4.2261], [0, 79, -0.6544], [50, 10, -2.0876], [100, 25, 7.2621], [147, 60, 2.8895]] };
    const { data, frames } = computeFbank(chirp());
    expect(frames).toBe(reference.frames);
    for (const [frame, bin, value] of reference.values) {
      expect(data[frame * NUM_MEL_BINS + bin]).toBeCloseTo(value, 3);
    }
  });

  it("mean-centers every mel bin and handles audio shorter than one frame", () => {
    const { data, frames } = computeFbank(chirp());
    for (let bin = 0; bin < NUM_MEL_BINS; bin++) {
      let sum = 0;
      for (let f = 0; f < frames; f++) sum += data[f * NUM_MEL_BINS + bin];
      expect(Math.abs(sum / frames)).toBeLessThan(1e-3);
    }
    expect(computeFbank(new Float32Array(100)).frames).toBe(0);
  });
});

describe("embedding helpers", () => {
  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("averages normalized embeddings so loud and quiet windows weigh equally", () => {
    const profile = averageEmbedding([[10, 0], [0, 1]]);
    expect(cosineSimilarity(profile, [1, 1])).toBeCloseTo(1);
  });

  it("resamples 48 kHz audio to 16 kHz preserving the tone", () => {
    const input = Float32Array.from({ length: 48_000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48_000));
    const out = resampleTo16k(input, 48_000);
    expect(out.length).toBe(16_000);
    let crossings = 0;
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(438);
    expect(crossings).toBeLessThanOrEqual(442);
  });
});
