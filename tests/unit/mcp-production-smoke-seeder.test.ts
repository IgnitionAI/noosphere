import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createMcpSmokeSeedPlan,
  formatMcpSmokeEnvironmentFile,
  mcpSmokeProposalInputHash,
} from "../../scripts/prepare-mcp-production-smoke";

describe("MCP production smoke fixture seeder", () => {
  test("binds proposal snapshots as JSON objects instead of JSONB strings", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../scripts/prepare-mcp-production-smoke.ts"), "utf8");
    expect(source).not.toMatch(/JSON\.stringify\([^\n]+\)::jsonb/);
    expect(source).not.toContain("::jsonb");
    expect(source).not.toContain("jsonb_build_object");
    expect(source).toContain("tx.json(");
  });

  test("keeps generated OAuth environment private inside the non-root container", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../scripts/prepare-mcp-production-smoke.ts"), "utf8");
    expect(source).toContain('MCP_SMOKE_PRIVATE_ENV_DIRECTORY = "/tmp/mcp-smoke-private"');
    expect(source).toContain("mode: 0o700");
    expect(source).toContain("mode: 0o600");
    expect(source).toContain("chmod(outputPath, 0o600)");
    expect(source).not.toContain("console.log(JSON.stringify");
  });

  test("builds an idempotent two-workspace identity matrix with scoped probes", () => {
    const plan = createMcpSmokeSeedPlan({
      fixtureKey: "unit-seeder",
      host: "mcp-smoke.localhost",
      httpsPort: 18443,
      tokens: {
        reviewer: "reviewer-token-value",
        operator: "operator-token-value",
        viewer: "viewer-token-value",
        revoked: "revoked-token-value",
      },
    });
    expect(new Set(plan.identities.map((identity) => identity.workspaceId)).size).toBe(2);
    expect(plan.identities.map((identity) => identity.role)).toEqual(["reviewer", "operator", "viewer"]);
    expect(plan.foreignProposalId).not.toBe(plan.viewerProposalId);
    expect(plan.workspaceSlugs).toEqual([
      "mcp-smoke-unit-seeder-a",
      "mcp-smoke-unit-seeder-b",
    ]);
  });

  test("writes shell-sourceable env without database credentials or secret output", () => {
    const plan = createMcpSmokeSeedPlan({
      fixtureKey: "unit-seeder-env",
      host: "mcp-smoke.localhost",
      httpsPort: 18443,
      tokens: {
        reviewer: "reviewer-token-value",
        operator: "operator-token-value",
        viewer: "viewer-token-value",
        revoked: "revoked-token-value",
      },
    });
    const envFile = formatMcpSmokeEnvironmentFile(plan);
    expect(envFile).toContain("MCP_SMOKE_IDENTITIES_JSON='");
    expect(envFile).toContain("MCP_SMOKE_URL='https://mcp-smoke.localhost:18443/mcp'");
    expect(envFile).not.toContain("DATABASE_URL");
    expect(envFile).not.toContain("TEST_DATABASE_URL");
    expect(envFile).not.toContain("MCP_SMOKE_ENV_FILE");
  });

  test("uses a PostgreSQL-compatible 64-character proposal input hash", () => {
    expect(mcpSmokeProposalInputHash("fixture-input")).toMatch(/^[0-9a-f]{64}$/);
  });
});
