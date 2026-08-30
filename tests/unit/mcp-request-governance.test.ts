import { describe, expect, test } from "bun:test";
import {
  InMemoryMcpRateLimiter,
  MCP_CORRELATION_HEADER,
  deriveMcpCorrelationId,
  validateMcpExecutionContext,
} from "@outbound/interface/mcp/mcp-request-governance";

const context = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  clientId: "inspector",
  role: "reviewer" as const,
  scopes: ["mcp:read", "mcp:write", "mcp:approve"] as const,
  audience: "https://example.test/mcp",
};

describe("MCP request governance", () => {
  test("accepts only a bounded UUID tenant context with the exact resource audience", () => {
    expect(validateMcpExecutionContext(context, "https://example.test/mcp")).toEqual(context);
    expect(validateMcpExecutionContext({ ...context, workspaceId: "workspace-1" }, "https://example.test/mcp")).toBeNull();
    expect(validateMcpExecutionContext({ ...context, audience: "https://example.test/mcp/other" }, "https://example.test/mcp")).toBeNull();
    expect(validateMcpExecutionContext({ ...context, clientId: "x".repeat(201) }, "https://example.test/mcp")).toBeNull();
    expect(validateMcpExecutionContext({ ...context, scopes: ["mcp:read", "unknown"] as never }, "https://example.test/mcp")).toBeNull();
  });

  test("generates bounded request-local correlation IDs and preserves safe values", () => {
    expect(deriveMcpCorrelationId("request-123")).toBe("request-123");
    expect(deriveMcpCorrelationId("bad value")).not.toBe("bad value");
    expect(deriveMcpCorrelationId("x".repeat(129))).not.toBe("x".repeat(129));
    expect(MCP_CORRELATION_HEADER).toBe("x-correlation-id");
  });

  test("limits each authenticated client/workspace/tool key with bounded costs", () => {
    const limiter = new InMemoryMcpRateLimiter({ maxCost: 2, windowMs: 60_000 });
    const key = { clientId: "client", workspaceId: context.workspaceId, tool: "tracer" };
    expect(limiter.consume({ ...key, cost: 1 })).toMatchObject({ allowed: true });
    expect(limiter.consume({ ...key, cost: 1 })).toMatchObject({ allowed: true });
    expect(limiter.consume({ ...key, cost: 1 })).toMatchObject({ allowed: false, retryAfterSeconds: expect.any(Number) });
    expect(limiter.consume({ ...key, tool: "noosphere_ping", cost: 1 })).toMatchObject({ allowed: true });
    expect(limiter.consume({ ...key, workspaceId: "00000000-0000-4000-8000-000000000003", cost: 1 })).toMatchObject({ allowed: true });
    expect(limiter.consume({ ...key, cost: 0 })).toMatchObject({ allowed: false });
  });
});
