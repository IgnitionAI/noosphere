import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, test } from "bun:test";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";
import type {
  McpEffectProposal,
  McpEffectStatusView,
  McpGovernedEffectCapabilities,
} from "@outbound/application/mcp/mcp-governed-effects";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";
import { createMcpTransport } from "@outbound/interface/mcp/mcp-transport";
import { MCP_GOVERNED_EFFECT_TOOL_NAMES } from "@outbound/interface/mcp/mcp-governed-effect-contracts";

const allScopes = ["mcp:read", "mcp:write", "mcp:approve"] as const;
const proposal: McpEffectProposal = {
  proposalId: "proposal-1",
  workspaceId: "workspace-1",
  kind: "conversation_reply",
  status: "approval_required",
  approvalItemId: "approval-1",
  correlationId: "correlation-1",
  version: 1,
  revision: 1,
  sourceVersion: 1,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};
const status: McpEffectStatusView = {
  ...proposal,
  policyCode: "OK",
  operationId: null,
  jobId: null,
  reconciliationId: null,
  approvalDecision: null,
  intent: {
    kind: "conversation_reply",
    aggregateId: "conversation-1",
    body: "A bounded reviewer intent",
    revision: 1,
    sourceVersion: 1,
  },
  redacted: true,
};

function context(role: McpExecutionContext["role"] = "reviewer", scopes: readonly McpExecutionContext["scopes"][number][] = allScopes): McpExecutionContext {
  return {
    userId: "user-1",
    workspaceId: "workspace-1",
    clientId: "client-1",
    role,
    scopes,
    audience: "https://example.test/mcp",
  };
}

function runtime(
  governed: McpGovernedEffectCapabilities,
  authorize: () => McpExecutionContext = () => context(),
) {
  return createMcpTransport({
    capabilities: { mcpGovernedEffects: governed } as RuntimeCapabilities,
    allowedHosts: ["example.test"],
    authorize,
  });
}

function governed(overrides: Partial<McpGovernedEffectCapabilities> = {}): McpGovernedEffectCapabilities {
  return {
    prepare: async () => proposal,
    list: async () => [status],
    status: async () => status,
    decide: async () => ({ ...status, status: "queued" }),
    ...overrides,
  };
}

async function connected(instance: ReturnType<typeof createMcpTransport>, name: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), {
    fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)),
  });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

