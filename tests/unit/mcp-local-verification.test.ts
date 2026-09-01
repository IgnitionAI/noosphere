import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildMcpLocalAudienceCurlCommand,
  createMcpLocalConfiguredEdgeProbe,
  createMcpLocalDurableStateReader,
  createMcpLocalEdgeProbe,
  createMcpLocalSdkFactory,
  safeResponseJson,
  verifyMcpLocal,
  type McpLocalConnection,
  type McpLocalDurableState,
  type McpLocalDurableStateQuery,
  type McpLocalSdkClient,
  type McpLocalSdkIdentity,
} from "../../scripts/verify-mcp-local";
import type { McpSmokeFixtureIds } from "../../scripts/prepare-mcp-production-smoke";

const fixtureIds = {
  proposal: { foreign: "00000000-0000-4000-8000-000000000001", viewer: "00000000-0000-4000-8000-000000000002" },
  aggregate: { foreign: "00000000-0000-4000-8000-000000000003", viewer: "00000000-0000-4000-8000-000000000004" },
  content: {
    foreign: {
      assetId: "00000000-0000-4000-8000-000000000003",
      publicationId: "00000000-0000-4000-8000-000000000007",
      campaignId: "00000000-0000-4000-8000-000000000003",
      accountId: "00000000-0000-4000-8000-000000000009",
      providerAccountId: "unit-local-account-0",
    },
    viewer: {
      assetId: "00000000-0000-4000-8000-000000000004",
      publicationId: "00000000-0000-4000-8000-000000000008",
      campaignId: "00000000-0000-4000-8000-000000000004",
      accountId: "00000000-0000-4000-8000-00000000000a",
      providerAccountId: "unit-local-account-1",
    },
  },
  revoked: { accessTokenId: "00000000-0000-4000-8000-000000000005", familyId: "00000000-0000-4000-8000-000000000006" },
} as const;

const durableRefs = {
  proposalIds: [fixtureIds.proposal.foreign, fixtureIds.proposal.viewer],
  intentionIds: ["00000000-0000-4000-8000-000000000021"],
  jobIds: ["00000000-0000-4000-8000-000000000022"],
  outboxIds: ["00000000-0000-4000-8000-000000000023"],
  traceIds: ["00000000-0000-4000-8000-000000000024", "00000000-0000-4000-8000-000000000025"],
  attemptTraceIds: ["00000000-0000-4000-8000-000000000024"],
  resultTraceIds: ["00000000-0000-4000-8000-000000000025"],
  reconciliationIds: ["00000000-0000-4000-8000-000000000026"],
  terminalStatuses: ["approval_required"],
} as const;

const identityLabels = [
  { name: "reviewer", workspaceId: "00000000-0000-4000-8000-000000000011", role: "reviewer", scopes: ["mcp:read", "mcp:write", "mcp:approve"] },
  { name: "operator", workspaceId: "00000000-0000-4000-8000-000000000011", role: "operator", scopes: ["mcp:read", "mcp:write"] },
  { name: "viewer", workspaceId: "00000000-0000-4000-8000-000000000012", role: "viewer", scopes: ["mcp:read"] },
] as const;

const tokenValues = {
  MCP_LOCAL_REVIEWER_TOKEN: "reviewer-token-value",
  MCP_LOCAL_OPERATOR_TOKEN: "operator-token-value",
  MCP_LOCAL_VIEWER_TOKEN: "viewer-token-value",
  MCP_LOCAL_REVOKED_TOKEN: "revoked-token-value",
} as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function configFiles(): Promise<{ configPath: string; tokenPath: string; caPath: string }> {
  const directory = await mkdtemp("/tmp/mcp-local-verification-");
  temporaryDirectories.push(directory);
  const configPath = join(directory, "client.json");
  const tokenPath = join(directory, "fixture.env");
  const caPath = join(directory, "root.crt");
  await writeFile(tokenPath, Object.entries(tokenValues).map(([key, value]) => `${key}='${value}'`).join("\n") + "\n", { mode: 0o600 });
  await chmod(tokenPath, 0o600);
  await writeFile(caPath, "-----BEGIN CERTIFICATE-----\nlocal-test\n-----END CERTIFICATE-----\n", { mode: 0o600 });
  await chmod(caPath, 0o600);
  await writeFile(configPath, JSON.stringify({
    resource: "https://mcp.localhost:18443/mcp",
    transport: "streamable-http",
    legacyTransport: "http",
    caPath,
    tokenFilePath: tokenPath,
    identities: identityLabels,
    redacted: true,
  }), { mode: 0o600 });
  await chmod(configPath, 0o600);
  return { configPath, tokenPath, caPath };
}

function resolveFixtureId(name: "foreignProposal" | "viewerProposal" | "foreignAggregate" | "viewerAggregate" | "revokedAccessToken"): string {
  return {
    foreignProposal: fixtureIds.proposal.foreign,
    viewerProposal: fixtureIds.proposal.viewer,
    foreignAggregate: fixtureIds.aggregate.foreign,
    viewerAggregate: fixtureIds.aggregate.viewer,
    revokedAccessToken: fixtureIds.revoked.accessTokenId,
  }[name];
}

