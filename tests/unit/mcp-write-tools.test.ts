import { describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";
import type { McpExecutionContext, McpWriteCapabilities } from "@outbound/application/mcp/mcp-write-capabilities";
import { createMcpTransport } from "@outbound/interface/mcp/mcp-transport";

const context: McpExecutionContext = {
  userId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), clientId: "writer", role: "operator", scopes: ["mcp:write"], audience: "https://example.test/mcp",
};

const baseCapabilities = (): RuntimeCapabilities => ({
  crm: { productResearch: { get: async () => undefined, list: async () => undefined } },
  prospectMemory: { operations: { status: async () => undefined, view: async () => undefined } },
  pipeline: { available: false }, campaigns: { available: false }, conversations: { available: false },
  content: { strategies: { find: async () => undefined }, ideas: { list: async () => undefined }, generation: { findRun: async () => undefined, findIdea: async () => undefined, findAssetByIdea: async () => undefined }, publications: { list: async () => undefined, find: async () => undefined }, socialContent: { list: async () => undefined, status: async () => undefined }, socialEngagement: { list: async () => undefined, status: async () => undefined }, attribution: { listJourneys: async () => undefined } },
  approvals: { available: false }, operations: { contentPerformance: { get: async () => undefined } }, knowledge: { available: false },
});

describe("MCP safe-write tools", () => {
  test("registers internal writes and forwards canonical command", async () => {
    let received: unknown;
    const writes: McpWriteCapabilities = { execute: async (_context, command) => { received = command; return { id: crypto.randomUUID(), version: 1, state: "applied", operation: command.operation, correlationId: crypto.randomUUID() }; } };
    const instance = createMcpTransport({ capabilities: { ...baseCapabilities(), mcpWrite: writes }, allowedHosts: ["example.test"], authorize: async () => context });
    const client = new Client({ name: "mcp-write-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), { fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)) });
    await client.connect(transport);
    const requestKey = crypto.randomUUID();
    const result = await client.callTool({ name: "company_upsert", arguments: { requestKey, name: "Acme" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ state: "applied", operation: "company_upsert" });
    expect(received).toMatchObject({ operation: "company_upsert", requestKey });
    await client.close();
  });

  test("denies viewer writes", async () => {
    const instance = createMcpTransport({ capabilities: { ...baseCapabilities(), mcpWrite: { execute: async () => { throw new Error("must not run"); } } }, allowedHosts: ["example.test"], authorize: async () => ({ ...context, role: "viewer" as const }) });
    const client = new Client({ name: "mcp-write-viewer", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), { fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)) });
    await client.connect(transport);
    const result = await client.callTool({ name: "company_upsert", arguments: { requestKey: crypto.randomUUID(), name: "Acme" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: "WRITE_FORBIDDEN" });
    await client.close();
  });

  test("keeps reviewer writes forbidden even when mcp:approve is granted", async () => {
    const instance = createMcpTransport({
      capabilities: {
        ...baseCapabilities(),
        mcpWrite: { execute: async () => { throw new Error("must not run"); } },
      },
      allowedHosts: ["example.test"],
      authorize: async () => ({ ...context, role: "reviewer" as const, scopes: ["mcp:read", "mcp:write", "mcp:approve"] as const }),
    });
    const client = new Client({ name: "mcp-write-reviewer", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), { fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)) });
    await client.connect(transport);
    const result = await client.callTool({ name: "company_upsert", arguments: { requestKey: crypto.randomUUID(), name: "Acme" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: "WRITE_FORBIDDEN" });
    await client.close();
  });

  test("exposes every internal mutation as an executable capability", async () => {
    const operations = [
      "company_upsert", "contact_upsert", "opportunity_update", "opportunity_change_stage",
      "prospect_add_note", "content_idea_create", "content_draft_create", "prospect_schedule_dry_run",
    ] as const;
    const calls: string[] = [];
    const writes: McpWriteCapabilities = {
      execute: async (_context, command) => {
        calls.push(command.operation);
        return { id: crypto.randomUUID(), version: 1, state: "applied", operation: command.operation, correlationId: crypto.randomUUID() };
      },
    };
    const instance = createMcpTransport({ capabilities: { ...baseCapabilities(), mcpWrite: writes }, allowedHosts: ["example.test"], authorize: async () => context });
    const client = new Client({ name: "mcp-write-catalog", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), { fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)) });
    await client.connect(transport);
    const argumentsByOperation: Record<(typeof operations)[number], Record<string, unknown>> = {
      company_upsert: { requestKey: crypto.randomUUID(), name: "Acme" },
      contact_upsert: { requestKey: crypto.randomUUID(), firstName: "Ada", lastName: "Lovelace" },
      opportunity_update: { requestKey: crypto.randomUUID(), opportunityId: crypto.randomUUID() },
      opportunity_change_stage: { requestKey: crypto.randomUUID(), opportunityId: crypto.randomUUID(), stage: "qualified" },
      prospect_add_note: { requestKey: crypto.randomUUID(), contactId: crypto.randomUUID(), note: "note" },
      content_idea_create: { requestKey: crypto.randomUUID(), title: "Idea", brief: "Brief" },
      content_draft_create: { requestKey: crypto.randomUUID(), ideaId: crypto.randomUUID(), body: "Draft" },
      prospect_schedule_dry_run: { requestKey: crypto.randomUUID(), contactId: crypto.randomUUID() },
    };
    for (const operation of operations) {
      const result = await client.callTool({ name: operation, arguments: argumentsByOperation[operation] });
      expect(result.isError).not.toBe(true);
    }
    expect(calls).toEqual([...operations]);
    await client.close();
  });

  test("propagates content draft expectedRevision into generation", async () => {
    const source = await Bun.file(new URL("../../packages/bootstrap/src/create-noosphere-api-runtime.ts", import.meta.url)).text();
    expect(source).toContain("...(typeof args.expectedVersion === \"number\" ? { expectedRevision: args.expectedVersion } : {})");
  });
});
