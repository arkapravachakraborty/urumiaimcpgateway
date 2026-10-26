import path from "node:path";
import { fileURLToPath } from "node:url";

const gatewayOrigin = globalThis.process.env.GATEWAY_ORIGIN ?? "http://localhost:4000";
const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return {
      afterFiles: [
        { source: "/api/:path*", destination: `${gatewayOrigin}/api/:path*` },
        { source: "/mcp", destination: `${gatewayOrigin}/mcp` },
      ],
    };
  },
};

export default nextConfig;