function sdkClient(denied = false, role?: string): McpLocalSdkClient {
  const toolNames = [
    "noosphere_ping",
    "conversation_prepare_reply",
    "content_prepare_publication",
    "meeting_prepare_proposal",
    "campaign_prepare_activation",
    "approval_list",
    "approval_get",
    "approval_decide",
  ];
  return {
    initialize: async () => undefined,
    listTools: async () => ({ tools: toolNames.map((name) => ({ name })) }),
    listResources: async () => ({ resources: [{ uri: "noosphere://runtime", name: "runtime" }] }),
    readResource: async () => ({ contents: [{ uri: "noosphere://runtime", text: "bounded" }] }),
    ping: async () => ({}),
    callTool: async (name) => {
      if (denied && name !== "noosphere_ping") return { isError: true, content: [{ type: "text", text: "denied" }] };
      if (role === "reviewer" && ["conversation_prepare_reply", "content_prepare_publication", "meeting_prepare_proposal", "campaign_prepare_activation"].includes(name)) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "MCP_GOVERNED_EFFECT_FORBIDDEN" }) }], structuredContent: { error: "MCP_GOVERNED_EFFECT_FORBIDDEN" } };
      }
      if (name === "conversation_prepare_reply") return { isError: false, content: [{ type: "text", text: "bounded" }], structuredContent: { proposalId: fixtureIds.proposal.foreign, approvalItemId: "00000000-0000-4000-8000-000000000038", kind: "conversation_reply", status: "approval_required" } };
      if (name === "content_prepare_publication") return { isError: false, content: [{ type: "text", text: "bounded" }], structuredContent: { proposalId: "00000000-0000-4000-8000-000000000031", approvalItemId: "00000000-0000-4000-8000-000000000032", kind: "content_publication", status: "approval_required" } };
      if (name === "campaign_prepare_activation") return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "MCP_EFFECT_ADAPTER_UNAVAILABLE" }) }], structuredContent: { error: "MCP_EFFECT_ADAPTER_UNAVAILABLE" } };
      return { isError: name === "mcp_local_unknown", content: [{ type: "text", text: "bounded" }] };
    },
    close: async () => undefined,
  };
}

function baseOptions(configPath: string) {
  return {
    configPath,
    timeoutMs: 2_000,
    maxCalls: 64,
    fixtureIds,
    resolveFixtureId,
    readDurableStateForProposal: (() => {
      let reads = 0;
      return async (proposalId: string) => {
        reads += 1;
        const settled = reads > 1;
        const refs = settled
          ? { ...durableRefs, proposalIds: [proposalId], intentionIds: ["00000000-0000-4000-8000-000000000031"], jobIds: ["00000000-0000-4000-8000-000000000032"], outboxIds: ["00000000-0000-4000-8000-000000000033"], traceIds: ["00000000-0000-4000-8000-000000000034", "00000000-0000-4000-8000-000000000035"], attemptTraceIds: ["00000000-0000-4000-8000-000000000034"], resultTraceIds: ["00000000-0000-4000-8000-000000000035"], terminalStatuses: ["delivered"] }
          : { ...durableRefs, proposalIds: [proposalId], intentionIds: [], jobIds: [], outboxIds: [], traceIds: [], attemptTraceIds: [], resultTraceIds: [], terminalStatuses: [] };
        return { intentions: settled ? 1 : 0, jobs: settled ? 1 : 0, outbox: settled ? 1 : 0, attempts: settled ? 1 : 0, terminalResults: settled ? 1 : 0, providerBoundaryAttempts: settled ? 1 : 0, refs, proposalStatuses: [settled ? "delivered" : "queued"], ...(settled ? { localFakeBoundaryVerified: true } : {}) };
      };
    })(),
    sdkFactory: async (identity: McpLocalSdkIdentity, _connection: McpLocalConnection) => sdkClient(identity.name === "viewer", identity.name),
    probe: async () => ({ ok: true, code: "MCP_EDGE_PROBE_OK" }),
    localFakeEnabled: true as const,
  };
}

test("reports bounded protocol, tenant, approval, replay, and fake-effect checks", async () => {
  const { configPath } = await configFiles();
  const report = await verifyMcpLocal(baseOptions(configPath));
  expect(report.protocol.modern).toBe(true);
  expect(report.protocol.legacy).toBe(true);
  expect(report.providerBoundaryAttempts).toBe(1);
  expect(report.redacted).toBe(true);
  expect(report.fixtureIds).toEqual({ proposal: fixtureIds.proposal, aggregate: fixtureIds.aggregate });
  expect(JSON.stringify(report)).not.toContain("reviewer-token-value");
});

test("treats reviewer prepare as a forbidden negative and keeps operator as the writer", async () => {
  const { configPath } = await configFiles();
  const calls: Array<{ identity: string; name: string }> = [];
  await expect(verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async (identity) => {
      const client = sdkClient(identity.name === "viewer", identity.name);
      return {
        ...client,
        callTool: async (name, args) => {
          calls.push({ identity: identity.name, name });
          if (identity.name === "reviewer" && name === "conversation_prepare_reply") {
            return {
              isError: true,
              content: [{ type: "text", text: JSON.stringify({ error: "MCP_GOVERNED_EFFECT_FORBIDDEN" }) }],
              structuredContent: { error: "MCP_GOVERNED_EFFECT_FORBIDDEN" },
            };
          }
          return client.callTool(name, args);
        },
      };
    },
  })).resolves.toMatchObject({
    toolChecks: expect.arrayContaining([
      { name: "operator.conversation_prepare_replay", outcome: "pass", code: "MCP_OPERATOR_PREPARE_REPLAY_STABLE" },
      { name: "reviewer.prepare_forbidden", outcome: "pass", code: "MCP_REVIEWER_PREPARE_FORBIDDEN" },
    ]),
  });
  expect(calls.find(({ identity, name }) => identity === "reviewer" && name === "conversation_prepare_reply")).toBeDefined();
  expect(calls.filter(({ identity, name }) => identity === "operator" && name === "conversation_prepare_reply")).toHaveLength(2);
});

test("sends only the approval_decide contract fields", async () => {
  const { configPath } = await configFiles();
  const seenApprovalArgs: Array<Readonly<Record<string, string | number | boolean | null>>> = [];
  const report = await verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async (identity) => {
      const client = sdkClient(identity.name === "viewer", identity.name);
      return {
        ...client,
        callTool: async (name, args) => {
          if (identity.name === "reviewer" && name === "approval_decide") seenApprovalArgs.push(args);
          return client.callTool(name, args);
        },
      };
    },
  });
  expect(report.toolChecks).toContainEqual({ name: "reviewer.approval", outcome: "pass", code: "MCP_APPROVAL_OK" });
  expect(seenApprovalArgs).toEqual([
    { approvalItemId: "00000000-0000-4000-8000-000000000038", decision: "approve" },
    { approvalItemId: "00000000-0000-4000-8000-000000000032", decision: "approve" },
  ]);
});

