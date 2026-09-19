"use client";
import { withOrtInitLock } from "../client/ort-init-lock";
import { styleForLength, textToPhonemes, tokenize } from "./kokoro-text";

/*
 * Kokoro-82M (Apache-2.0, hexgrad/Kokoro-82M; ONNX export by onnx-community) — a natural-sounding
 * text-to-speech model, run in the browser on the ONNX runtime shared with voice monitoring.
 * Model and voice files download once from Hugging Face and are kept in the browser's Cache Storage.
 */

const REPO = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";
const CACHE = "interview-voice-v1";
export const KOKORO_SAMPLE_RATE = 24_000;

export type DownloadProgress = (loaded: number, total: number) => void;

/** Fetches a file once and serves it from Cache Storage afterwards, reporting download progress. */
async function cachedDownload(url: string, onProgress?: DownloadProgress): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
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

type Ort = typeof import("onnxruntime-web/wasm");
type Session = import("onnxruntime-web/wasm").InferenceSession;

export class KokoroEngine {
  private queue: Promise<unknown> = Promise.resolve();
  private phonemize: ((text: string, language: string) => Promise<string[]>) | null = null;

  private constructor(
    private readonly ort: Ort,
    private readonly session: Session,
    private readonly voice: Float32Array,
    readonly voiceId: string,
  ) {}

  /**
   * @param modelFile the 8-bit model (92 MB) runs well on the CPU/WebAssembly path used here.
   */
  static async load(voiceId: string, onProgress?: DownloadProgress, modelFile = "model_quantized.onnx"): Promise<KokoroEngine> {
    const [model, voiceData] = await Promise.all([
      cachedDownload(`${REPO}/onnx/${modelFile}`, onProgress),
      cachedDownload(`${REPO}/voices/${voiceId}.bin`),
    ]);
    return withOrtInitLock(async () => {
      const ort = await import("onnxruntime-web/wasm");
      ort.env.wasm.wasmPaths = "/voice/ort/";
      ort.env.wasm.numThreads = navigator.hardwareConcurrency; // same settings as the other voice features
      const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"] });
      return new KokoroEngine(ort, session, new Float32Array(voiceData), voiceId);
    });
  }

  /** Synthesizes speech (24 kHz mono). Calls are serialized — the runtime runs one inference at a time. */
  synthesize(text: string, speed = 1): Promise<Float32Array> {
    const run = async () => {
      if (!this.phonemize) this.phonemize = (await import("phonemizer")).phonemize;
      const ids = tokenize(await textToPhonemes(text, this.phonemize));
      const { Tensor } = this.ort;
      const out = await this.session.run({
        input_ids: new Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
        style: new Tensor("float32", styleForLength(this.voice, ids.length), [1, 256]),
        speed: new Tensor("float32", [speed], [1]),
      });
      return out.waveform.data as Float32Array;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
