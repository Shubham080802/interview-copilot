import type { NextConfig } from "next";

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
};

export default nextConfig;
