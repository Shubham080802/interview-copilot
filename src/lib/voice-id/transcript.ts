/**
 * Pairs speech-recognition results with the moments another voice was heard, so only the other
 * person's words are judged — never the candidate's own answers.
 */

export interface TranscriptEntry {
  text: string;
  at: number; // when the recognizer delivered the final text (ms)
}

export interface VoiceInterval {
  start: number;
  end: number;
}

/** Recognizers deliver final text a little after the words were spoken. */
export const RECOGNITION_DELAY_MS = 2500;

export function otherVoiceTranscript(entries: TranscriptEntry[], intervals: VoiceInterval[], delayMs = RECOGNITION_DELAY_MS): string {
  return entries
    .filter((e) => intervals.some((iv) => e.at >= iv.start && e.at <= iv.end + delayMs))
    .map((e) => e.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** Drops entries and intervals older than `maxAgeMs` so memory stays bounded during long interviews. */
export function pruneOlderThan<T extends { at?: number; end?: number }>(items: T[], now: number, maxAgeMs: number): T[] {
  return items.filter((item) => now - (item.at ?? item.end ?? now) <= maxAgeMs);
}
