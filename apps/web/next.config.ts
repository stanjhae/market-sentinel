import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@market-sentinel/contracts", "@market-sentinel/domain"],
};

export default nextConfig;
