import { describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";
import type { McpExecutionContext, McpReadCapabilities } from "@outbound/application/mcp/mcp-read-capabilities";
import { createMcpTransport } from "@outbound/interface/mcp/mcp-transport";

const context: McpExecutionContext = {
  userId: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  clientId: "read-client",
  role: "viewer",
  scopes: ["mcp:read"],
  audience: "https://example.test/mcp",
};

function readCapabilities(): McpReadCapabilities {
  const page = (id: string) => ({ data: [{ id, amount: 10, currency: "EUR", providerPostId: "provider-id" }], nextCursor: null });
  return {
    workspace: { getSummary: async (input) => ({ id: input.workspaceId, state: "ready" }) },
    crm: {
      search: async (_context, input) => page(input.query ?? "all"),
      getCompany: async (_context, input) => ({ id: input.companyId, name: "Acme", amount: 10, providerPostId: "provider-id" }),
    },
    prospect: { get360: async (_context, input) => ({ id: input.contactId, facts: { confirmedNeeds: [] }, hypotheses: [], recommendations: [], contradictions: [], missingInformation: [], provenance: [] }) },
    pipeline: { list: async () => page("pipeline-1") },
    opportunity: { get: async (_context, input) => ({ id: input.opportunityId, amount: 10, currency: "EUR" }) },
    conversation: { list: async () => page("conversation-1") },
    campaign: { getStatus: async (_context, input) => ({ id: input.campaignId, status: "healthy" }) },
    content: { getCalendar: async () => page("calendar-1") },
    operations: {
      getHealth: async () => ({ status: "ready" }),
      get: async (_context, input) => ({ operationId: input.operationId, jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), status: "queued", resultRefs: [], errorCode: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), operationUri: `noosphere://operations/${input.operationId}`, inputHash: "leak", args: { secret: "leak" } } as never),
    },
  };
}

function capabilities(): RuntimeCapabilities {
  return {
    mcpRead: readCapabilities(),
    crm: { productResearch: { get: async () => undefined, list: async () => undefined } },
    prospectMemory: { operations: { status: async () => undefined, view: async () => undefined } },
    pipeline: { available: false }, campaigns: { available: false }, conversations: { available: false },
    content: {
      strategies: { find: async () => undefined }, ideas: { list: async () => undefined },
      generation: { findRun: async () => undefined, findIdea: async () => undefined, findAssetByIdea: async () => undefined },
      publications: { list: async () => undefined, find: async () => undefined },
      socialContent: { list: async () => undefined, status: async () => undefined },
      socialEngagement: { list: async () => undefined, status: async () => undefined }, attribution: { listJourneys: async () => undefined },
    },
    approvals: { available: false }, operations: { contentPerformance: { get: async () => undefined } }, knowledge: { available: false },
  };
}

function createClient() {
  const instance = createMcpTransport({
    capabilities: capabilities(),
    allowedHosts: ["example.test"],
    authorize: async () => context,
  });
  const client = new Client({ name: "mcp-read-test", version: "1.0.0" });
  const sdkTransport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), {
    fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)),
  });
  return { client, sdkTransport };
}

