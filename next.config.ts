import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Camera/mic need a secure context; localhost counts as secure.
  devIndicators: false,
};

export default nextConfig;
