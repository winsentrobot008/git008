import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The SDK is consumed straight from the sibling workspace package. Its `frontend/node_modules`
  // entry is a junction to `../sdk`, which sits outside this project directory, so Turbopack needs
  // the workspace root - the same directory webpack walks up to on its own.
  transpilePackages: ["@maotang/sdk"],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
