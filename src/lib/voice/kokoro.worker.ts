/// <reference lib="webworker" />
import { styleForLength, textToPhonemes, tokenize } from "./kokoro-text";

/*
 * Kokoro-82M (Apache-2.0, hexgrad/Kokoro-82M; ONNX export by onnx-community) — a natural-sounding
 * text-to-speech model. It runs in this worker, on its own ONNX runtime instance: inference keeps a
 * thread fully busy, and on the page it would hold up audio playback, face tracking and the UI.
 * Model and voice files download once from Hugging Face and are kept in the browser's Cache Storage.
 */

export type KokoroRequest = { type: "load"; voiceId: string; modelFile: string } | { type: "synthesize"; id: number; text: string; speed: number };
export type KokoroResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready" }
  | { type: "load-error"; message: string }
  | { type: "audio"; id: number; samples: Float32Array }
  | { type: "synthesize-error"; id: number; message: string };

const REPO = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";
const CACHE = "interview-voice-v1";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (message: KokoroResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

/** Fetches a file once and serves it from Cache Storage afterwards, reporting download progress. */
async function cachedDownload(url: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
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

let model: Promise<{ ort: Ort; session: import("onnxruntime-web/wasm").InferenceSession; voice: Float32Array }> | null = null;
let phonemize: ((text: string, language: string) => Promise<string[]>) | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function load(voiceId: string, modelFile: string) {
  const [modelData, voiceData] = await Promise.all([
    cachedDownload(`${REPO}/onnx/${modelFile}`, (loaded, total) => send({ type: "progress", loaded, total })),
    cachedDownload(`${REPO}/voices/${voiceId}.bin`),
  ]);
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.wasmPaths = "/voice/ort/";
  // Leave a core free for the page (audio playback, face tracking).
  ort.env.wasm.numThreads = Math.max(1, (navigator.hardwareConcurrency || 2) - 1);
  const session = await ort.InferenceSession.create(new Uint8Array(modelData), { executionProviders: ["wasm"] });
  phonemize = (await import("phonemizer")).phonemize;
  return { ort, session, voice: new Float32Array(voiceData) };
}

async function synthesize(text: string, speed: number): Promise<Float32Array> {
  if (!model || !phonemize) throw new Error("voice not loaded");
  const { ort, session, voice } = await model;
  const ids = tokenize(await textToPhonemes(text, phonemize));
  const out = await session.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
    style: new ort.Tensor("float32", styleForLength(voice, ids.length), [1, 256]),
    speed: new ort.Tensor("float32", [speed], [1]),
  });
  return out.waveform.data as Float32Array;
}

scope.onmessage = (event: MessageEvent<KokoroRequest>) => {
  const request = event.data;
  if (request.type === "load") {
    model ??= load(request.voiceId, request.modelFile);
    model.then(
      () => send({ type: "ready" }),
      (err: Error) => send({ type: "load-error", message: err?.message ?? String(err) }),
    );
    return;
  }
  // The runtime runs one inference at a time.
  const run = async () => {
    try {
      const samples = await synthesize(request.text, request.speed);
      send({ type: "audio", id: request.id, samples }, [samples.buffer]);
    } catch (err) {
      send({ type: "synthesize-error", id: request.id, message: (err as Error)?.message ?? String(err) });
    }
  };
  queue = queue.then(run, run);
};
