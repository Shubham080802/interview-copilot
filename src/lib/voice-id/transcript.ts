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

/** The recognized entries that fall inside a moment when another voice was heard. */
export function otherVoiceEntries(entries: TranscriptEntry[], intervals: VoiceInterval[], delayMs = RECOGNITION_DELAY_MS): TranscriptEntry[] {
  return entries.filter((e) => intervals.some((iv) => e.at >= iv.start && e.at <= iv.end + delayMs));
}

export function otherVoiceTranscript(entries: TranscriptEntry[], intervals: VoiceInterval[], delayMs = RECOGNITION_DELAY_MS): string {
  return otherVoiceEntries(entries, intervals, delayMs)
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

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean);

/**
 * Removes recognized text that is just the interviewer's own voice coming through the speakers (for
 * example the question being read out), which would otherwise look like someone repeating the question.
 */
export function withoutInterviewerEcho(entries: TranscriptEntry[], interviewerLines: string[], minOverlap = 0.6): TranscriptEntry[] {
  const spoken = new Set(interviewerLines.flatMap(words));
  return entries.filter((entry) => {
    const entryWords = words(entry.text);
    if (!entryWords.length) return false;
    const echoed = entryWords.filter((w) => spoken.has(w)).length / entryWords.length;
    return echoed < minOverlap;
  });
}
