import { describe, expect, test } from "bun:test";
import { createMcpTransport } from "@outbound/interface/mcp/mcp-transport";
import { MCP_CORRELATION_HEADER } from "@outbound/interface/mcp/mcp-request-governance";
import {
  createMcpObservabilityLogger,
  type McpObservabilityEvent,
} from "@outbound/interface/mcp/mcp-observability";
import { classifySafeError } from "@outbound/application/shared/safe-error";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";

const context = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  clientId: "observability-test",
  role: "viewer" as const,
  scopes: ["mcp:read"] as const,
  audience: "https://example.test/mcp",
};

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

function request(body: unknown): Request {
  return new Request("https://example.test/mcp", {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.match(/(?:^|\n)data: (.+)(?:\n|$)/)?.[1];
    if (!data) throw new Error(`MCP SSE response omitted a data frame: ${text}`);
    return JSON.parse(data) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe("MCP observability", () => {
  test("writes only allowlisted fields and never serializes secrets or payloads", () => {
    const lines: string[] = [];
    const logger = createMcpObservabilityLogger((line) => lines.push(line));
    logger.observe({
      event: "mcp_tool",
      correlationId: "corr-123",
      durationMs: 4,
      outcome: "failure",
      code: "MCP_TOOL_FAILED",
      httpStatus: 500,
      authDecision: "accepted",
      userId: context.userId,
      workspaceId: context.workspaceId,
      clientId: context.clientId,
      tool: "tracer",
      resource: context.audience,
      entityId: "00000000-0000-4000-8000-000000000003",
      inputHash: "a".repeat(64),
      token: "Bearer secret-token",
      body: { password: "secret" },
      params: { accessToken: "secret" },
      stack: "secret stack",
    } as McpObservabilityEvent & Record<string, unknown>);
    const output = JSON.parse(lines[0] ?? "{}");
    expect(output).toEqual({
      event: "mcp_tool",
      correlationId: "corr-123",
      durationMs: 4,
      outcome: "failure",
      code: "MCP_TOOL_FAILED",
      httpStatus: 500,
      authDecision: "accepted",
      userId: context.userId,
      workspaceId: context.workspaceId,
      clientId: context.clientId,
      tool: "tracer",
      resource: context.audience,
      entityId: "00000000-0000-4000-8000-000000000003",
      inputHash: "a".repeat(64),
    });
    expect(lines.join(" ")).not.toContain("secret");
  });

  test("emits correlated safe observations for auth, malformed, rate, tool and resource outcomes", async () => {
    const events: McpObservabilityEvent[] = [];
    const transport = createMcpTransport({
      capabilities: capabilities(),
      allowedHosts: ["example.test"],
      allowedOrigins: ["https://example.test"],
      authorize: async () => context,
      rateLimiter: { consume: () => ({ allowed: true }) },
      observability: (event) => events.push(event),
    });
    const toolResponse = await transport.handle(request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tracer", arguments: {} } }));
    const resourceResponse = await transport.handle(request({ jsonrpc: "2.0", id: 2, method: "resources/list", params: {} }));
    const malformedResponse = await transport.handle(request({ jsonrpc: "1.0", id: 3, method: "ping" }));
    expect(toolResponse.status).toBe(200);
    expect(resourceResponse.status).toBe(200);
    expect(malformedResponse.status).toBe(400);
    expect(events.map((event) => event.event)).toEqual(["mcp_tool", "mcp_resource", "mcp_protocol"]);
    expect(events.every((event) => event.correlationId && event.durationMs >= 0 && event.durationMs <= 86_400_000)).toBe(true);
    expect(events[0]).toMatchObject({ outcome: "success", httpStatus: 200, authDecision: "accepted", tool: "tracer", userId: context.userId });
    expect(events[1]).toMatchObject({ outcome: "success", httpStatus: 200, authDecision: "accepted", resource: context.audience });
    expect(events[2]).toMatchObject({ outcome: "failure", httpStatus: 400, code: "INVALID_JSON_RPC", inputHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await transport.close();
  });

  test("marks JSON-RPC root and tool errors as failures even when HTTP succeeds", async () => {
    const events: McpObservabilityEvent[] = [];
    const instance = createMcpTransport({
      capabilities: capabilities(),
      allowedHosts: ["example.test"],
      allowedOrigins: ["https://example.test"],
      authorize: async () => context,
      rateLimiter: { consume: () => ({ allowed: true }) },
      observability: (event) => events.push(event),
    });
    const errorInstance = createMcpTransport({
      capabilities: {
        ...capabilities(),
        mcpWrite: { execute: async () => { throw new Error("provider secret"); } },
      },
      allowedHosts: ["example.test"],
      allowedOrigins: ["https://example.test"],
      authorize: async () => context,
      rateLimiter: { consume: () => ({ allowed: true }) },
      observability: (event) => events.push(event),
    });

    const unknownMethod = await instance.handle(request({ jsonrpc: "2.0", id: 1, method: "unknown_method", params: {} }));
    const unknownMethodBody = await responseBody(unknownMethod);
    const unknownTool = await errorInstance.handle(request({
      jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "company_upsert", arguments: { requestKey: "00000000-0000-4000-8000-000000000010", name: "Acme" },
      },
    }));
    const unknownToolBody = await responseBody(unknownTool);
    const success = await instance.handle(request({
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "tracer", arguments: {} },
    }));

    expect(unknownMethod.status).toBe(200);
    expect(unknownMethodBody).toHaveProperty("error");
    expect(unknownTool.status).toBe(200);
    expect(unknownToolBody.result).toMatchObject({ isError: true });
    expect(success.status).toBe(200);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ outcome: "failure", code: "MCP_RPC_METHOD_NOT_FOUND", protocolCode: -32601 });
    expect(events[1]).toMatchObject({ outcome: "failure", code: "MCP_TOOL_ERROR" });
    expect(events[2]).toMatchObject({ outcome: "success", httpStatus: 200, tool: "tracer" });
    expect(JSON.stringify(events)).not.toContain("unknown_method");
    expect(JSON.stringify(events)).not.toContain("not_registered");
    await instance.close();
    await errorInstance.close();
  });

  test("records one bounded rpc:batch observation for legacy and modern batches", async () => {
    const events: McpObservabilityEvent[] = [];
    const instance = createMcpTransport({
      capabilities: capabilities(),
      allowedHosts: ["example.test"],
      allowedOrigins: ["https://example.test"],
      authorize: async () => context,
      rateLimiter: { consume: () => ({ allowed: true }) },
      observability: (event) => events.push(event),
    });
    const legacyBatch = [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ];
    const legacy = await instance.handle(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify(legacyBatch),
    }));
    expect(legacy.status).not.toBe(401);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "mcp_request", tool: "rpc:batch" });

    const modern = legacyBatch.map((item) => ({
      ...item,
      params: { _meta: {
        "protocol-version": "2026-07-28",
        "client-info": { name: "batch-test", version: "1" },
        capabilities: {},
      } },
    }));
    const modernResponse = await instance.handle(new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
      },
      body: JSON.stringify(modern),
    }));
    expect(modernResponse.status).toBe(400);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ event: "mcp_request", tool: "rpc:batch" });
    await instance.close();
  });

  test("keeps notification no-content and concurrent observations request-local", async () => {
    const events: McpObservabilityEvent[] = [];
    const instance = createMcpTransport({
      capabilities: capabilities(),
      allowedHosts: ["example.test"],
      allowedOrigins: ["https://example.test"],
      authorize: async () => context,
      rateLimiter: { consume: () => ({ allowed: true }) },
      observability: (event) => events.push(event),
    });
    const [first, second] = await Promise.all([
      instance.handle(new Request("https://example.test/mcp", {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json", [MCP_CORRELATION_HEADER]: "concurrent-a" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      })),
      instance.handle(new Request("https://example.test/mcp", {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json", [MCP_CORRELATION_HEADER]: "concurrent-b" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
      })),
    ]);
    const notification = await instance.handle(request({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");
    expect(events).toHaveLength(3);
    expect(new Set(events.slice(0, 2).map((event) => event.correlationId))).toEqual(new Set(["concurrent-a", "concurrent-b"]));
    expect(events[2]).toMatchObject({ outcome: "success", httpStatus: 202 });
    await instance.close();
  });

  test("records preflight, authentication and rate denials without tenant identifiers", async () => {
    const events: McpObservabilityEvent[] = [];
    const observe = (event: McpObservabilityEvent) => events.push(event);
    const unauthenticated = createMcpTransport({ capabilities: capabilities(), allowedHosts: ["example.test"], observability: observe });
    const authResponse = await unauthenticated.handle(request({ jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(authResponse.status).toBe(401);
    const limited = createMcpTransport({
      capabilities: capabilities(),
      allowedHosts: ["example.test"],
      authorize: async () => context,
      rateLimiter: { consume: () => ({ allowed: false, retryAfterSeconds: 3 }) },
      observability: observe,
    });
    const rateResponse = await limited.handle(request({ jsonrpc: "2.0", id: 2, method: "ping" }));
    expect(rateResponse.status).toBe(429);
    const preflightResponse = await limited.handle(new Request("https://foreign.test/mcp", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: "{}" }));
    expect(preflightResponse.status).toBe(403);
    expect(events.map((event) => event.event)).toEqual(["mcp_auth", "mcp_rate_limit", "mcp_preflight"]);
    expect(events[0]).toMatchObject({ outcome: "denied", code: "MCP_AUTH_REQUIRED", authDecision: "denied" });
    expect(events[0]).not.toHaveProperty("userId");
    expect(events[0]).not.toHaveProperty("workspaceId");
    expect(events[1]).toMatchObject({ outcome: "denied", code: "RATE_LIMITED", authDecision: "accepted" });
    expect(events[2]).toMatchObject({ outcome: "denied", code: "MCP_HOST_NOT_ALLOWED" });
    await unauthenticated.close();
    await limited.close();
  });

  test("classifies thrown errors by stable code without retaining message, stack or tokens", () => {
    expect(classifySafeError({ code: "MCP_AUTH_REQUIRED", message: "Bearer top-secret" })).toBe("MCP_AUTH_REQUIRED");
    expect(classifySafeError(new Error("refresh_token=top-secret"))).toBe("MCP_INTERNAL_ERROR");
    expect(classifySafeError({ code: "not safe", stack: "token" })).toBe("MCP_INTERNAL_ERROR");
  });
});
