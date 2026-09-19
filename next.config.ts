import type { NextConfig } from "next";

// The in-browser interviewer voice (Piper TTS) ships Emscripten code with Node-only branches that
// require fs/path/crypto. Those branches never run in the browser, so resolve them to an empty module.
const browserOnlyStub = { browser: "./src/lib/client/empty-module.ts" };

const nextConfig: NextConfig = {
  // Camera/mic need a secure context; localhost counts as secure.
  devIndicators: false,
  // Cross-origin isolation lets the in-browser voice models run multi-threaded WebAssembly
  // (SharedArrayBuffer), several times faster than a single thread. "credentialless" keeps
  // cross-origin resources such as the code editor (jsDelivr) and model downloads working.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  turbopack: {
    resolveAlias: { fs: browserOnlyStub, path: browserOnlyStub, crypto: browserOnlyStub },
  },
};

export default nextConfig;
