import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("MCP deployment routing", () => {
  test("routes /mcp to the existing API before the web fallback", async () => {
    const caddy = await readFile(resolve(import.meta.dir, "../../deploy/Caddyfile"), "utf8");
    const mcpRoute = caddy.indexOf("@mcp path /mcp");
    const fallback = caddy.indexOf("reverse_proxy web:3000");
    expect(mcpRoute).toBeGreaterThanOrEqual(0);
    expect(caddy.indexOf("reverse_proxy @mcp api:3001", mcpRoute)).toBeGreaterThan(mcpRoute);
    expect(mcpRoute).toBeLessThan(fallback);
  });

  test("keeps production Compose topology unchanged", async () => {
    const compose = await readFile(resolve(import.meta.dir, "../../compose.production.yml"), "utf8");
    expect(compose).toContain("  api:");
    expect(compose).toContain("  web:");
    expect(compose).not.toContain("  mcp:");
    expect(compose).not.toMatch(/^\s+-?\s*\"?\d+:\d+\"?\s*$/m);
  });

  test("routes OAuth metadata and protocol endpoints to API before fallback", async () => {
    const caddy = await readFile(resolve(import.meta.dir, "../../deploy/Caddyfile"), "utf8");
    const metadata = caddy.indexOf("@oauth_metadata path /.well-known/oauth-*");
    const oauth = caddy.indexOf("@oauth path /oauth/*");
    const fallback = caddy.indexOf("reverse_proxy web:3000");
    expect(metadata).toBeGreaterThanOrEqual(0);
    expect(oauth).toBeGreaterThan(metadata);
    expect(caddy.indexOf("reverse_proxy @oauth_metadata api:3001", metadata)).toBeGreaterThan(metadata);
    expect(caddy.indexOf("reverse_proxy @oauth api:3001", oauth)).toBeGreaterThan(oauth);
    expect(oauth).toBeLessThan(fallback);
  });

  test("stamps proxy protocol from the edge scheme and strips client forwarding headers", async () => {
    const caddy = await readFile(resolve(import.meta.dir, "../../deploy/Caddyfile"), "utf8");
    expect(caddy).toContain("header_up -X-Forwarded-Proto");
    expect(caddy).toContain("header_up X-Forwarded-Proto {http.request.scheme}");
    expect(caddy).toContain("header_up -X-Noosphere-Forwarded-Proto");
    expect(caddy).toContain("header_up X-Noosphere-Forwarded-Proto {http.request.scheme}");
    expect(caddy).toContain("header_up X-Noosphere-Client-IP {http.request.remote.host}");
  });
});
