import { describe, expect, test } from "bun:test";
import {
  cleanupMcpLocal,
  loadMcpLocalPrivateCredential,
  prepareMcpLocal,
  resolveMcpSmokeFixtureIds,
} from "../../scripts/prepare-mcp-local";
import { McpSmokeFixtureError, type McpSmokeSeedPlan } from "../../scripts/prepare-mcp-production-smoke";

const seedPlan: McpSmokeSeedPlan = {
  fixtureKey: "unit-local",
  workspaceIds: [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ],
  workspaceSlugs: ["mcp-smoke-unit-local-a", "mcp-smoke-unit-local-b"],
  identities: [
    {
      name: "reviewer",
      token: "reviewer-secret-value",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
      clientId: "mcp-smoke-unit-local-reviewer",
    },
    {
      name: "operator",
      token: "operator-secret-value",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      role: "operator",
      scopes: ["mcp:read", "mcp:write"],
      clientId: "mcp-smoke-unit-local-operator",
    },
    {
      name: "viewer",
      token: "viewer-secret-value",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      role: "viewer",
      scopes: ["mcp:read"],
      clientId: "mcp-smoke-unit-local-viewer",
    },
  ],
  foreignProposalId: "00000000-0000-4000-8000-000000000003",
  viewerProposalId: "00000000-0000-4000-8000-000000000004",
  revokedToken: "revoked-secret-value",
};

