import { describe, expect, test } from "bun:test";
import { resolveMcpDevAuthorization } from "@outbound/bootstrap/create-noosphere-api-runtime";

const baseEnvironment = {
  NODE_ENV: "development",
  MCP_DEV_AUTH_ENABLED: "true",
  MCP_DEV_AUTH_TOKEN: "dev-token",
  MCP_DEV_USER_ID: "00000000-0000-4000-8000-000000000001",
  MCP_DEV_WORKSPACE_ID: "00000000-0000-4000-8000-000000000002",
  MCP_DEV_CLIENT_ID: "local-inspector",
  MCP_DEV_ROLE: "reviewer",
  MCP_DEV_SCOPES: "mcp:read,mcp:write,mcp:approve",
};

describe("MCP development authorization", () => {
  test("builds an explicit bounded context only when development auth is enabled", () => {
    expect(resolveMcpDevAuthorization(baseEnvironment, "https://example.test/mcp")).toEqual({
      token: "dev-token",
      context: {
        userId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002",
        clientId: "local-inspector",
        role: "reviewer",
        scopes: ["mcp:read", "mcp:write", "mcp:approve"],
        audience: "https://example.test/mcp",
      },
    });
    expect(resolveMcpDevAuthorization({ ...baseEnvironment, MCP_DEV_AUTH_ENABLED: "false" }, "https://example.test/mcp")).toBeNull();
  });

  test("fails closed for missing or incoherent development credentials", () => {
    expect(() => resolveMcpDevAuthorization({ ...baseEnvironment, MCP_DEV_USER_ID: "not-uuid" }, "https://example.test/mcp")).toThrow("MCP_DEV_AUTH_CONFIG_INVALID");
    expect(() => resolveMcpDevAuthorization({ ...baseEnvironment, MCP_DEV_SCOPES: "mcp:write" }, "https://example.test/mcp")).toThrow("MCP_DEV_AUTH_CONFIG_INVALID");
    expect(() => resolveMcpDevAuthorization({ ...baseEnvironment, NODE_ENV: "production" }, "https://example.test/mcp")).toThrow("MCP_DEV_AUTH_DISABLED_IN_PRODUCTION");
  });
});