test("rejects an operator replay whose bounded result changes", async () => {
  const { configPath } = await configFiles();
  let conversationCalls = 0;
  await expect(verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async (identity) => {
      const client = sdkClient(identity.name === "viewer", identity.name);
      return {
        ...client,
        callTool: async (name, args) => {
          const result = await client.callTool(name, args);
          if (identity.name === "operator" && name === "conversation_prepare_reply") {
            conversationCalls += 1;
            if (conversationCalls === 2) return { ...result, content: [{ type: "text", text: "changed bounded result" }] };
          }
          return result;
        },
      };
    },
  })).rejects.toMatchObject({ code: "MCP_LOCAL_APPROVAL_ITEM_MISSING" });
});

test("resolves the role matrix by name regardless of config order", async () => {
  const { configPath, caPath, tokenPath } = await configFiles();
  await writeFile(configPath, JSON.stringify({
    resource: "https://mcp.localhost:18443/mcp",
    transport: "streamable-http",
    legacyTransport: "http",
    caPath,
    tokenFilePath: tokenPath,
    identities: [identityLabels[2], identityLabels[0], identityLabels[1]],
    redacted: true,
  }));
  await chmod(configPath, 0o600);
  const report = await verifyMcpLocal({ ...baseOptions(configPath) });
  expect(report.protocol.modern).toBe(true);
  expect(report.protocol.legacy).toBe(true);
});

test("rejects a reviewer/operator split across workspaces", async () => {
  const { configPath, caPath, tokenPath } = await configFiles();
  await writeFile(configPath, JSON.stringify({
    resource: "https://mcp.localhost:18443/mcp",
    transport: "streamable-http",
    legacyTransport: "http",
    caPath,
    tokenFilePath: tokenPath,
    identities: [identityLabels[0], { ...identityLabels[1], workspaceId: "00000000-0000-4000-8000-000000000013" }, identityLabels[2]],
    redacted: true,
  }));
  await chmod(configPath, 0o600);
  await expect(verifyMcpLocal({ ...baseOptions(configPath) })).rejects.toMatchObject({ code: "MCP_LOCAL_IDENTITY_MATRIX_INVALID" });
});

test("fails closed when the local fake worker is not explicitly enabled", async () => {
  const { configPath } = await configFiles();
  await expect(verifyMcpLocal({ ...baseOptions(configPath), localFakeEnabled: undefined } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_FAKE_MODE_REQUIRED" });
});

test("reads only generated proposal state through the scoped reader seam", async () => {
  const { configPath } = await configFiles();
  const base = baseOptions(configPath);
  const calls: Array<{ proposalId: string; workspaceId: string }> = [];
  await expect(verifyMcpLocal({
    ...base,
    readDurableStateForProposal: async (proposalId, workspaceId) => {
      calls.push({ proposalId, workspaceId });
      return base.readDurableStateForProposal(proposalId);
    },
  })).resolves.toMatchObject({ effect: { kind: "content_publication" } });
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(({ proposalId }) => proposalId !== fixtureIds.proposal.foreign && proposalId !== fixtureIds.proposal.viewer)).toBe(true);
});

test("does not classify a campaign failed status as adapter-unavailable", async () => {
  const { configPath } = await configFiles();
  await expect(verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async (identity) => {
      const client = sdkClient(identity.name === "viewer", identity.name);
      return {
        ...client,
        callTool: async (name, args) => {
          if (name === "campaign_prepare_activation") {
            return {
              isError: false,
              content: [{ type: "text", text: "bounded" }],
              structuredContent: {
                proposalId: fixtureIds.proposal.foreign,
                approvalItemId: "00000000-0000-4000-8000-000000000039",
                kind: "campaign_activation",
                status: "approval_required",
              },
            };
          }
          if (name === "approval_decide") {
            return { isError: false, content: [{ type: "text", text: "bounded" }], structuredContent: { status: "failed" } };
          }
          return client.callTool(name, args);
        },
      };
    },
  })).rejects.toMatchObject({ code: "MCP_LOCAL_CAMPAIGN_UNAVAILABLE_INVALID" });
});

test("never includes secret-like values in a failure report", async () => {
  const { configPath } = await configFiles();
  const report = await verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async () => { throw new Error("Bearer hidden-token database=postgres://secret"); },
  }).catch((error: unknown) => (error as { report: { redacted: boolean; message?: string } }).report) as unknown as { redacted: boolean; message?: string };
  expect(report.redacted).toBe(true);
  expect(report.message).toBeUndefined();
  expect(JSON.stringify(report)).not.toContain("hidden-token");
  expect(JSON.stringify(report)).not.toContain("postgres://");
});

test("closes a client when a bounded verifier call times out", async () => {
  const { configPath } = await configFiles();
  let closed = 0;
  const result = await verifyMcpLocal({
    ...baseOptions(configPath),
    timeoutMs: 10,
    sdkFactory: async (identity, _connection) => ({
      ...sdkClient(identity.name === "viewer", identity.name),
      listTools: async () => new Promise<never>(() => undefined),
      close: async () => { closed += 1; },
    }),
  }).catch((error: unknown) => (error as { report: { redacted: boolean } }).report) as unknown as { redacted: boolean };
  expect(result.redacted).toBe(true);
  expect(closed).toBeGreaterThan(0);
});

