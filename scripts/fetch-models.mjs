// Prepares browser-side models in /public so interviews don't depend on CDNs at runtime:
// MediaPipe face tracking, the interviewer voice runtime, and voice-monitoring models.
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

// Voice monitoring (only the candidate may speak): a speaker-embedding model to tell the candidate's
// voice apart from others, and a speech detector so music/noise isn't mistaken for a voice.
const HF = "https://huggingface.co";
const voiceMonitorModels = [
  // WeSpeaker ResNet34 (pyannote/wespeaker-voxceleb-resnet34-LM, CC BY 4.0), 8-bit quantized ONNX export
  [`${HF}/onnx-community/wespeaker-voxceleb-resnet34-LM/resolve/main/onnx/model_quantized.onnx`, "public/voice/monitor/speaker.onnx"],
  // Silero VAD v5 (MIT)
  [`${HF}/onnx-community/silero-vad/resolve/main/onnx/model.onnx`, "public/voice/monitor/vad.onnx"],
];
for (const [url, to] of voiceMonitorModels) {
  const dest = path.join(root, to);
  if (fs.existsSync(dest)) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`[models] downloaded ${to}`);
  } catch (err) {
    console.warn(`[models] could not download ${url} — voice monitoring will be unavailable:`, err.message);
  }
}
