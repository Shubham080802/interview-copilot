/**
 * Assembles the speech windows that are compared with the candidate's enrolled voice.
 *
 * Chunks arrive continuously from the microphone; only those that contain speech are kept, and a
 * window is emitted once enough of them have been collected. A window must hold one continuous
 * stretch of talking: if speech from before and after a long silence were stitched together, the
 * window could mix two different people and the comparison would land between both voices.
 * Pure logic so every rule is testable.
 */

export interface AssembledWindow {
  samples: Float32Array;
  /** Median level of the chunks in the window (dBFS), used as the proximity signal. */
  levelDb: number;
}

export interface SpeechBufferOptions {
  /** Samples per emitted window. */
  windowSamples: number;
  /** Samples kept for the next (overlapping) window. */
  hopSamples: number;
  sampleRate: number;
  /** Silence after which a fragment too short to be an utterance is discarded. */
  fragmentGapMs?: number;
  /** Silence after which the current utterance is over, and anything buffered is dropped. */
  utteranceGapMs?: number;
  /** Speech shorter than this is treated as a fragment. */
  fragmentMs?: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : -60;
};

export class SpeechBuffer {
  private parts: Float32Array[] = [];
  private levels: number[] = [];
  private length = 0;
  private silentSamples = 0;

  constructor(private readonly opts: SpeechBufferOptions) {}

  private ms(samples: number) {
    return (samples / this.opts.sampleRate) * 1000;
  }

  reset() {
    this.parts = [];
    this.levels = [];
    this.length = 0;
    this.silentSamples = 0;
  }

  /**
   * Adds one analysed chunk. Returns a window as soon as enough speech has been collected.
   * @param isSpeech whether the speech detector found speech in this chunk.
   */
  add(chunk: Float32Array, levelDb: number, isSpeech: boolean): AssembledWindow | null {
    const { windowSamples, hopSamples, fragmentGapMs = 640, utteranceGapMs = 1500, fragmentMs = 500 } = this.opts;
    if (!isSpeech) {
      this.silentSamples += chunk.length;
      const gap = this.ms(this.silentSamples);
      // A short pause only discards fragments (a breath mid-sentence keeps the utterance going);
      // a long pause ends the utterance, whatever was collected.
      if (gap > utteranceGapMs || (gap > fragmentGapMs && this.ms(this.length) < fragmentMs)) {
        this.parts = [];
        this.levels = [];
        this.length = 0;
      }
      return null;
    }

    this.silentSamples = 0;
    this.parts.push(chunk);
    this.levels.push(levelDb);
    this.length += chunk.length;
    if (this.length < windowSamples) return null;

    const samples = new Float32Array(windowSamples);
    let offset = 0;
    for (const part of this.parts) {
      const take = Math.min(part.length, windowSamples - offset);
      samples.set(part.subarray(0, take), offset);
      offset += take;
      if (offset === windowSamples) break;
    }
    const levelDbOfWindow = median(this.levels);
    // Keep the tail for the next (overlapping) window.
    const keep = Math.ceil(hopSamples / chunk.length);
    this.parts = this.parts.slice(-keep);
    this.levels = this.levels.slice(-keep);
    this.length = this.parts.reduce((sum, part) => sum + part.length, 0);
    return { samples, levelDb: levelDbOfWindow };
  }
}