test("reads durable fixture state from a scoped query without inventing zero counters", async () => {
  let queriedFixtureIds: McpSmokeFixtureIds | undefined;
  let queriedWorkspaces: readonly string[] | undefined;
  const query: McpLocalDurableStateQuery = async ({ fixtureIds, workspaceIds }) => {
    queriedFixtureIds = fixtureIds;
    queriedWorkspaces = workspaceIds;
    return {
      intentions: 1,
      jobs: 1,
      outbox: 1,
      attempts: 1,
      terminalResults: 1,
      providerBoundaryAttempts: 1,
      reconciliations: 1,
      proposalStatuses: ["delivered"],
      refs: {
        proposalIds: [fixtureIds.proposal.foreign],
        intentionIds: ["00000000-0000-4000-8000-000000000021"],
        jobIds: ["00000000-0000-4000-8000-000000000022"],
        outboxIds: ["00000000-0000-4000-8000-000000000023"],
        traceIds: ["00000000-0000-4000-8000-000000000024", "00000000-0000-4000-8000-000000000025"],
        attemptTraceIds: ["00000000-0000-4000-8000-000000000024"],
        resultTraceIds: ["00000000-0000-4000-8000-000000000025"],
        reconciliationIds: ["00000000-0000-4000-8000-000000000026"],
        terminalStatuses: ["delivered"],
      },
    };
  };
  const reader = createMcpLocalDurableStateReader({
    databaseUrl: "postgres://local@127.0.0.1/noosphere_test",
    fixtureIds,
    identityLabels,
    query,
  });
  const state = await reader.readProposal(fixtureIds.proposal.foreign, identityLabels[0]!.workspaceId);
  expect(state.intentions).toBe(1);
  expect(queriedFixtureIds).toEqual(fixtureIds);
  expect(queriedWorkspaces).toEqual([identityLabels[0]!.workspaceId, identityLabels[2]!.workspaceId]);
  expect(state.refs?.jobIds).toEqual(["00000000-0000-4000-8000-000000000022"]);
  await reader.close();
});

test("maps durable reader workspaces by identity roles, not configuration order", async () => {
  let queriedWorkspaces: readonly string[] | undefined;
  const query: McpLocalDurableStateQuery = async ({ workspaceIds }) => {
    queriedWorkspaces = workspaceIds;
    return {
      intentions: 1, jobs: 1, outbox: 1, attempts: 1, terminalResults: 1, providerBoundaryAttempts: 1,
      proposalStatuses: ["delivered"],
      refs: { ...durableRefs, proposalIds: [fixtureIds.proposal.foreign], terminalStatuses: ["delivered"] },
    };
  };
  const permuted = [identityLabels[2], identityLabels[1], identityLabels[0]] as const;
  const reader = createMcpLocalDurableStateReader({
    databaseUrl: "postgres://local@127.0.0.1/noosphere_test",
    fixtureIds,
    workspaceIds: permuted.map((identity) => identity.workspaceId),
    identityLabels: permuted,
    query,
  });
  await reader.readProposal(fixtureIds.proposal.foreign, identityLabels[0]!.workspaceId);
  expect(queriedWorkspaces).toEqual([identityLabels[0]!.workspaceId, identityLabels[2]!.workspaceId]);
  await reader.close();
});

test("fails closed when a durable reader omits bounded row references", async () => {
  const reader = createMcpLocalDurableStateReader({
    databaseUrl: "postgres://local@127.0.0.1/noosphere_test",
    fixtureIds,
    identityLabels,
    query: async () => ({ intentions: 0, jobs: 0, outbox: 0, attempts: 0, terminalResults: 0, providerBoundaryAttempts: 0 } as unknown as McpLocalDurableState),
  });
  await expect(reader.readProposal(fixtureIds.proposal.foreign, identityLabels[0]!.workspaceId)).rejects.toThrow("MCP_LOCAL_DURABLE_REFS_MISSING");
  await reader.close();
});

test("fails before SDK connection when the configured CA is missing", async () => {
  await expect(createMcpLocalSdkFactory(
    { ...identityLabels[0], token: tokenValues.MCP_LOCAL_REVIEWER_TOKEN },
    {
      endpoint: "https://mcp.localhost:18443/mcp",
      resource: "https://mcp.localhost:18443/mcp",
      caPath: "/tmp/mcp-local-verification-ca-missing.crt",
      timeoutMs: 2_000,
      era: "modern",
    },
  )).rejects.toThrow("MCP_LOCAL_CA_INVALID");
});

test("rejects a client configuration whose private file is world-readable", async () => {
  const { configPath } = await configFiles();
  await chmod(configPath, 0o644);
  await expect(verifyMcpLocal(baseOptions(configPath))).rejects.toMatchObject({ code: "MCP_LOCAL_CONFIG_PERMISSIONS_INVALID" });
});

test("requires a real edge probe instead of reporting unavailable probes", async () => {
  const { configPath } = await configFiles();
  await expect(verifyMcpLocal({ ...baseOptions(configPath), probe: undefined })).rejects.toMatchObject({ code: "MCP_LOCAL_EDGE_PROBE_REQUIRED" });
});

test("runs every bounded edge probe through the injected harness", async () => {
  const { configPath } = await configFiles();
  const seen: string[] = [];
  await verifyMcpLocal({
    ...baseOptions(configPath),
    probe: async (input) => {
      seen.push(input.kind);
      return { ok: true, code: "MCP_EDGE_PROBE_OK" };
    },
  });
  expect(seen).toEqual(["malformed", "body_limit", "rate_limit", "origin", "audience", "correlation"]);
});

