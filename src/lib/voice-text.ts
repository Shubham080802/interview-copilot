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

/**
 * Removes the silence a speech model adds before and after each sentence, keeping a short natural
 * margin, so the pauses between sentences can be controlled and sound human.
 */
export function trimSilence(samples: Float32Array, sampleRate: number, threshold = 0.008, marginMs = 60): Float32Array {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start++;
  if (start === samples.length) return samples.subarray(0, 0);
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) < threshold) end--;
  const margin = Math.round((marginMs / 1000) * sampleRate);
  return samples.subarray(Math.max(0, start - margin), Math.min(samples.length, end + 1 + margin));
}
