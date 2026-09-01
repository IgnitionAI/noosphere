import { describe, expect, test } from "bun:test";
import {
  createMcpLocalConfiguredEdgeProbe,
  createMcpLocalDurableStateReader,
  createMcpLocalSdkFactory,
  loadMcpLocalClientConfig,
  verifyMcpLocal,
} from "../../scripts/verify-mcp-local";
import { resolveMcpSmokeFixtureIds } from "../../scripts/prepare-mcp-production-smoke";

const integrationEnabled = process.env.MCP_LOCAL_VERIFICATION_INTEGRATION === "1";
const databaseDescribe = integrationEnabled ? describe : describe.skip;

databaseDescribe("local MCP functional verification", () => {
  test("configured correlation probe sends the live-shaped modern call envelope", async () => {
    const configPath = process.env.MCP_LOCAL_CLIENT_CONFIG_PATH;
    if (!configPath) throw new Error("MCP_LOCAL_VERIFICATION_CONFIG_REQUIRED");
    let capturedBody: Record<string, unknown> | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const probe = await createMcpLocalConfiguredEdgeProbe(configPath, 30_000, {
      fetchImpl: async (_input: unknown, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
        capturedBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        const correlationId = capturedHeaders["x-correlation-id"];
        if (!correlationId) throw new Error("MCP_TEST_CORRELATION_MISSING");
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: "correlation",
          result: { structuredContent: { correlationId } },
        }), { status: 200, headers: { "content-type": "application/json", "x-correlation-id": correlationId } });
      },
    });
    await expect(probe({ kind: "correlation" })).resolves.toEqual({ ok: true, code: "MCP_CORRELATION_OK" });
    expect(capturedBody).toEqual({
      jsonrpc: "2.0",
      id: "correlation",
      method: "tools/call",
      params: {
        name: "noosphere_ping",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "noosphere-local-verifier", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
          correlationId: "mcp-local-probe-correlation",
        },
      },
    });
    expect(capturedHeaders).toMatchObject({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": "noosphere_ping",
      "mcp-protocol-version": "2026-07-28",
      "x-correlation-id": "mcp-local-probe-correlation",
    });
    expect(capturedHeaders?.authorization).toMatch(/^Bearer \S+$/);
  });

  test("runs only against an explicitly configured local stack", async () => {
    const configPath = process.env.MCP_LOCAL_CLIENT_CONFIG_PATH;
    const fixtureKey = process.env.MCP_LOCAL_FIXTURE_KEY;
    const databaseUrl = process.env.MCP_LOCAL_DATABASE_URL;
    if (!configPath || !fixtureKey || !databaseUrl) throw new Error("MCP_LOCAL_VERIFICATION_CONFIG_REQUIRED");
    const fixtureIds = resolveMcpSmokeFixtureIds(fixtureKey);
    const config = await loadMcpLocalClientConfig(configPath);
    const reader = createMcpLocalDurableStateReader({
      databaseUrl,
      fixtureIds,
      identityLabels: config.identities,
    });
    try {
      const probe = await createMcpLocalConfiguredEdgeProbe(configPath, 30_000);
      const report = await verifyMcpLocal({
        configPath,
        timeoutMs: 30_000,
        maxCalls: 192,
        fixtureIds,
        resolveFixtureId: (name) => ({
          foreignProposal: fixtureIds.proposal.foreign,
          viewerProposal: fixtureIds.proposal.viewer,
          foreignAggregate: fixtureIds.aggregate.foreign,
          viewerAggregate: fixtureIds.aggregate.viewer,
          revokedAccessToken: fixtureIds.revoked.accessTokenId,
        }[name]),
        readDurableStateForProposal: reader.readProposal,
        sdkFactory: createMcpLocalSdkFactory,
        probe,
        localFakeEnabled: true,
      });
      expect(report.redacted).toBe(true);
      expect(report.providerBoundaryAttempts).toBe(1);
      expect(report.durableRefs?.proposalIds).toHaveLength(1);
      expect(report.durableRefs?.proposalIds[0]).toBe(report.effect?.proposalId);
      expect(report.durableRefs?.jobIds.length).toBeGreaterThan(0);
      expect(report.durableRefs?.outboxIds.length).toBeGreaterThan(0);
      expect(report.durableRefs?.attemptTraceIds.length).toBeGreaterThan(0);
      expect(report.effect?.providerBoundaryAttempts).toBe(1);
      expect(report.effect?.kind).toBe("content_publication");
      expect(report.effect?.status).toBe("delivered");
      expect(report.effect?.localFakeBoundaryVerified).toBe(true);
      expect(report.durableRefs?.resultTraceIds.length).toBeGreaterThan(0);
      expect(report.toolChecks).toContainEqual({
        name: "operator.conversation_prepare_replay",
        outcome: "pass",
        code: "MCP_OPERATOR_PREPARE_REPLAY_STABLE",
      });
      expect(report.toolChecks).toContainEqual({
        name: "reviewer.prepare_forbidden",
        outcome: "pass",
        code: "MCP_REVIEWER_PREPARE_FORBIDDEN",
      });
      expect(report.toolChecks).toContainEqual({
        name: "reviewer.approval",
        outcome: "pass",
        code: "MCP_APPROVAL_OK",
      });
      expect(report.toolChecks.every((check) => check.outcome === "pass")).toBe(true);
      expect(report.durableChecks.every((check) => check.outcome === "pass")).toBe(true);
      expect(JSON.stringify(report)).not.toContain("Bearer");
      expect(JSON.stringify(report)).not.toContain(databaseUrl);
    } finally {
      await reader.close();
    }
  });
});
