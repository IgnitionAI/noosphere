import { describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { createMcpTransport, MCP_MAX_BODY_BYTES } from "@outbound/interface/mcp/mcp-transport";
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

function transport(overrides: Partial<Parameters<typeof createMcpTransport>[0]> = {}) {
  return createMcpTransport({
    capabilities: capabilities(),
    allowedHosts: ["example.test"],
    allowedOrigins: ["https://example.test"],
    authorize: async () => true,
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
});
