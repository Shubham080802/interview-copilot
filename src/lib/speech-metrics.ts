const FILLERS = ["um", "uh", "erm", "hmm", "like", "you know", "basically", "actually", "literally", "sort of", "kind of", "i mean"];

export function countFillers(text: string): number {
  const lower = ` ${text.toLowerCase().replace(/[^a-z\s']/g, " ")} `;
  return FILLERS.reduce((sum, f) => sum + (lower.match(new RegExp(`\\s${f}\\s`, "g"))?.length ?? 0), 0);
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function wordsPerMinute(text: string, seconds: number): number {
  if (seconds < 5) return 0;
  return Math.round((wordCount(text) / seconds) * 60);
}
