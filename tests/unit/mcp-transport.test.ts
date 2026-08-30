import { describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { createMcpTransport, MCP_MAX_BODY_BYTES } from "@outbound/interface/mcp/mcp-transport";
import { MCP_CORRELATION_HEADER } from "@outbound/interface/mcp/mcp-request-governance";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";

const capabilities = (): RuntimeCapabilities => ({
  crm: { productResearch: { get: async () => undefined, list: async () => undefined } },
  prospectMemory: { operations: { status: async () => undefined, view: async () => undefined } },
  pipeline: { available: false },
  campaigns: { available: false },
  conversations: { available: false },
  content: {
    strategies: { find: async () => undefined },
    ideas: { list: async () => undefined },
    generation: { findRun: async () => undefined, findIdea: async () => undefined, findAssetByIdea: async () => undefined },
    publications: { list: async () => undefined, find: async () => undefined },
    socialContent: { list: async () => undefined, status: async () => undefined },
    socialEngagement: { list: async () => undefined, status: async () => undefined },
    attribution: { listJourneys: async () => undefined },
  },
  approvals: { available: false },
  operations: { contentPerformance: { get: async () => undefined } },
  knowledge: { available: false },
});

const transportContext = {
  userId: "00000000-0000-4000-8000-000000000011",
  workspaceId: "00000000-0000-4000-8000-000000000012",
  clientId: "transport-test",
  role: "viewer" as const,
  scopes: ["mcp:read"] as const,
  audience: "https://example.test/mcp",
};

function transport(overrides: Partial<Parameters<typeof createMcpTransport>[0]> = {}) {
  return createMcpTransport({
    capabilities: capabilities(),
    allowedHosts: ["example.test"],
    allowedOrigins: ["https://example.test"],
    authorize: async () => transportContext,
    ...overrides,
  });
}

async function post(
  instance: ReturnType<typeof createMcpTransport>,
  method: string,
  params: unknown = {},
  id: number | string | null = 1,
  headers: Record<string, string> = {},
) {
  return instance.handle(new Request("https://example.test/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }),
  }));
}

async function body(response: Response): Promise<Record<string, unknown>> {
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const text = await response.text();
    const data = text.match(/(?:^|\n)data: (.+)(?:\n|$)/)?.[1];
    if (!data) throw new Error(`MCP SSE response omitted a data frame: ${text}`);
    return JSON.parse(data) as Record<string, unknown>;
  }
  return await response.json() as Record<string, unknown>;
}

const MODERN_PROTOCOL_VERSION = "2026-07-28";