test("initializes the operator before invoking its tools", async () => {
  const { configPath } = await configFiles();
  const lifecycle: string[] = [];
  const initialized = new WeakSet<object>();
  const guardedClient = (identityName: string): McpLocalSdkClient => {
    const client: McpLocalSdkClient = {
      initialize: async () => { lifecycle.push(`${identityName}:initialize`); initialized.add(client); },
      listTools: async () => { if (!initialized.has(client)) throw new Error("MCP_LOCAL_SDK_NOT_INITIALIZED"); return { tools: [{ name: "noosphere_ping" }, { name: "conversation_prepare_reply" }, { name: "content_prepare_publication" }, { name: "meeting_prepare_proposal" }, { name: "campaign_prepare_activation" }, { name: "approval_list" }, { name: "approval_get" }, { name: "approval_decide" }] }; },
      listResources: async () => { if (!initialized.has(client)) throw new Error("MCP_LOCAL_SDK_NOT_INITIALIZED"); return { resources: [{ uri: "noosphere://runtime" }] }; },
      readResource: async () => { if (!initialized.has(client)) throw new Error("MCP_LOCAL_SDK_NOT_INITIALIZED"); return { contents: [{ uri: "noosphere://runtime", text: "bounded" }] }; },
      ping: async () => { if (!initialized.has(client)) throw new Error("MCP_LOCAL_SDK_NOT_INITIALIZED"); return {}; },
      callTool: async (name) => {
        if (!initialized.has(client)) throw new Error("MCP_LOCAL_SDK_NOT_INITIALIZED");
        if (name === "conversation_prepare_reply" && identityName === "reviewer") {
          return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "MCP_GOVERNED_EFFECT_FORBIDDEN" }) }], structuredContent: { error: "MCP_GOVERNED_EFFECT_FORBIDDEN" } };
        }
        if (name === "conversation_prepare_reply") return { isError: false, content: [{ type: "text", text: "bounded" }], structuredContent: { proposalId: fixtureIds.proposal.foreign, approvalItemId: "00000000-0000-4000-8000-000000000038", kind: "conversation_reply", status: "approval_required" } };
        if (name === "content_prepare_publication") return { isError: false, content: [{ type: "text", text: "bounded" }], structuredContent: { proposalId: "00000000-0000-4000-8000-000000000031", approvalItemId: "00000000-0000-4000-8000-000000000032", kind: "content_publication", status: "approval_required" } };
        if (name === "campaign_prepare_activation") return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "MCP_EFFECT_ADAPTER_UNAVAILABLE" }) }], structuredContent: { error: "MCP_EFFECT_ADAPTER_UNAVAILABLE" } };
        return { isError: false, content: [{ type: "text", text: "bounded" }] };
      },
      close: async () => { lifecycle.push(`${identityName}:close`); },
    };
    return client;
  };
  const report = await verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async (identity) => guardedClient(identity.name),
  });
  expect(report.protocol.modern).toBe(true);
  expect(lifecycle).toContain("operator:initialize");
  expect(lifecycle.indexOf("operator:initialize")).toBeLessThan(lifecycle.indexOf("operator:close"));
});

test("uses raw ping fallback only for legacy when the SDK omits Client.ping", async () => {
  const { configPath } = await configFiles();
  let rawPingCalls = 0;
  const negotiatedEras: McpLocalConnection["era"][] = [];
  const report = await verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async (identity, connection) => {
      negotiatedEras.push(connection.era);
      const { ping: _unsupportedPing, ...withoutSdkPing } = sdkClient(identity.name === "viewer", identity.name);
      return {
        ...withoutSdkPing,
        rawPing: async () => {
          rawPingCalls += 1;
          return {};
        },
      } as McpLocalSdkClient;
    },
  });
  expect(negotiatedEras).toEqual(["modern", "legacy", "modern", "legacy"]);
  expect(rawPingCalls).toBe(1);
  expect(report.protocol.modern).toBe(true);
  expect(report.protocol.legacy).toBe(true);
  expect(report.toolChecks).toContainEqual({
    name: "modern.ping",
    outcome: "pass",
    code: "MCP_PROTOCOL_PING_NOT_APPLICABLE",
  });
});

test("requires noosphere_ping as the explicit modern protocol ping proof", async () => {
  const { configPath } = await configFiles();
  const report = await verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async (identity) => {
      const client = sdkClient(identity.name === "viewer", identity.name);
      return {
        ...client,
        listTools: async () => ({ tools: (await client.listTools()).tools.filter(({ name }) => name !== "noosphere_ping") }),
      };
    },
  });
  expect(report.protocol.modern).toBe(false);
  expect(report.toolChecks).toContainEqual({
    name: "modern.noosphere_ping",
    outcome: "fail",
    code: "MCP_TOOL_PING_REQUIRED",
  });
});

test("does not mask a real SDK ping failure with the raw fallback", async () => {
  const { configPath } = await configFiles();
  let rawPingCalls = 0;
  await expect(verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async (identity) => ({
      ...sdkClient(identity.name === "viewer", identity.name),
      ping: async () => { throw new Error("MCP_LOCAL_PING_REAL_FAILURE"); },
      rawPing: async () => { rawPingCalls += 1; return {}; },
    }),
  })).rejects.toMatchObject({ code: "MCP_LOCAL_PING_REAL_FAILURE" });
  expect(rawPingCalls).toBe(0);
});

