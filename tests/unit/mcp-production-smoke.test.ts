import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildMcpInspectorCommand,
  parseMcpProductionSmokeConfig,
  redactMcpProductionSmokeConfig,
  type McpProductionSmokeEnvironment,
} from "../../scripts/smoke-mcp-production";

const repositoryRoot = resolve(import.meta.dir, "../..");
const workspaceA = "00000000-0000-4000-8000-000000000001";
const workspaceB = "00000000-0000-4000-8000-000000000002";
const baseEnvironment: McpProductionSmokeEnvironment = {
  MCP_SMOKE_URL: "https://mcp-smoke.example.test/mcp",
  MCP_SMOKE_RESOURCE: "https://mcp-smoke.example.test/mcp",
  MCP_SMOKE_IDENTITIES_JSON: JSON.stringify([
    { name: "reviewer-a", token: "oauth-token-a", workspaceId: workspaceA, role: "reviewer", scopes: ["mcp:read", "mcp:write", "mcp:approve"] },
    { name: "viewer-b", token: "oauth-token-b", workspaceId: workspaceB, role: "viewer", scopes: ["mcp:read"] },
  ]),
  MCP_SMOKE_FOREIGN_PROPOSAL_ID: "00000000-0000-4000-8000-000000000099",
  MCP_SMOKE_VIEWER_PROPOSAL_ID: "00000000-0000-4000-8000-000000000098",
  MCP_SMOKE_REVOKED_TOKEN: "revoked-token-123",
};

