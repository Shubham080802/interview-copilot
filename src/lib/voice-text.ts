/**
 * Splits interviewer speech into sentence-sized chunks so the first sentence can start playing
 * while the rest is still being synthesized. Very long sentences are split at commas/spaces.
 */
export function splitIntoSpeechChunks(text: string, maxChars = 220): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];

  const chunks: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
      const at = cut > maxChars / 3 ? cut + 1 : window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : maxChars;
      chunks.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) chunks.push(rest);
  }
  return chunks;
}
