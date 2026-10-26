const gatewayOrigin = globalThis.process.env.GATEWAY_ORIGIN ?? "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${gatewayOrigin}/api/:path*` },
      { source: "/mcp", destination: `${gatewayOrigin}/mcp` },
    ];
  },
};

export default nextConfig;