describe("MCP local OAuth fixtures", () => {
  test("creates a deterministic two-workspace role matrix with a redacted summary", async () => {
    const writes: string[] = [];
    const result = await prepareMcpLocal({
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/private/local.env",
      readPrivateFile: async () => null,
      writePrivateFile: async (_path, content) => { writes.push(content); },
      seed: async () => seedPlan,
    });

    expect(result.workspaceIds).toHaveLength(2);
    expect(result.identities.map((identity) => identity.role)).toEqual(["reviewer", "operator", "viewer"]);
    expect(result.identities[0]?.scopes).toEqual(["mcp:read", "mcp:write", "mcp:approve"]);
    expect(result.identities[2]?.scopes).toEqual(["mcp:read"]);
    expect(result.redactedSummary).not.toMatch(/reviewer-secret|Bearer|postgres:\/\//i);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("MCP_LOCAL_REVIEWER_TOKEN");
  });

  test("does not enumerate or serialize bearer values from the public result", async () => {
    const result = await prepareMcpLocal({
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/private/local.env",
      readPrivateFile: async () => null,
      writePrivateFile: async () => { /* no-op */ },
      seed: async () => seedPlan,
    });
    expect(Object.keys(result.credentials)).not.toContain("reviewerToken");
    expect(Object.keys(result.credentials)).not.toContain("operatorToken");
    expect(Object.keys(result.credentials)).not.toContain("viewerToken");
    expect(Object.keys(result.credentials)).not.toContain("revokedToken");
    expect(JSON.stringify(result)).not.toContain("reviewer-secret-value");
    expect(JSON.stringify({ ...result })).not.toContain("operator-secret-value");
  });

  test("reuses a complete same-key fixture without rewriting or regenerating it", async () => {
    const privateFiles = new Map<string, string>();
    let seedModes: string[] = [];
    const options = {
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/private/local.env",
      readPrivateFile: async (path: string) => privateFiles.get(path) ?? null,
      writePrivateFile: async (path: string, content: string) => { privateFiles.set(path, content); },
      seed: async (_databaseUrl: string, _outputPath: string, input: { readonly fixtureKey: string }, seedOptions: { readonly mode: string }) => {
        seedModes.push(seedOptions.mode);
        return seedPlan;
      },
    };

    const first = await prepareMcpLocal(options);
    const written = privateFiles.get(options.envFilePath);
    expect(written).toBeString();
    const writesBeforeReuse = privateFiles.size;
    const second = await prepareMcpLocal(options);

    expect(seedModes).toEqual(["create", "reuse"]);
    expect(second.fixtureIds).toEqual(first.fixtureIds);
    expect(second.credentials).toEqual(first.credentials);
    expect(privateFiles.size).toBe(writesBeforeReuse);
    expect(privateFiles.get(options.envFilePath)).toBe(written);
  });

  test("fails closed on partial or mismatched private credentials", async () => {
    const base = {
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/private/local.env",
      writePrivateFile: async () => { /* no-op */ },
      seed: async () => seedPlan,
    };
    await expect(prepareMcpLocal({
      ...base,
      readPrivateFile: async () => "MCP_LOCAL_FIXTURE_KEY='unit-local'\nMCP_LOCAL_REVIEWER_TOKEN='only-one'\n",
    })).rejects.toThrow("MCP_LOCAL_FIXTURE_PARTIAL");
    await expect(prepareMcpLocal({
      ...base,
      readPrivateFile: async () => "MCP_LOCAL_FIXTURE_KEY='different'\nMCP_LOCAL_REVIEWER_TOKEN='reviewer-secret-value'\nMCP_LOCAL_OPERATOR_TOKEN='operator-secret-value'\nMCP_LOCAL_VIEWER_TOKEN='viewer-secret-value'\nMCP_LOCAL_REVOKED_TOKEN='revoked-secret-value'\n",
    })).rejects.toThrow("MCP_LOCAL_FIXTURE_MISMATCH");
  });

  test("preserves the smoke hash mismatch as a local fixture mismatch", async () => {
    let seedCalled = false;
    const privateContent = [
      "MCP_LOCAL_FIXTURE_KEY='unit-local'",
      "MCP_LOCAL_HOST='mcp.localhost'",
      "MCP_LOCAL_HTTPS_PORT='18443'",
      "MCP_LOCAL_REVIEWER_TOKEN='reviewer-secret-value'",
      "MCP_LOCAL_OPERATOR_TOKEN='operator-secret-value'",
      "MCP_LOCAL_VIEWER_TOKEN='viewer-secret-value'",
      "MCP_LOCAL_REVOKED_TOKEN='revoked-secret-value'",
    ].join("\n");
    const preparation = prepareMcpLocal({
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/private/local.env",
      readPrivateFile: async () => privateContent,
      writePrivateFile: async () => { /* no-op */ },
      seed: async () => { seedCalled = true; throw new McpSmokeFixtureError("MCP_SMOKE_FIXTURE_MISMATCH"); },
    });
    await expect(preparation).rejects.toMatchObject({ code: "MCP_LOCAL_FIXTURE_MISMATCH" });
    expect(seedCalled).toBe(true);
  });

  test("rejects malformed and duplicate private environment lines", async () => {
    const base = {
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/private/local.env",
      writePrivateFile: async () => { /* no-op */ },
      seed: async () => seedPlan,
    };
    await expect(prepareMcpLocal({
      ...base,
      readPrivateFile: async () => "MCP_LOCAL_FIXTURE_KEY='unit-local'\nnot an assignment\n",
    })).rejects.toThrow("MCP_LOCAL_FIXTURE_INVALID");
    await expect(prepareMcpLocal({
      ...base,
      readPrivateFile: async () => "MCP_LOCAL_FIXTURE_KEY='unit-local'\nMCP_LOCAL_FIXTURE_KEY='unit-local'\nMCP_LOCAL_REVIEWER_TOKEN='reviewer-secret-value'\nMCP_LOCAL_OPERATOR_TOKEN='operator-secret-value'\nMCP_LOCAL_VIEWER_TOKEN='viewer-secret-value'\nMCP_LOCAL_REVOKED_TOKEN='revoked-secret-value'\n",
    })).rejects.toThrow("MCP_LOCAL_FIXTURE_INVALID");
  });

  test("validates the explicit local database before reading private state", async () => {
    let readCalled = false;
    await expect(prepareMcpLocal({
      databaseUrl: "postgres://user:password@example.invalid/noosphere",
      fixtureKey: "unit-local",
      envFilePath: "/private/local.env",
      readPrivateFile: async () => { readCalled = true; return null; },
      writePrivateFile: async () => { /* no-op */ },
      seed: async () => seedPlan,
    })).rejects.toThrow("MCP_LOCAL_DATABASE_INVALID");
    expect(readCalled).toBe(false);
  });

  test("derives host, port, and resource from validated private configuration", async () => {
    let capturedInput: { readonly fixtureKey?: string; readonly host?: string; readonly httpsPort?: number; readonly tokens?: unknown } | undefined;
    const privateContent = [
      "MCP_LOCAL_FIXTURE_KEY='unit-local'",
      "MCP_LOCAL_HOST='local.example.test'",
      "MCP_LOCAL_HTTPS_PORT='19443'",
      "MCP_LOCAL_REVIEWER_TOKEN='reviewer-secret-value'",
      "MCP_LOCAL_OPERATOR_TOKEN='operator-secret-value'",
      "MCP_LOCAL_VIEWER_TOKEN='viewer-secret-value'",
      "MCP_LOCAL_REVOKED_TOKEN='revoked-secret-value'",
    ].join("\n");
    const result = await prepareMcpLocal({
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/private/local.env",
      readPrivateFile: async () => privateContent,
      writePrivateFile: async () => { /* no-op */ },
      seed: async (_databaseUrl, _outputPath, input) => {
        capturedInput = input;
        return seedPlan;
      },
    });
    expect(capturedInput).toEqual({ fixtureKey: "unit-local", host: "local.example.test", httpsPort: 19443, tokens: { reviewer: "reviewer-secret-value", operator: "operator-secret-value", viewer: "viewer-secret-value", revoked: "revoked-secret-value" } });
    expect(result.resource).toBe("https://local.example.test:19443/mcp");
  });

  test("derives the non-default local audience from the same private #80 stack environment", async () => {
    const privateFiles = new Map<string, string>([
      ["/private/stack.env", [
        "MCP_LOCAL_HOST='mcp.localhost'",
        "MCP_LOCAL_HTTPS_PORT='18484'",
        "MCP_LOCAL_RESOURCE='https://mcp.localhost:18484/mcp'",
      ].join("\n")],
    ]);
    let capturedInput: { readonly host?: string; readonly httpsPort?: number; readonly tokens?: unknown } | undefined;
    const options = {
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/private/fixture.env",
      stackEnvFilePath: "/private/stack.env",
      readPrivateFile: async (path: string) => privateFiles.get(path) ?? null,
      writePrivateFile: async (path: string, content: string) => { privateFiles.set(path, content); },
      seed: async (_databaseUrl: string, _outputPath: string, input: { readonly host: string; readonly httpsPort: number; readonly tokens?: unknown }) => {
        capturedInput = input;
        return seedPlan;
      },
    };
    const result = await prepareMcpLocal(options);
    expect(capturedInput?.host).toBe("mcp.localhost");
    expect(capturedInput?.httpsPort).toBe(18484);
    expect(result.resource).toBe("https://mcp.localhost:18484/mcp");
    expect(privateFiles.get("/private/fixture.env")).toContain("MCP_LOCAL_HTTPS_PORT='18484'");
    expect(privateFiles.get("/private/fixture.env")).toContain("MCP_LOCAL_REVIEWER_TOKEN='reviewer-secret-value'");
    expect(loadMcpLocalPrivateCredential(result.credentials, result.identities, result.fixtureIds, "reviewer").token).toBe("reviewer-secret-value");
  });

  test("classifies private write failures as cleanup-required without leaking path or token", async () => {
    const resultSeed = { ...seedPlan };
    await expect(prepareMcpLocal({
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/secret/path/local.env",
      readPrivateFile: async () => null,
      writePrivateFile: async () => { throw new Error("disk failed reviewer-secret-value"); },
      seed: async () => resultSeed,
    })).rejects.toMatchObject({ code: "MCP_LOCAL_FIXTURE_CLEANUP_REQUIRED" });
  });

  test("resolves proposal, aggregate, and revoked OAuth identifiers deterministically", () => {
    const first = resolveMcpSmokeFixtureIds("unit-local");
    const second = resolveMcpSmokeFixtureIds("unit-local");
    expect(first).toEqual(second);
    expect(first.proposal.foreign).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.aggregate.viewer).not.toBe(first.aggregate.foreign);
    expect(first.revoked.accessTokenId).not.toBe(first.revoked.familyId);
  });

  test("loads revoked credentials only through the process-local resolver", async () => {
    const result = await prepareMcpLocal({
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      envFilePath: "/private/local.env",
      readPrivateFile: async () => null,
      writePrivateFile: async () => { /* no-op */ },
      seed: async () => seedPlan,
    });
    const revoked = loadMcpLocalPrivateCredential(result.credentials, result.identities, result.fixtureIds, "revoked");
    expect(revoked.kind).toBe("revoked");
    expect(revoked.revoked).toBe(true);
    expect(revoked.token).toBe("revoked-secret-value");
  });

  test("requires an explicit cleanup client and scopes cleanup to the fixture key", async () => {
    const deleted: string[] = [];
    await cleanupMcpLocal({
      databaseUrl: "postgres://fixture-user:fixture-password@127.0.0.1:5432/noosphere_local",
      fixtureKey: "unit-local",
      client: {
        deleteFixtureKey: async (fixtureKey) => { deleted.push(fixtureKey); },
        close: async () => undefined,
      },
    });
    expect(deleted).toEqual(["unit-local"]);
  });
});
