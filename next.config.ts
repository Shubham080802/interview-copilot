import type { NextConfig } from "next";

// The in-browser interviewer voice (Piper TTS) ships Emscripten code with Node-only branches that
// require fs/path/crypto. Those branches never run in the browser, so resolve them to an empty module.
const browserOnlyStub = { browser: "./src/lib/client/empty-module.ts" };

const nextConfig: NextConfig = {
  // Camera/mic need a secure context; localhost counts as secure.
  devIndicators: false,
  turbopack: {
    resolveAlias: { fs: browserOnlyStub, path: browserOnlyStub, crypto: browserOnlyStub },
  },
};

export default nextConfig;
