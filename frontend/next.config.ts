import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The SDK is consumed straight from the sibling workspace package.
  transpilePackages: ["@maotang/sdk"],
};

export default nextConfig;