test("negotiates SSE ping for modern and legacy after a JSON-only 406", async () => {
  const { caPath } = await configFiles();
  const seen: Array<{ accept: string | null; protocol: string | null; authorization: string | null }> = [];
  const fetchImpl = async (_input: string | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    seen.push({
      accept: headers.get("accept"),
      protocol: headers.get("mcp-protocol-version"),
      authorization: headers.get("authorization"),
    });
    if (headers.get("accept") !== "application/json, text/event-stream") {
      return new Response("not acceptable", { status: 406 });
    }
    return new Response('event: message\r\n: keepalive\r\ndata: {"jsonrpc":"2.0","result":{}}\r\n\r\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  const rejected = await fetchImpl("https://mcp.localhost:18443/mcp", { headers: { accept: "application/json" } });
  expect(rejected.status).toBe(406);
  seen.splice(0);
  for (const era of ["modern", "legacy"] as const) {
    const client = await createMcpLocalSdkFactory(
      { ...identityLabels[0], token: tokenValues.MCP_LOCAL_REVIEWER_TOKEN },
      {
        endpoint: "https://mcp.localhost:18443/mcp",
        resource: "https://mcp.localhost:18443/mcp",
        caPath,
        timeoutMs: 2_000,
        era,
      },
      fetchImpl,
    );
    await expect(client.rawPing?.()).resolves.toEqual({});
  }
  expect(seen).toEqual([
    { accept: "application/json, text/event-stream", protocol: "2026-07-28", authorization: `Bearer ${tokenValues.MCP_LOCAL_REVIEWER_TOKEN}` },
    { accept: "application/json, text/event-stream", protocol: "2025-06-18", authorization: `Bearer ${tokenValues.MCP_LOCAL_REVIEWER_TOKEN}` },
  ]);
});

test("parses one bounded MCP SSE message with event, comments, CRLF, and joined data", async () => {
  const response = new Response([
    "event: message",
    ": keepalive",
    'data: {"jsonrpc":"2.0",',
    'data: "result":{"ok":true}}',
    "",
    ": trailer heartbeat",
    "",
  ].join("\r\n"), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
  await expect(safeResponseJson(response)).resolves.toEqual({ jsonrpc: "2.0", result: { ok: true } });
});

test("rejects ambiguous or malformed bounded MCP SSE bodies", async () => {
  const multiple = new Response("event: message\ndata: {}\n\nevent: message\ndata: {}\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  await expect(safeResponseJson(multiple)).resolves.toBeNull();

  const malformed = new Response("event: message\ndata: {\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  await expect(safeResponseJson(malformed)).resolves.toBeNull();

  const malformedField = new Response("event message\ndata: {}\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  await expect(safeResponseJson(malformedField)).resolves.toBeNull();

  const oversized = new Response(`event: message\ndata: ${"x".repeat(66_000)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  await expect(safeResponseJson(oversized)).rejects.toThrow("MCP_LOCAL_EDGE_RESPONSE_TOO_LARGE");
});

test("builds a CA-bound edge probe without returning response bodies", async () => {
  const { configPath, caPath } = await configFiles();
  const probe = await createMcpLocalEdgeProbe({
    identity: { ...identityLabels[2], token: tokenValues.MCP_LOCAL_VIEWER_TOKEN },
    connection: {
      endpoint: "https://mcp.localhost:18443/mcp",
      resource: "https://mcp.localhost:18443/mcp",
      caPath,
      timeoutMs: 2_000,
      era: "legacy",
    },
    fetchImpl: async (_input, init) => new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request", data: { code: "INVALID_JSON_RPC" } } }), {
      status: 400,
      headers: { "content-type": "application/json", "x-correlation-id": new Headers(init?.headers).get("x-correlation-id") ?? "" },
    }),
  });
  const result = await probe({ kind: "malformed" });
  expect(result).toEqual({ ok: true, code: "MCP_JSONRPC_INVALID_REQUEST" });
});

test("rejects an internal string code without the JSON-RPC invalid-request envelope", async () => {
  const { caPath } = await configFiles();
  const probe = await createMcpLocalEdgeProbe({
    identity: { ...identityLabels[2], token: tokenValues.MCP_LOCAL_VIEWER_TOKEN },
    connection: {
      endpoint: "https://mcp.localhost:18443/mcp",
      resource: "https://mcp.localhost:18443/mcp",
      caPath,
      timeoutMs: 2_000,
      era: "legacy",
    },
    fetchImpl: async () => new Response(JSON.stringify({ code: "INVALID_JSON_RPC" }), {
      status: 400,
      headers: { "content-type": "application/json", "x-correlation-id": "mcp-local-probe-malformed" },
    }),
  });
  await expect(probe({ kind: "malformed" })).resolves.toEqual({ ok: false, code: "MCP_EDGE_MALFORMED_INVALID" });
});

test("pins the allowed endpoint as TLS SNI while sending a foreign Host", async () => {
  const { caPath } = await configFiles();
  const seen: { hostname: string; servername: string; host: string; caPath: string }[] = [];
  const probe = await createMcpLocalEdgeProbe({
    identity: { ...identityLabels[2], token: tokenValues.MCP_LOCAL_VIEWER_TOKEN },
    connection: {
      endpoint: "https://mcp.localhost:18443/mcp",
      resource: "https://mcp.localhost:18443/mcp",
      caPath,
      timeoutMs: 2_000,
      era: "modern",
    },
    audienceRequest: async (options) => {
      seen.push({ hostname: options.endpoint.hostname, servername: options.servername, host: options.host, caPath: options.caPath });
      return new Response(JSON.stringify({ code: "MCP_HOST_NOT_ALLOWED" }), {
        status: 403,
        headers: { "content-type": "application/json", "x-correlation-id": "mcp-local-probe-audience" },
      });
    },
  });
  await expect(probe({ kind: "audience" })).resolves.toEqual({ ok: true, code: "MCP_HOST_NOT_ALLOWED" });
  expect(seen).toEqual([{ hostname: "mcp.localhost", servername: "mcp.localhost", host: "foreign.invalid", caPath }]);
});

test("configured edge probe sends the complete modern correlation call envelope", async () => {
  const { configPath } = await configFiles();
  let capturedBody: Record<string, unknown> | undefined;
  let capturedHeaders: Record<string, string> | undefined;
  const probe = await createMcpLocalConfiguredEdgeProbe(configPath, 2_000, {
    fetchImpl: async (_input: unknown, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      capturedBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
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
    origin: "https://mcp.localhost:18443",
    "x-correlation-id": "mcp-local-probe-correlation",
  });
  expect(capturedHeaders?.authorization).toMatch(/^Bearer \S+$/);
});

test("builds the audience probe with pinned loopback TLS and no bearer or insecure TLS flag", async () => {
  const { caPath } = await configFiles();
  const command = buildMcpLocalAudienceCurlCommand({
    endpoint: new URL("https://mcp.localhost:18443/mcp"),
    servername: "mcp.localhost",
    host: "foreign.invalid",
    caPath,
    correlationId: "mcp-local-probe-audience",
    timeoutMs: 2_000,
  });
  expect(command.executable).toBe("/usr/bin/curl");
  expect(command.args).toContain("--resolve");
  expect(command.args).toContain("mcp.localhost:18443:127.0.0.1");
  expect(command.args).toContain("Host: foreign.invalid");
  expect(command.args).toContain("--cacert");
  expect(command.args).not.toContain("-k");
  expect(command.args.some((arg) => arg.toLowerCase().includes("authorization"))).toBe(false);
});

test("fails the probe when the CA-bound HTTPS seam reports a TLS error", async () => {
  const { caPath } = await configFiles();
  let requestCalls = 0;
  const probe = await createMcpLocalEdgeProbe({
    identity: { ...identityLabels[2], token: tokenValues.MCP_LOCAL_VIEWER_TOKEN },
    connection: {
      endpoint: "https://mcp.localhost:18443/mcp",
      resource: "https://mcp.localhost:18443/mcp",
      caPath,
      timeoutMs: 2_000,
      era: "modern",
    },
    audienceRequest: async () => {
      requestCalls += 1;
      throw new Error("MCP_LOCAL_TLS_HANDSHAKE_FAILED");
    },
  });
  await expect(probe({ kind: "audience" })).rejects.toThrow("MCP_LOCAL_EDGE_PROBE_FAILED");
  expect(requestCalls).toBe(1);
});

test("requires matching bounded correlation in the response header and JSON-RPC result", async () => {
  const { caPath } = await configFiles();
  let requestBody: Record<string, unknown> | undefined;
  const probe = await createMcpLocalEdgeProbe({
    identity: { ...identityLabels[2], token: tokenValues.MCP_LOCAL_VIEWER_TOKEN },
    connection: {
      endpoint: "https://mcp.localhost:18443/mcp",
      resource: "https://mcp.localhost:18443/mcp",
      caPath,
      timeoutMs: 2_000,
      era: "modern",
    },
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "correlation",
        result: { structuredContent: { ok: true, correlationId: "mcp-local-probe-correlation" } },
      }), { status: 200, headers: { "content-type": "application/json", "x-correlation-id": "mcp-local-probe-correlation" } });
    },
  });
  await expect(probe({ kind: "correlation" })).resolves.toEqual({ ok: true, code: "MCP_CORRELATION_OK" });
  expect(requestBody).toMatchObject({
    params: {
      name: "noosphere_ping",
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        correlationId: "mcp-local-probe-correlation",
      },
    },
  });
});

test("rejects an absent or invented JSON-RPC correlation", async () => {
  const { caPath } = await configFiles();
  const response = (correlationId: string | undefined) => new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: "correlation",
    result: correlationId === undefined ? { tools: [] } : { structuredContent: { correlationId } },
  }), { status: 200, headers: { "content-type": "application/json", "x-correlation-id": "mcp-local-probe-correlation" } });
  const probe = await createMcpLocalEdgeProbe({
    identity: { ...identityLabels[2], token: tokenValues.MCP_LOCAL_VIEWER_TOKEN },
    connection: {
      endpoint: "https://mcp.localhost:18443/mcp",
      resource: "https://mcp.localhost:18443/mcp",
      caPath,
      timeoutMs: 2_000,
      era: "modern",
    },
    fetchImpl: async () => response(undefined),
  });
  await expect(probe({ kind: "correlation" })).resolves.toEqual({ ok: false, code: "MCP_EDGE_CORRELATION_INVALID" });

  const inventedProbe = await createMcpLocalEdgeProbe({
    identity: { ...identityLabels[2], token: tokenValues.MCP_LOCAL_VIEWER_TOKEN },
    connection: {
      endpoint: "https://mcp.localhost:18443/mcp",
      resource: "https://mcp.localhost:18443/mcp",
      caPath,
      timeoutMs: 2_000,
      era: "modern",
    },
    fetchImpl: async () => response("invented-correlation"),
  });
  await expect(inventedProbe({ kind: "correlation" })).resolves.toEqual({ ok: false, code: "MCP_EDGE_CORRELATION_INVALID" });
});

test("reaches the bounded maxCost=100 rate limit with harmless tools/list requests", async () => {
  const { caPath } = await configFiles();
  let requests = 0;
  const bodies: string[] = [];
  const probe = await createMcpLocalEdgeProbe({
    identity: { ...identityLabels[2], token: tokenValues.MCP_LOCAL_VIEWER_TOKEN },
    connection: {
      endpoint: "https://mcp.localhost:18443/mcp",
      resource: "https://mcp.localhost:18443/mcp",
      caPath,
      timeoutMs: 2_000,
      era: "modern",
    },
    fetchImpl: async (_input, init) => {
      requests += 1;
      bodies.push(typeof init?.body === "string" ? init.body : "");
      if (requests <= 100) return new Response(JSON.stringify({ jsonrpc: "2.0", id: requests, result: {} }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ code: "RATE_LIMITED" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
    },
  });
  await expect(probe({ kind: "rate_limit" })).resolves.toEqual({ ok: true, code: "RATE_LIMITED" });
  expect(requests).toBe(101);
  expect(bodies.every((body) => JSON.parse(body).method === "tools/list")).toBe(true);
});

test("executes a real content replay and campaign-unavailable journey with durable scoped evidence", async () => {
  const { configPath } = await configFiles();
  const contentProposalId = "00000000-0000-4000-8000-000000000031";
  const contentApprovalItemId = "00000000-0000-4000-8000-000000000032";
  const conversationApprovalItemId = "00000000-0000-4000-8000-000000000038";
  const contentIntentionId = "00000000-0000-4000-8000-000000000033";
  const contentJobId = "00000000-0000-4000-8000-000000000034";
  const contentOutboxId = "00000000-0000-4000-8000-000000000035";
  const contentAttemptTraceId = "00000000-0000-4000-8000-000000000036";
  const contentResultTraceId = "00000000-0000-4000-8000-000000000037";
  let contentCalls = 0;
  let decisionApprovalItemId: string | undefined;
  const contentPrepareActors: string[] = [];
  const decisionActors: string[] = [];
  let scopedReads = 0;
  const contentState = (settled: boolean): McpLocalDurableState => ({
    intentions: settled ? 1 : 0,
    jobs: settled ? 1 : 0,
    outbox: settled ? 1 : 0,
    attempts: settled ? 1 : 0,
    terminalResults: settled ? 1 : 0,
    providerBoundaryAttempts: settled ? 1 : 0,
    refs: {
      proposalIds: [contentProposalId],
      intentionIds: settled ? [contentIntentionId] : [],
      jobIds: settled ? [contentJobId] : [],
      outboxIds: settled ? [contentOutboxId] : [],
      traceIds: settled ? [contentAttemptTraceId, contentResultTraceId] : [],
      attemptTraceIds: settled ? [contentAttemptTraceId] : [],
      resultTraceIds: settled ? [contentResultTraceId] : [],
      reconciliationIds: [],
      terminalStatuses: settled ? ["delivered"] : [],
    },
    proposalStatuses: [settled ? "delivered" : "queued"],
    ...(settled ? { localFakeBoundaryVerified: true } : {}),
  });
  const contentProposal = {
    proposalId: contentProposalId,
    approvalItemId: contentApprovalItemId,
    kind: "content_publication",
    status: "approval_required",
  };
  const strictClient = (identity: McpLocalSdkIdentity): McpLocalSdkClient => {
    let initialized = false;
    return {
      initialize: async () => { initialized = true; },
      listTools: async () => ({ tools: ["noosphere_ping", ...REQUIRED_TOOL_NAMES].map((name) => ({ name })) }),
      listResources: async () => ({ resources: [{ uri: "noosphere://runtime" }] }),
      readResource: async () => ({ contents: [{ uri: "noosphere://runtime", text: "bounded" }] }),
      ping: async () => ({}),
      callTool: async (name, args) => {
        if (!initialized) throw new Error("MCP_LOCAL_SDK_NOT_INITIALIZED");
        if (identity.name === "reviewer" && name === "conversation_prepare_reply") {
          return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "MCP_GOVERNED_EFFECT_FORBIDDEN" }) }], structuredContent: { error: "MCP_GOVERNED_EFFECT_FORBIDDEN" } };
        }
        if (name === "content_prepare_publication") {
          contentCalls += 1;
          contentPrepareActors.push(identity.name);
          if (typeof args.requestKey !== "string" || !UUID_PATTERN.test(args.requestKey) || args.assetId !== fixtureIds.content.foreign.assetId) {
            throw new Error("MCP_LOCAL_CONTENT_ARGS_INVALID");
          }
          return { isError: false, content: [{ type: "text", text: JSON.stringify(contentProposal) }], structuredContent: contentProposal };
        }
        if (name === "campaign_prepare_activation") {
          return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "MCP_EFFECT_ADAPTER_UNAVAILABLE" }) }], structuredContent: { error: "MCP_EFFECT_ADAPTER_UNAVAILABLE" } };
        }
        if (name === "approval_decide") {
          decisionActors.push(identity.name);
          decisionApprovalItemId = typeof args.approvalItemId === "string" ? args.approvalItemId : undefined;
          if (decisionApprovalItemId !== contentApprovalItemId && decisionApprovalItemId !== conversationApprovalItemId && decisionApprovalItemId !== fixtureIds.proposal.viewer) throw new Error("MCP_LOCAL_APPROVAL_ITEM_BINDING_INVALID");
        }
        if (identity.name === "viewer" && name !== "noosphere_ping") return { isError: true, content: [{ type: "text", text: "denied" }] };
        return { isError: false, content: [{ type: "text", text: "bounded" }], structuredContent: name === "conversation_prepare_reply" ? { ...contentProposal, kind: "conversation_reply", proposalId: fixtureIds.proposal.foreign, approvalItemId: conversationApprovalItemId } : {} };
      },
      close: async () => undefined,
    };
  };
  const report = await verifyMcpLocal({
    ...baseOptions(configPath),
    sdkFactory: async (identity) => strictClient(identity),
    readDurableStateForProposal: async (proposalId, workspaceId) => {
      expect(proposalId).toBe(contentProposalId);
      expect(workspaceId).toBe(identityLabels[0]!.workspaceId);
      scopedReads += 1;
      return contentState(scopedReads > 1);
    },
  });
  expect(contentCalls).toBe(2);
  expect(contentPrepareActors).toEqual(["operator", "operator"]);
  expect(decisionActors).toContain("reviewer");
  expect(decisionApprovalItemId).toBe(contentApprovalItemId);
  expect(report.effect?.kind).toBe("content_publication");
  expect(report.effect?.providerBoundaryAttempts).toBe(1);
  expect(report.effect?.localFakeBoundaryVerified).toBe(true);
  expect(report.effect?.replayStable).toBe(true);
  expect(report.effect?.beforeRefs.intentionIds).toEqual([]);
  expect(report.effect?.afterRefs.intentionIds).toEqual([contentIntentionId]);
  expect(report.effect?.durableRefs.attemptTraceIds).toEqual([contentAttemptTraceId]);
  expect(report.durableRefs?.proposalIds).toEqual([contentProposalId]);
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_TOOL_NAMES = [
  "conversation_prepare_reply", "content_prepare_publication", "meeting_prepare_proposal",
  "campaign_prepare_activation", "approval_list", "approval_get", "approval_decide",
] as const;
