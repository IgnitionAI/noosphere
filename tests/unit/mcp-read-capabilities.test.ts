import { describe, expect, test } from "bun:test";
import {
  createMcpReadCapabilities,
  type McpExecutionContext,
  type McpReadCapabilities,
} from "@outbound/application/mcp/mcp-read-capabilities";

const context: McpExecutionContext = {
  userId: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  clientId: "test-client",
  role: "viewer",
  scopes: ["mcp:read"],
  audience: "https://example.test/mcp",
};

function fakeCapabilities(): McpReadCapabilities {
  return {
    workspace: { getSummary: async (context) => ({ workspaceId: context.workspaceId }) },
    crm: {
      search: async (context) => ({ data: [{ id: context.workspaceId }], nextCursor: null }),
      getCompany: async (_context, input) => ({ id: input.companyId }),
    },
    prospect: { get360: async (_context, input) => ({ id: input.contactId }) },
    pipeline: { list: async (context) => ({ data: [{ id: context.workspaceId }], nextCursor: null }) },
    opportunity: { get: async (_context, input) => ({ id: input.opportunityId }) },
    conversation: { list: async (context) => ({ data: [{ id: context.workspaceId }], nextCursor: null }) },
    campaign: { getStatus: async (_context, input) => ({ id: input.campaignId }) },
    content: { getCalendar: async (context) => ({ data: [{ id: context.workspaceId }], nextCursor: null }) },
    operations: { getHealth: async (context) => ({ workspaceId: context.workspaceId }) },
  };
}

describe("MCP read capability boundary", () => {
  test("freezes capability groups and forwards only the authenticated workspace context", async () => {
    const capabilities = createMcpReadCapabilities(fakeCapabilities());
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(Object.isFrozen(capabilities.crm)).toBe(true);
    await expect(capabilities.crm.getCompany(context, { companyId: crypto.randomUUID() })).resolves.toBeTruthy();
  });

  test("does not expose a database, provider, or workspace override field", () => {
    const capabilities = createMcpReadCapabilities(fakeCapabilities());
    expect("database" in capabilities).toBe(false);
    expect("provider" in capabilities).toBe(false);
    expect(Object.keys(capabilities)).not.toContain("workspaceId");
  });
});