describe("MCP read tools and resources", () => {
  test("discovers and calls all eleven read tools with structured bounded output", async () => {
    const { client, sdkTransport } = createClient();
    await client.connect(sdkTransport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "workspace_get_summary", "crm_search", "company_get_brief", "prospect_get_360", "pipeline_list",
      "opportunity_get", "conversation_list", "campaign_get_status", "content_get_calendar", "operations_get_health", "operation_get",
    ]));
    const id = crypto.randomUUID();
    const calls: [string, Record<string, unknown>][] = [
      ["workspace_get_summary", {}], ["crm_search", { query: "acme", limit: 1 }],
      ["company_get_brief", { companyId: id }], ["prospect_get_360", { contactId: id }],
      ["pipeline_list", { limit: 1 }], ["opportunity_get", { opportunityId: id }],
      ["conversation_list", { limit: 1 }], ["campaign_get_status", { campaignId: id }],
      ["content_get_calendar", { limit: 1 }], ["operations_get_health", {}], ["operation_get", { operationId: id }],
    ];
    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toBeDefined();
    }
    const operation = await client.callTool({ name: "operation_get", arguments: { operationId: id } });
    expect(JSON.stringify(operation)).not.toContain("inputHash");
    expect(JSON.stringify(operation)).not.toContain("leak");
    const company = await client.callTool({ name: "company_get_brief", arguments: { companyId: id } });
    expect(JSON.stringify(company)).not.toContain("provider-id");
    expect(JSON.stringify(company)).not.toContain("amount");
    await client.close();
  });

  test("lists resources and reads URI templates without workspace input", async () => {
    const { client, sdkTransport } = createClient();
    await client.connect(sdkTransport);
    const listed = await client.listResources();
    expect(listed.resources.map((resource) => resource.uri)).toEqual(expect.arrayContaining([
      "noosphere://workspace/current/summary", "noosphere://workspace/current/pipeline",
      "noosphere://content/calendar", "noosphere://operations/health",
    ]));
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((resource) => resource.uriTemplate)).toEqual(expect.arrayContaining([
      "noosphere://companies/{companyId}/brief", "noosphere://prospects/{contactId}/360",
      "noosphere://opportunities/{opportunityId}", "noosphere://campaigns/{campaignId}/status",
      "noosphere://operations/{operationId}",
    ]));
    const summary = await client.readResource({ uri: "noosphere://workspace/current/summary" });
    const summaryContent = summary.contents[0];
    expect(summaryContent && "text" in summaryContent ? summaryContent.text : "").toContain(context.workspaceId);
    const company = await client.readResource({ uri: `noosphere://companies/${crypto.randomUUID()}/brief` });
    const companyContent = company.contents[0];
    expect(companyContent && "text" in companyContent ? companyContent.text : "").toContain("Acme");
    const operation = await client.readResource({ uri: `noosphere://operations/${crypto.randomUUID()}` });
    const operationContent = operation.contents[0];
    expect(operationContent && "text" in operationContent ? operationContent.text : "").toContain("operationId");
    await client.close();
  });

  test("keeps operator-visible monetary fields while still stripping provider IDs", async () => {
    const operatorContext = { ...context, role: "operator" as const };
    const instance = createMcpTransport({
      capabilities: { ...capabilities(), mcpRead: readCapabilities() },
      allowedHosts: ["example.test"],
      authorize: async () => operatorContext,
    });
    const response = await instance.handle(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "company_get_brief", arguments: { companyId: crypto.randomUUID() } } }),
    }));
    const raw = await response.text();
    const payload = JSON.parse(raw.match(/(?:^|\n)data: (.+)(?:\n|$)/)?.[1] ?? raw) as { result?: { structuredContent?: Record<string, unknown> } };
    expect(payload.result?.structuredContent).toMatchObject({ amount: 10 });
    expect(JSON.stringify(payload)).not.toContain("provider-id");
  });

  test("does not expose capability failures", async () => {
    const base = readCapabilities();
    const broken: McpReadCapabilities = {
      ...base,
      crm: { ...base.crm, getCompany: async () => { throw new Error("database password leaked"); } },
    };
    const instance = createMcpTransport({
      capabilities: { ...capabilities(), mcpRead: broken },
      allowedHosts: ["example.test"],
      authorize: async () => context,
    });
    const client = new Client({ name: "mcp-read-errors", version: "1.0.0" });
    const sdkTransport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), {
      fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)),
    });
    await client.connect(sdkTransport);
    const result = await client.callTool({ name: "company_get_brief", arguments: { companyId: crypto.randomUUID() } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: "READ_FAILED" });
    expect(JSON.stringify(result)).not.toContain("database password");
    await client.close();
  });

  test("returns stable NOT_FOUND for missing or foreign operation handles", async () => {
    const base = readCapabilities();
    const instance = createMcpTransport({
      capabilities: { ...capabilities(), mcpRead: { ...base, operations: { ...base.operations, get: async () => null } } },
      allowedHosts: ["example.test"],
      authorize: async () => context,
    });
    const client = new Client({ name: "mcp-operation-not-found", version: "1.0.0" });
    const sdkTransport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), {
      fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)),
    });
    await client.connect(sdkTransport);
    const result = await client.callTool({ name: "operation_get", arguments: { operationId: crypto.randomUUID() } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: "NOT_FOUND" });
    await expect(client.callTool({ name: "operation_get", arguments: { operationId: "invalid" } })).resolves.toMatchObject({ isError: true });
    await client.close();
  });

  test("uses the authenticated role when redacting resources", async () => {
    const operatorContext = { ...context, role: "operator" as const };
    const instance = createMcpTransport({
      capabilities: { ...capabilities(), mcpRead: readCapabilities() },
      allowedHosts: ["example.test"],
      authorize: async () => operatorContext,
    });
    const client = new Client({ name: "mcp-read-resource-role", version: "1.0.0" });
    const sdkTransport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), {
      fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)),
    });
    await client.connect(sdkTransport);
    const resource = await client.readResource({ uri: `noosphere://companies/${crypto.randomUUID()}/brief` });
    const resourceContent = resource.contents[0];
    expect(resourceContent && "text" in resourceContent ? resourceContent.text : "").toContain('"amount":10');
    await client.close();
  });

  test("forwards opaque pagination and calendar bounds to capabilities", async () => {
    const base = readCapabilities();
    let searchInput: unknown;
    let calendarInput: unknown;
    const instrumented: McpReadCapabilities = {
      ...base,
      crm: {
        ...base.crm,
        search: async (ctx, input) => {
          searchInput = input;
          return base.crm.search(ctx, input);
        },
      },
      content: {
        ...base.content,
        getCalendar: async (ctx, input) => {
          calendarInput = input;
          return base.content.getCalendar(ctx, input);
        },
      },
    };
    const instance = createMcpTransport({ capabilities: { ...capabilities(), mcpRead: instrumented }, allowedHosts: ["example.test"], authorize: async () => context });
    const client = new Client({ name: "mcp-read-forwarding", version: "1.0.0" });
    const sdkTransport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), {
      fetch: async (input, init) => instance.handle(input instanceof Request ? input : new Request(input, init)),
    });
    await client.connect(sdkTransport);
    await client.callTool({ name: "crm_search", arguments: { cursor: "opaque-page-2", limit: 2 } });
    await client.callTool({ name: "content_get_calendar", arguments: { from: "2026-01-01T00:00:00Z", to: "2026-01-31T23:59:59Z", limit: 2 } });
    expect(searchInput).toMatchObject({ cursor: "opaque-page-2", limit: 2 });
    expect(calendarInput).toMatchObject({ from: "2026-01-01T00:00:00Z", to: "2026-01-31T23:59:59Z", limit: 2 });
    await client.close();
  });
});
