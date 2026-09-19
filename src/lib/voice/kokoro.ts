"use client";
import type { KokoroRequest, KokoroResponse } from "./kokoro.worker";

export const KOKORO_SAMPLE_RATE = 24_000;

export type DownloadProgress = (loaded: number, total: number) => void;

/** The Kokoro natural voice, synthesized in a background worker (see kokoro.worker.ts). */
export class KokoroEngine {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (samples: Float32Array) => void; reject: (err: Error) => void }>();

  private constructor(
    private readonly worker: Worker,
    readonly voiceId: string,
  ) {
    worker.addEventListener("message", (event: MessageEvent<KokoroResponse>) => {
      const message = event.data;
      if (message.type !== "audio" && message.type !== "synthesize-error") return;
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.type === "audio") request?.resolve(message.samples);
      else request?.reject(new Error(message.message));
    });
  }

  /**
   * @param modelFile the 8-bit model (92 MB) runs well on the CPU/WebAssembly path used here.
   */
  static load(voiceId: string, onProgress?: DownloadProgress, modelFile = "model_quantized.onnx"): Promise<KokoroEngine> {
    const worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
      const fail = (err: Error) => {
        worker.terminate();
        reject(err);
      };
      worker.onerror = (event) => fail(new Error(event.message || "The voice worker failed to start"));
      worker.onmessage = (event: MessageEvent<KokoroResponse>) => {
        const message = event.data;
        if (message.type === "progress") onProgress?.(message.loaded, message.total);
        else if (message.type === "load-error") fail(new Error(message.message));
        else if (message.type === "ready") {
          worker.onmessage = null;
          worker.onerror = null;
          resolve(new KokoroEngine(worker, voiceId));
        }
      };
      worker.postMessage({ type: "load", voiceId, modelFile } satisfies KokoroRequest);
    });
  }

  /** Synthesizes speech (24 kHz mono). Requests are processed in order, one at a time. */
  synthesize(text: string, speed = 1): Promise<Float32Array> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "synthesize", id, text, speed } satisfies KokoroRequest);
    });
  }

  dispose() {
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new Error("voice engine closed"));
    this.pending.clear();
  }
}
