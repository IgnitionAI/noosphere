import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    // Production Caddy routes these paths. Local development exposes the web
    // origin as OAuth issuer too, so it must reach the same API handlers.
    if (process.env.NODE_ENV !== "development") return [];
    const api = (process.env.OUTBOUND_API_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
    return {
      beforeFiles: [
        "/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server", "/oauth/register", "/oauth/token", "/oauth/revoke",
      ].map((source) => ({ source, destination: `${api}${source}` })),
      afterFiles: [], fallback: [],
    };
  },
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
