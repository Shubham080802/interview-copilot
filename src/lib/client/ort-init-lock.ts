"use client";

/**
 * The interviewer voice and voice monitoring share one ONNX Runtime (WebAssembly) instance, which is
 * initialized on the first session creation. Two features initializing it at the same moment makes it
 * fail, so every first-time session setup runs through this lock, one after another.
 */
let chain: Promise<unknown> = Promise.resolve();

export function withOrtInitLock<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}