async function modernPost(
  instance: ReturnType<typeof createMcpTransport>,
  method: string,
  params: Record<string, unknown> = {},
  id: number | string = 1,
  extraHeaders: Record<string, string> = {},
) {
  const envelope = {
    [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
    [CLIENT_INFO_META_KEY]: { name: "noosphere-modern-smoke", version: "1.0.0" },
    [CLIENT_CAPABILITIES_META_KEY]: {},
  };
  return post(instance, method, { ...params, _meta: envelope }, id, {
    "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
    "mcp-method": method,
    ...extraHeaders,
  });
}

describe("stateless MCP transport", () => {
  test("serves an official MCP SDK client over Web Standard fetch", async () => {
    const instance = transport();
    const client = new Client({ name: "noosphere-test-client", version: "1.0.0" });
    const sdkTransport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), {
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        return instance.handle(request);
      },
    });
    await client.connect(sdkTransport);
    expect(client.getProtocolEra()).toBe("legacy");
    const listed = await client.listTools();
    expect(listed.tools.some((tool) => tool.name === "noosphere_ping")).toBe(true);
    await client.close();

    const autoClient = new Client(
      { name: "noosphere-auto-client", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const autoTransport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), {
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        return instance.handle(request);
      },
    });
    await autoClient.connect(autoTransport);
    expect(autoClient.getProtocolEra()).toBe("modern");
    expect((await autoClient.listTools()).tools.some((tool) => tool.name === "noosphere_ping")).toBe(true);
    await autoClient.close();
  });

  test("supports initialize and discovery without a session", async () => {
    const instance = transport();
    const initialized = await post(instance, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "noosphere-test-client", version: "1.0.0" },
    });
    expect(initialized.status).toBe(200);
    expect(["application/json", "text/event-stream"].some((type) => initialized.headers.get("content-type")?.includes(type))).toBe(true);
    expect(initialized.headers.has("mcp-session-id")).toBe(false);
    expect((await body(initialized)).result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {}, resources: {} },
    });

    const tools = await post(instance, "tools/list");
    expect((await body(tools)).result).toMatchObject({ tools: expect.arrayContaining([
      expect.objectContaining({ name: "noosphere_ping" }),
      expect.objectContaining({ name: "tracer" }),
    ]) });
    const resources = await post(instance, "resources/list");
    expect((await body(resources)).result).toMatchObject({ resources: expect.arrayContaining([
      expect.objectContaining({ uri: "noosphere://runtime" }),
    ]) });
  });

  test("serves the pinned 2026-07-28 modern protocol without legacy fallback", async () => {
    const instance = transport();
    const discover = await modernPost(instance, "server/discover");
    expect(discover.status).toBe(200);
    expect((await body(discover)).result).toMatchObject({ supportedVersions: [MODERN_PROTOCOL_VERSION] });

    const tools = await modernPost(instance, "tools/list");
    expect(tools.status).toBe(200);
    expect((await body(tools)).result).toMatchObject({ tools: expect.arrayContaining([
      expect.objectContaining({ name: "noosphere_ping" }),
    ]) });

    const resources = await modernPost(instance, "resources/list");
    expect(resources.status).toBe(200);
    expect((await body(resources)).result).toMatchObject({ resources: expect.arrayContaining([
      expect.objectContaining({ uri: "noosphere://runtime" }),
    ]) });

    const call = await modernPost(instance, "tools/call", {
      name: "noosphere_ping",
      arguments: { traceId: "modern" },
    }, 42, { "mcp-name": "=?base64?bm9vc3BoZXJlX3Bpbmc=?=" });
    expect(call.status).toBe(200);
    expect((await body(call)).result).toMatchObject({ structuredContent: { ok: true, traceId: "modern" } });
  });

  test("validates protocol-version negotiation before SDK dispatch", async () => {
    const instance = transport();
    const mismatch = await post(
      instance,
      "initialize",
      { protocolVersion: "2099-01-01" },
      1,
      { "mcp-protocol-version": "2099-01-01" },
    );
    expect(mismatch.status).toBe(400);
  });

  test("returns HTTP 400 for malformed JSON and posted JSON-RPC responses", async () => {
    const instance = transport();
    const malformed = await instance.handle(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: "{",
    }));
    expect(malformed.status).toBe(400);
    const responseMessage = await instance.handle(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
    }));
    expect(responseMessage.status).toBe(202);
    expect(await responseMessage.text()).toBe("");
  });

  test("answers noosphere_ping and tracer calls with request-local trace data", async () => {
    const instance = transport();
    const first = await post(instance, "tools/call", { name: "noosphere_ping", arguments: { traceId: "a" } }, "a");
    const second = await post(instance, "tools/call", { name: "tracer", arguments: { traceId: "b", message: "hello" } }, "b");
    expect((await body(first)).result).toMatchObject({ structuredContent: { ok: true, traceId: "a" } });
    expect((await body(second)).result).toMatchObject({ structuredContent: { ok: true, traceId: "b", message: "hello" } });
  });

  test("keeps concurrent requests isolated and survives instance restart", async () => {
    const instance = transport();
    const [a, b] = await Promise.all([
      post(instance, "tools/call", { name: "noosphere_ping", arguments: { traceId: "a" } }, "a"),
      post(instance, "tools/call", { name: "noosphere_ping", arguments: { traceId: "b" } }, "b"),
    ]);
    expect((await body(a)).id).toBe("a");
    expect((await body(b)).id).toBe("b");
    const restarted = transport();
    expect((await body(await post(restarted, "ping"))).result).toEqual({});
  });

  test("enforces method, content and body limits before parsing", async () => {
    const instance = transport();
    const get = await instance.handle(new Request("https://example.test/mcp", { method: "GET", headers: { accept: "text/event-stream" } }));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const badContent = await instance.handle(new Request("https://example.test/mcp", { method: "POST", headers: { accept: "application/json", "content-type": "text/plain" }, body: "{}" }));
    expect(badContent.status).toBe(415);
    const oversized = await instance.handle(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "x".repeat(MCP_MAX_BODY_BYTES + 1),
    }));
    expect(oversized.status).toBe(413);
  });

  test("requires safe origin, host and auth checks", async () => {
    const instance = transport({ authorize: async () => false });
    expect((await post(instance, "ping")).status).toBe(401);
    const forbiddenOrigin = await post(transport(), "ping", {}, 1, { origin: "https://evil.example" });
    expect(forbiddenOrigin.status).toBe(403);
    const forbiddenHost = await transport().handle(new Request("https://evil.example/mcp", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));
    expect(forbiddenHost.status).toBe(403);
    const spoofedHost = await transport().handle(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "evil.example", accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));
    expect(spoofedHost.status).toBe(403);
  });

  test("normalizes hostname, explicit port, HTTPS URL and bracketed IPv6 hosts", async () => {
    const cases = [
      {
        allowedHost: "MCP-SMOKE.LOCALHOST",
        url: "https://mcp-smoke.localhost/mcp",
        suppliedHost: "MCP-SMOKE.LOCALHOST",
        audience: "https://mcp-smoke.localhost/mcp",
      },
      {
        allowedHost: "mcp-smoke.localhost:18443",
        url: "https://mcp-smoke.localhost:18443/mcp",
        suppliedHost: "MCP-SMOKE.LOCALHOST:18443",
        audience: "https://mcp-smoke.localhost:18443/mcp",
      },
      {
        allowedHost: "https://MCP-SMOKE.LOCALHOST:18443",
        url: "https://mcp-smoke.localhost:18443/mcp",
        suppliedHost: "mcp-smoke.localhost:18443",
        audience: "https://mcp-smoke.localhost:18443/mcp",
      },
      {
        allowedHost: "[::1]:18443",
        url: "https://[::1]:18443/mcp",
        suppliedHost: "[::1]:18443",
        audience: "https://[::1]:18443/mcp",
      },
    ] as const;

    for (const value of cases) {
      const instance = transport({
        allowedHosts: [value.allowedHost],
        allowedOrigins: [],
        expectedAudience: value.audience,
        authorize: async () => ({ ...transportContext, audience: value.audience }),
      });
      const response = await instance.handle(new Request(value.url, {
        method: "POST",
        headers: {
          host: value.suppliedHost,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }));
      expect(response.status).toBe(200);
    }
  });

  test("rejects host credentials, paths, queries, schemes, trailing dots and invalid ports", () => {
    const invalid = [
      "",
      " ",
      "https://user:pass@example.test:18443",
      "https://example.test:18443/mcp",
      "https://example.test:18443?tenant=other",
      "https://example.test:18443#fragment",
      "http://example.test:18443",
      "example.test.",
      "example.test:0",
      "example.test:65536",
      "example.test:not-a-port",
      "[::1]",
      "1234",
    ];
    for (const allowedHost of invalid) {
      expect(() => transport({ allowedHosts: [allowedHost] })).toThrow("MCP_ALLOWED_HOST");
    }
  });

  test("accepts only the configured smoke host and rejects neighbor host attacks", async () => {
    const audience = "https://mcp-smoke.localhost:18443/mcp";
    const instance = transport({
      allowedHosts: ["mcp-smoke.localhost:18443"],
      allowedOrigins: [],
      expectedAudience: audience,
      authorize: async () => ({ ...transportContext, audience }),
    });
    const request = (host: string) => instance.handle(new Request("https://mcp-smoke.localhost:18443/mcp", {
      method: "POST",
      headers: { host, accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));

    expect((await request("mcp-smoke.localhost:18443")).status).toBe(200);
    expect((await request("mcp-smoke.localhost.evil:18443")).status).toBe(403);
    expect((await request("mcp-smoke.localhost:18443.evil")).status).toBe(403);
    expect((await request("user:pass@mcp-smoke.localhost:18443")).status).toBe(403);
  });

  test("accepts initialized notifications and reads the runtime resource", async () => {
    const instance = transport();
    const notification = await post(instance, "notifications/initialized", undefined, null);
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");
    const resource = await post(instance, "resources/read", { uri: "noosphere://runtime" });
    expect((await body(resource)).result).toMatchObject({ contents: expect.arrayContaining([
      expect.objectContaining({ uri: "noosphere://runtime", mimeType: "application/json" }),
    ]) });
  });

  test("preserves mcp:approve in the execution context while reviewer writes stay forbidden", async () => {
    let executed = false;
    const instance = transport({
      capabilities: {
        ...capabilities(),
        mcpWrite: {
          execute: async () => {
            executed = true;
            return { id: crypto.randomUUID(), version: 1, state: "applied", operation: "company_upsert", correlationId: crypto.randomUUID() };
          },
        },
      },
      authorize: async () => ({
        userId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002",
        clientId: "client",
        role: "reviewer" as const,
        scopes: ["mcp:read", "mcp:write", "mcp:approve"] as const,
        audience: "https://example.test/mcp",
      }),
    });
    const response = await post(instance, "tools/call", {
      name: "company_upsert",
      arguments: { requestKey: crypto.randomUUID(), name: "Acme" },
    });
    expect((await body(response)).result).toMatchObject({ isError: true, structuredContent: { error: "WRITE_FORBIDDEN" } });
    expect(executed).toBe(false);
  });

  test("rejects an authorization context with a foreign or malformed tenant identity", async () => {
    const instance = transport({
      authorize: async () => ({
        userId: "not-a-uuid",
        workspaceId: crypto.randomUUID(),
        clientId: "client",
        role: "viewer" as const,
        scopes: ["mcp:read"] as const,
        audience: "https://example.test/mcp",
      }),
    });
    const response = await post(instance, "ping");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "MCP_AUTH_CONTEXT_INVALID", correlationId: expect.any(String) });
  });

  test("generates or preserves a bounded request correlation header", async () => {
    const context = {
      userId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), clientId: "client", role: "viewer" as const,
      scopes: ["mcp:read"] as const, audience: "https://example.test/mcp",
    };
    const instance = transport({ authorize: async () => context });
    const supplied = await post(instance, "ping", {}, 1, { [MCP_CORRELATION_HEADER]: "request-123" });
    expect(supplied.headers.get(MCP_CORRELATION_HEADER)).toBe("request-123");
    const generated = await post(instance, "tools/call", { name: "tracer", arguments: {} }, 2, { [MCP_CORRELATION_HEADER]: "contains whitespace" });
    expect(generated.headers.get(MCP_CORRELATION_HEADER)).toMatch(/^[A-Za-z0-9-]{20,}$/);
    expect((await body(generated)).result).toMatchObject({ structuredContent: { correlationId: expect.any(String) } });
  });

  test("fails closed with a retryable bounded quota response", async () => {
    const context = {
      userId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), clientId: "client", role: "viewer" as const,
      scopes: ["mcp:read"] as const, audience: "https://example.test/mcp",
    };
    const instance = transport({ authorize: async () => context, rateLimiter: { consume: () => ({ allowed: false, retryAfterSeconds: 7 }) } });
    const response = await post(instance, "ping");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true, correlationId: expect.any(String) });
  });

  test("returns a safe protocol error for primitive JSON-RPC messages", async () => {
    const instance = transport();
    const response = await instance.handle(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "null",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32600, data: { code: "INVALID_JSON_RPC", correlationId: expect.any(String) } } });
  });

  test("rejects malformed JSON-RPC envelopes before SDK dispatch", async () => {
    const instance = transport();
    const malformed = [
      JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: 1 }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "" }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: null }),
      JSON.stringify({ jsonrpc: "2.0", id: {}, method: "ping" }),
    ];
    for (const body of malformed) {
      const response = await instance.handle(new Request("https://example.test/mcp", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body,
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32600, data: { code: "INVALID_JSON_RPC" } } });
    }
  });

  test("bounds serialized MCP responses before emission", async () => {
    const instance = transport({ maxResponseBytes: 100 });
    const response = await post(instance, "tools/call", { name: "tracer", arguments: { message: "x" } });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "MCP_RESPONSE_TOO_LARGE", correlationId: expect.any(String) });
  });

  test("rejects boolean authorization instead of inventing a tenant context", async () => {
    const instance = transport({ authorize: async () => true });
    const response = await post(instance, "ping");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "MCP_AUTH_CONTEXT_INVALID" });
  });

  test("accepts a public HTTPS audience when the upstream request URL is internal HTTP", async () => {
    const context = {
      userId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), clientId: "edge-client", role: "viewer" as const,
      scopes: ["mcp:read"] as const, audience: "https://public.example/mcp",
    };
    const instance = transport({
      expectedAudience: "https://public.example/mcp",
      allowedHosts: ["public.example"],
      allowedOrigins: [],
      authorize: async () => context,
    });
    const response = await instance.handle(new Request("http://api:3001/mcp", {
      method: "POST",
      headers: { host: "public.example", accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get(MCP_CORRELATION_HEADER)).toBeTruthy();
  });

  test("rejects an audience that differs from the configured public resource", async () => {
    const instance = transport({
      expectedAudience: "https://public.example/mcp",
      allowedHosts: ["public.example"],
      authorize: async () => ({
        userId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), clientId: "edge-client", role: "viewer" as const,
        scopes: ["mcp:read"] as const, audience: "https://attacker.example/mcp",
      }),
    });
    const response = await instance.handle(new Request("http://api:3001/mcp", {
      method: "POST",
      headers: { host: "public.example", accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "MCP_AUTH_CONTEXT_INVALID" });
  });

  test("passes legacy and modern batches to the SDK while charging a bounded rpc:batch quota", async () => {
    const calls: { tool: string; cost: number }[] = [];
    const context = {
      userId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), clientId: "batch-client", role: "viewer" as const,
      scopes: ["mcp:read"] as const, audience: "https://example.test/mcp",
    };
    const instance = transport({
      authorize: async () => context,
      rateLimiter: { consume: (input) => { calls.push({ tool: input.tool, cost: input.cost }); return { allowed: true }; } },
    });
    const batch = JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    const legacy = await instance.handle(new Request("https://example.test/mcp", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: batch,
    }));
    expect(legacy.status).not.toBe(401);
    expect(calls).toEqual([{ tool: "rpc:batch", cost: 2 }]);
  });
});
