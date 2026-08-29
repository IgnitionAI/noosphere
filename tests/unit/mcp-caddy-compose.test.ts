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
});
