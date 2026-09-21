/**
 * Where the interviewer's voice comes from, and how it is kept.
 *
 * The model files are downloaded once from Hugging Face and stored in the browser's Cache Storage,
 * so later interviews start speaking immediately. Shared by the synthesis worker and by the page,
 * which warms the cache while an interview is being prepared.
 */

export const KOKORO_REPO = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";
export const VOICE_CACHE = "interview-voice-v1";
export const DEFAULT_MODEL_FILE = "model_quantized.onnx";

export const modelUrl = (modelFile = DEFAULT_MODEL_FILE) => `${KOKORO_REPO}/onnx/${modelFile}`;
export const voiceUrl = (voiceId: string) => `${KOKORO_REPO}/voices/${voiceId}.bin`;

export type DownloadProgress = (loaded: number, total: number) => void;

/** Fetches a file once and serves it from Cache Storage afterwards, reporting download progress. */
export async function cachedDownload(url: string, onProgress?: DownloadProgress): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(VOICE_CACHE);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    cache = null; // private mode or storage disabled: just download
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  if (cache) await cache.put(url, new Response(data, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return data.buffer;
}

/** True once the voice is in Cache Storage and the room can start speaking without downloading. */
export async function isVoiceCached(voiceId: string, modelFile = DEFAULT_MODEL_FILE): Promise<boolean> {
  try {
    const cache = await caches.open(VOICE_CACHE);
    const [model, voice] = await Promise.all([cache.match(modelUrl(modelFile)), cache.match(voiceUrl(voiceId))]);
    return Boolean(model && voice);
  } catch {
    return false;
  }
}

/**
 * Downloads the voice into Cache Storage ahead of time — called while an interview is being
 * prepared, so the interviewer can speak the moment the room opens. Failures are not a problem:
 * the room downloads what it needs itself.
 */
export async function prefetchVoice(voiceId: string, onProgress?: DownloadProgress, modelFile = DEFAULT_MODEL_FILE): Promise<boolean> {
  try {
    await Promise.all([cachedDownload(modelUrl(modelFile), onProgress), cachedDownload(voiceUrl(voiceId))]);
    return true;
  } catch {
    return false;
  }
}
