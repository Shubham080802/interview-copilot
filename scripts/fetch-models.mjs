// Copies MediaPipe WASM runtime into /public and downloads the face landmark model
// so proctoring works without hitting a CDN at interview time.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const wasmSrc = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDest = path.join(root, "public/mediapipe/wasm");
const modelDest = path.join(root, "public/mediapipe/face_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Interviewer voice (Piper TTS): ONNX runtime + phonemizer, served locally so the voice works
// without third-party CDNs and matches the installed runtime version. The voice model itself
// (~63 MB) is downloaded from Hugging Face on first use and cached by the browser.
const voiceFiles = [
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", "public/voice/ort/ort-wasm-simd-threaded.mjs"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "public/voice/ort/ort-wasm-simd-threaded.wasm"],
  ["node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm", "public/voice/piper/piper_phonemize.wasm"],
  ["node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data", "public/voice/piper/piper_phonemize.data"],
];
for (const [from, to] of voiceFiles) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    console.warn(`[models] missing ${from} — interviewer voice will fall back to the browser voice`);
    continue;
  }
  fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  fs.copyFileSync(src, path.join(root, to));
}
console.log("[models] copied interviewer voice runtime");

try {
  if (fs.existsSync(wasmSrc)) {
    fs.mkdirSync(wasmDest, { recursive: true });
    for (const f of fs.readdirSync(wasmSrc)) fs.copyFileSync(path.join(wasmSrc, f), path.join(wasmDest, f));
    console.log("[models] copied MediaPipe wasm runtime");
  }
  if (!fs.existsSync(modelDest)) {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(modelDest, Buffer.from(await res.arrayBuffer()));
    console.log("[models] downloaded face_landmarker.task");
  }
} catch (err) {
  console.warn("[models] could not prepare proctoring model (will fall back to CDN at runtime):", err.message);
}
