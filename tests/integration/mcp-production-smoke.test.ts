import { describe, expect, test } from "bun:test";
import { parseMcpProductionSmokeConfig, runMcpProductionSmoke } from "../../scripts/smoke-mcp-production";

const smokeDescribe = process.env.MCP_SMOKE_URL ? describe : describe.skip;

smokeDescribe("MCP production-like HTTPS edge", () => {
  test("runs the SDK modern and legacy protocol smoke through Caddy", async () => {
    const report = await runMcpProductionSmoke(parseMcpProductionSmokeConfig());
    expect(report.endpoint).toBe(process.env.MCP_SMOKE_URL!);
    expect(report.modernProtocol).toBe("modern");
    expect(report.legacyProtocol).toBe("legacy");
    expect(report.rateLimited).toBe(process.env.MCP_SMOKE_RATE_LIMIT !== "false");
    expect(report.foreignTenantIsolation).toBe(true);
    expect(report.viewerRedaction).toBe(true);
    expect(report.membershipRevocation).toBe(true);
  }, 180_000);
});
