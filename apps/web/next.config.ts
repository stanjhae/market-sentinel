import type { NextConfig } from "next";

const apiOrigin = process.env.API_INTERNAL_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? "3001"}`;

const nextConfig: NextConfig = {
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
