import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiOrigin = process.env.API_INTERNAL_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? "3001"}`;
const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@market-sentinel/contracts", "@market-sentinel/domain"],
  async rewrites() {
    return [{ source: "/sentinel-api/:path*", destination: `${apiOrigin}/:path*` }];
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
