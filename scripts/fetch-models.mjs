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