describe("MCP production-like smoke harness", () => {
  test("requires HTTPS /mcp and two distinct workspace-bound OAuth identities", () => {
    const config = parseMcpProductionSmokeConfig(baseEnvironment);
    expect(config.endpoint.href).toBe("https://mcp-smoke.example.test/mcp");
    expect(config.identities).toHaveLength(2);
    expect(new Set(config.identities.map((identity) => identity.workspaceId)).size).toBe(2);
    expect(config.identities[0]).toMatchObject({ role: "reviewer", scopes: ["mcp:read", "mcp:write", "mcp:approve"] });
  });

  test("rejects insecure, non-canonical, malformed, or duplicate tenant configuration", () => {
    expect(() => parseMcpProductionSmokeConfig({ ...baseEnvironment, MCP_SMOKE_URL: "http://mcp-smoke.example.test/mcp" })).toThrow("MCP_SMOKE_URL");
    expect(() => parseMcpProductionSmokeConfig({ ...baseEnvironment, MCP_SMOKE_RESOURCE: "https://other.example.test/mcp" })).toThrow("MCP_SMOKE_RESOURCE");
    expect(() => parseMcpProductionSmokeConfig({
      ...baseEnvironment,
      MCP_SMOKE_IDENTITIES_JSON: JSON.stringify([
        { name: "a", token: "token-a-123", workspaceId: workspaceA, role: "viewer", scopes: ["mcp:read"] },
        { name: "b", token: "token-b-123", workspaceId: workspaceA, role: "viewer", scopes: ["mcp:read"] },
      ]),
    })).toThrow("workspace");
  });

  test("rejects duplicate identity names and role-incompatible scopes", () => {
    const duplicateNames = JSON.stringify([
      { name: "same", token: "token-a-123", workspaceId: workspaceA, role: "reviewer", scopes: ["mcp:read", "mcp:write", "mcp:approve"] },
      { name: "same", token: "token-b-123", workspaceId: workspaceB, role: "viewer", scopes: ["mcp:read"] },
    ]);
    expect(() => parseMcpProductionSmokeConfig({ ...baseEnvironment, MCP_SMOKE_IDENTITIES_JSON: duplicateNames })).toThrow("duplicated");

    const incompatibleScopes = JSON.stringify([
      { name: "operator-a", token: "token-a-123", workspaceId: workspaceA, role: "operator", scopes: ["mcp:read", "mcp:approve"] },
      { name: "viewer-b", token: "token-b-123", workspaceId: workspaceB, role: "viewer", scopes: ["mcp:read"] },
    ]);
    expect(() => parseMcpProductionSmokeConfig({ ...baseEnvironment, MCP_SMOKE_IDENTITIES_JSON: incompatibleScopes })).toThrow("scopes");
  });

  test("redacts OAuth material and does not serialize bearer values", () => {
    const config = parseMcpProductionSmokeConfig(baseEnvironment);
    const safe = JSON.stringify(redactMcpProductionSmokeConfig(config));
    expect(safe).not.toContain("oauth-token-a");
    expect(safe).not.toContain("oauth-token-b");
    expect(safe).toContain(workspaceA);
    expect(safe).toContain("reviewer");
  });

  test("accepts revoked-token and viewer-redaction probes without exposing them", () => {
    const config = parseMcpProductionSmokeConfig({
      ...baseEnvironment,
      MCP_SMOKE_VIEWER_PROPOSAL_ID: "00000000-0000-4000-8000-000000000099",
      MCP_SMOKE_REVOKED_TOKEN: "revoked-oauth-token",
    });
    expect(config.viewerProposalId).toBe("00000000-0000-4000-8000-000000000099");
    const safe = JSON.stringify(redactMcpProductionSmokeConfig(config));
    expect(safe).not.toContain("revoked-oauth-token");
    expect(safe).not.toContain("viewerProposalId");
  });

  test("keeps the production topology private and smoke TLS explicit", () => {
    const production = readFileSync(resolve(repositoryRoot, "compose.production.yml"), "utf8");
    const overlay = readFileSync(resolve(repositoryRoot, "compose.mcp-smoke.yml"), "utf8");
    const caddy = readFileSync(resolve(repositoryRoot, "deploy/Caddyfile.mcp-smoke"), "utf8");
    expect(production).toContain('"${HTTP_BIND:-0.0.0.0}:80:80"');
    expect(production).toContain('"${HTTPS_BIND:-0.0.0.0}:443:443"');
    expect(production).not.toContain("MCP_SMOKE");
    expect(overlay).toContain('127.0.0.1:${MCP_SMOKE_HTTP_PORT:-18080}:80');
    expect(overlay).toContain('127.0.0.1:${MCP_SMOKE_HTTPS_PORT:-18443}:443');
    expect(caddy).toContain("tls internal");
    expect(caddy).toContain("@mcp path /mcp");
    expect(caddy).toContain("reverse_proxy @mcp api:3001");
  });

  test("ships the scoped fixture seeder in the local backend image", () => {
    const dockerfile = readFileSync(resolve(repositoryRoot, "Dockerfile.backend"), "utf8");
    const overlay = readFileSync(resolve(repositoryRoot, "compose.mcp-smoke.yml"), "utf8");
    expect(dockerfile).toContain("bun build scripts/prepare-mcp-production-smoke.ts");
    expect(dockerfile).toContain("dist/mcp-smoke");
    expect(overlay).toContain("/app/dist/mcp-smoke/prepare-mcp-production-smoke.js");
  });

  test("keeps migrations readable by the non-root runtime user", () => {
    const dockerfile = readFileSync(resolve(repositoryRoot, "Dockerfile.backend"), "utf8");
    expect(dockerfile).toContain("COPY --from=build --chown=bun:bun /app/packages/infrastructure/migrations ./migrations");
    expect(dockerfile).toContain("USER bun");
    expect(dockerfile).not.toMatch(/USER\s+root/);
  });

  test("keeps seeder output private and extracts it without a bind mount", () => {
    const overlay = readFileSync(resolve(repositoryRoot, "compose.mcp-smoke.yml"), "utf8");
    const runbook = readFileSync(resolve(repositoryRoot, "docs/runbooks/mcp-production-smoke.md"), "utf8");
    expect(overlay).toContain("MCP_SMOKE_ENV_FILE: /tmp/mcp-smoke-private/mcp-smoke.env");
    expect(overlay).not.toContain("MCP_SMOKE_TMP_DIR");
    expect(overlay).not.toContain("/tmp/mcp-smoke:rw");
    expect(overlay).not.toMatch(/\n\s+user:/);
    expect(runbook).toContain("MCP_SMOKE_CONTAINER_NAME");
    expect(runbook).toContain("docker compose");
    expect(runbook).toContain("run --name \"$MCP_SMOKE_CONTAINER_NAME\" mcp-smoke-seeder prepare");
    expect(runbook).toContain("docker cp \"$MCP_SMOKE_CONTAINER_NAME:/tmp/mcp-smoke-private/mcp-smoke.env\" -");
    expect(runbook).toContain("tar -xO");
    expect(runbook).toContain("umask 077");
    expect(runbook).toContain("chmod 600");
    expect(runbook).toContain("docker rm");
    expect(runbook).not.toContain("run --rm mcp-smoke-seeder prepare");
    expect(runbook).not.toContain("run --rm");
  });

  test("resets production proxy ports instead of appending public bindings", () => {
    const overlay = readFileSync(resolve(repositoryRoot, "compose.mcp-smoke.yml"), "utf8");
    expect(overlay).toMatch(/ports:\s*!override/);
    expect(overlay).not.toContain("0.0.0.0:80:80");
    expect(overlay).not.toContain("0.0.0.0:443:443");
  });

  test("pins the smoke endpoint's canonical host and explicit port", () => {
    const overlay = readFileSync(resolve(repositoryRoot, "compose.mcp-smoke.yml"), "utf8");
    expect(overlay).toContain("MCP_ALLOWED_HOSTS: ${MCP_SMOKE_HOST:-mcp-smoke.localhost}:${MCP_SMOKE_HTTPS_PORT:-18443}");
    expect(overlay).not.toContain("MCP_ALLOWED_HOSTS: *");
  });

  test("builds the pinned Inspector CLI invocation without putting bearer tokens in argv", () => {
    const args = buildMcpInspectorCommand("http://127.0.0.1:39123/mcp");
    expect(args).toEqual([
      "npx",
      "--yes",
      "@modelcontextprotocol/inspector@0.16.3",
      "--cli",
      "http://127.0.0.1:39123/mcp",
      "--transport",
      "http",
      "--method",
      "tools/list",
    ]);
    expect(args.join(" ")).not.toContain("Bearer");
    expect(args.join(" ")).not.toContain("secret");
  });

  test("documents the Inspector release's supported HTTP CLI shape", () => {
    const runbook = readFileSync(resolve(repositoryRoot, "docs/runbooks/mcp-production-smoke.md"), "utf8");
    expect(runbook).toContain("does not implement a `--header` flag");
    expect(runbook).toContain("--transport http --method tools/list");
    expect(runbook).toContain("loopback-only forwarding");
    expect(runbook).not.toContain("--transport streamable-http");
  });
});
