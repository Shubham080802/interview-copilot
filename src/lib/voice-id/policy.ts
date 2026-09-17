/**
 * Decides when speech that doesn't match the candidate's enrolled voice becomes a warning, and when
 * a repeat within the warning window terminates the interview. Pure logic so every rule is testable.
 */

export const OTHER_VOICE_POLICY = {
  /** Cosine similarity below this means "not the candidate". Calibrated: same-speaker windows ≥ 0.64. */
  similarityThreshold: 0.45,
  /**
   * A microphone can't measure distance; loudness relative to the candidate's own voice is used as a
   * proxy. Sound drops ~26 dB between 0.5 m (candidate) and 10 m, so quieter speech is ignored.
   */
  proximityDb: 26,
  /** Mismatched speech windows needed to count as a detection (reduces false alarms)... */
  windowsToConfirm: 2,
  /** ...within this span. */
  confirmSpanMs: 15_000,
  /** After a warning, another detection within this window ends the interview. */
  warningMs: 120_000,
} as const;

export interface SpeechWindow {
  at: number; // ms timestamp when the window ended
  similarity: number;
  levelDb: number; // RMS level of the speech window (dBFS)
}

export type VoiceDecision =
  | { kind: "none" }
  | { kind: "warn"; warningEndsAt: number; similarity: number }
  | { kind: "terminate"; similarity: number };

export class OtherVoicePolicy {
  private mismatches: number[] = [];
  private warningEndsAt: number | null = null;
  private terminated = false;

  constructor(
    private readonly candidateLevelDb: number,
    private readonly config: typeof OTHER_VOICE_POLICY = OTHER_VOICE_POLICY,
  ) {}

  /** True if this window looks like a different person close enough to be in the room. */
  isOtherNearbyVoice(window: SpeechWindow): boolean {
    return window.similarity < this.config.similarityThreshold && window.levelDb >= this.candidateLevelDb - this.config.proximityDb;
  }

  observe(window: SpeechWindow): VoiceDecision {
    if (this.terminated) return { kind: "none" };
    if (this.warningEndsAt !== null && window.at > this.warningEndsAt) this.warningEndsAt = null;
    if (!this.isOtherNearbyVoice(window)) return { kind: "none" };

    this.mismatches = this.mismatches.filter((t) => window.at - t <= this.config.confirmSpanMs);
    this.mismatches.push(window.at);
    if (this.mismatches.length < this.config.windowsToConfirm) return { kind: "none" };
    this.mismatches = [];

    if (this.warningEndsAt !== null) {
      this.terminated = true;
      return { kind: "terminate", similarity: window.similarity };
    }
    this.warningEndsAt = window.at + this.config.warningMs;
    return { kind: "warn", warningEndsAt: this.warningEndsAt, similarity: window.similarity };
  }

  /** Remaining warning time in ms, or 0 when no warning is active. */
  warningRemaining(now: number): number {
    if (this.warningEndsAt === null || now > this.warningEndsAt) return 0;
    return this.warningEndsAt - now;
  }

  /** Time spent paused (e.g. camera off) shouldn't use up the candidate's warning window. */
  extendWarning(ms: number) {
    if (this.warningEndsAt !== null) this.warningEndsAt += ms;
  }
}