describe("MCP governed effect tools", () => {
  test("discovers exactly the seven governed tools and no provider-shaped tools", async () => {
    const instance = runtime(governed());
    const { client, close } = await connected(instance, "governed-discovery");
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names.filter((name) => (MCP_GOVERNED_EFFECT_TOOL_NAMES as readonly string[]).includes(name))).toEqual([...MCP_GOVERNED_EFFECT_TOOL_NAMES]);
      expect(names.filter((name) => name.includes("send") || name.includes("publish") || name.includes("book") || name.includes("cancel") || name.startsWith("provider_"))).toEqual([]);
    } finally {
      await close();
    }
  });

  test("guards prepare and derives its workspace context without accepting workspace arguments", async () => {
    let receivedContext: McpExecutionContext | undefined;
    let receivedCommand: Record<string, unknown> | undefined;
    const instance = runtime(governed({
      prepare: async (received, command) => {
        receivedContext = received;
        receivedCommand = command as unknown as Record<string, unknown>;
        return proposal;
      },
    }), () => context("operator", ["mcp:read", "mcp:write"]));
    const { client, close } = await connected(instance, "governed-prepare");
    try {
      const result = await client.callTool({ name: "conversation_prepare_reply", arguments: {
        requestKey: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        body: "Bounded body",
      } });
      expect(result.isError).not.toBe(true);
      expect(receivedContext).toMatchObject({ userId: "user-1", workspaceId: "workspace-1", role: "operator", scopes: ["mcp:read", "mcp:write"] });
      expect(receivedCommand).toMatchObject({ kind: "conversation_reply", conversationId: expect.any(String), body: "Bounded body", inputHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(receivedCommand).not.toHaveProperty("workspaceId");

      const rejected = await client.callTool({ name: "conversation_prepare_reply", arguments: {
        requestKey: crypto.randomUUID(), conversationId: crypto.randomUUID(), body: "Bounded body", workspaceId: "attacker-workspace",
      } });
      expect(rejected.isError).toBe(true);
      expect(receivedCommand).not.toHaveProperty("workspaceId");
    } finally {
      await close();
    }
  });

  test("allows reviewer list/get reads with bounded redacted projections", async () => {
    let listInput: unknown;
    let statusInput: unknown;
    const unsafeStatus = {
      ...status,
      token: "do-not-leak",
      intent: { ...status.intent!, body: "Reviewer-only intent", providerMessageId: "do-not-leak" },
    } as McpEffectStatusView;
    const instance = runtime(governed({
      list: async (_context, input) => { listInput = input; return [unsafeStatus]; },
      status: async (_context, input) => { statusInput = input; return unsafeStatus; },
    }));
    const { client, close } = await connected(instance, "governed-read");
    try {
      const listed = await client.callTool({ name: "approval_list", arguments: { limit: 1000 } });
      expect(listed.isError).toBe(true);
      const bounded = await client.callTool({ name: "approval_list", arguments: { limit: 10 } });
      expect(bounded.isError).not.toBe(true);
      expect(listInput).toEqual({ limit: 10 });
      expect(bounded.structuredContent).not.toHaveProperty("token");
      expect(bounded.structuredContent).toMatchObject({ data: expect.any(Array) });

      const fetched = await client.callTool({ name: "approval_get", arguments: { approvalItemId: "00000000-0000-4000-8000-000000000001" } });
      expect(fetched.isError).not.toBe(true);
      expect(statusInput).toEqual({ approvalItemId: "00000000-0000-4000-8000-000000000001" });
      expect(fetched.structuredContent).not.toHaveProperty("token");
    } finally {
      await close();
    }
  });

  test("requires the exact decision role and all three scopes", async () => {
    let decisions = 0;
    const capability = governed({ decide: async () => { decisions += 1; return { ...status, status: "queued" }; } });
    const instance = runtime(capability);
    const { client, close } = await connected(instance, "governed-decide");
    try {
      const approved = await client.callTool({ name: "approval_decide", arguments: {
        approvalItemId: "00000000-0000-4000-8000-000000000001", decision: "approve",
      } });
      expect(approved.isError).not.toBe(true);
      expect(decisions).toBe(1);

      const forbidden = await callWithContext(capability, "approval_decide", { approvalItemId: "00000000-0000-4000-8000-000000000001", decision: "approve" }, "operator", allScopes);
      expect(forbidden.structuredContent).toEqual({ error: "MCP_GOVERNED_EFFECT_FORBIDDEN" });
      const missingScope = await callWithContext(capability, "approval_decide", { approvalItemId: "00000000-0000-4000-8000-000000000001", decision: "approve" }, "reviewer", ["mcp:read", "mcp:write"]);
      expect(missingScope.structuredContent).toEqual({ error: "MCP_GOVERNED_EFFECT_SCOPE_REQUIRED" });
      expect(decisions).toBe(1);
    } finally {
      await close();
    }
  });

  test("maps stable capability errors without exposing internal messages", async () => {
    const instance = runtime(governed({ decide: async () => { throw new Error("MCP_EFFECT_VERSION_CONFLICT"); } }));
    const { client, close } = await connected(instance, "governed-errors");
    try {
      const stable = await client.callTool({ name: "approval_decide", arguments: { approvalItemId: "00000000-0000-4000-8000-000000000001", decision: "approve" } });
      expect(stable.structuredContent).toEqual({ error: "MCP_EFFECT_VERSION_CONFLICT" });

      const internalInstance = runtime(governed({ decide: async () => { throw new Error("secret provider response"); } }));
      const { client: internalClient, close: closeInternal } = await connected(internalInstance, "governed-internal-errors");
      try {
        const internal = await internalClient.callTool({ name: "approval_decide", arguments: { approvalItemId: "00000000-0000-4000-8000-000000000001", decision: "approve" } });
        expect(internal.structuredContent).toEqual({ error: "MCP_GOVERNED_EFFECT_FAILED" });
        expect(JSON.stringify(internal.structuredContent)).not.toContain("secret");
      } finally {
        await closeInternal();
      }
    } finally {
      await close();
    }
  });
});

async function callWithContext(
  capability: McpGovernedEffectCapabilities,
  name: string,
  argumentsValue: Record<string, unknown>,
  role: McpExecutionContext["role"],
  scopes: readonly McpExecutionContext["scopes"][number][],
) {
  const instance = runtime(capability, () => context(role, scopes));
  const { client, close } = await connected(instance, `governed-${role}`);
  try {
    return await client.callTool({ name, arguments: argumentsValue });
  } finally {
    await close();
  }
}
