import { describe, expect, test } from "bun:test";
import {
  MCP_READ_RESOURCE_URIS,
  mcpToolArgumentsSchema,
  parseMcpToolArguments,
  redactMcpReadValue,
} from "@outbound/interface/mcp/mcp-read-contracts";

describe("MCP read contracts", () => {
  test("accepts bounded pagination and rejects workspace injection or oversized cursors", () => {
    expect(parseMcpToolArguments("crm_search", { query: "acme", limit: 100, cursor: "opaque" }))
      .toMatchObject({ query: "acme", limit: 100, cursor: "opaque" });
    expect(() => parseMcpToolArguments("crm_search", { workspaceId: crypto.randomUUID() })).toThrow();
    expect(() => parseMcpToolArguments("crm_search", { limit: 101 })).toThrow();
    expect(() => parseMcpToolArguments("crm_search", { cursor: "x".repeat(513) })).toThrow();
  });

  test("requires UUID entity arguments and rejects unknown keys", () => {
    expect(() => parseMcpToolArguments("company_get_brief", { companyId: "not-a-uuid" })).toThrow();
    expect(() => parseMcpToolArguments("company_get_brief", { companyId: crypto.randomUUID(), extra: true })).toThrow();
    const contactId = crypto.randomUUID();
    expect(parseMcpToolArguments("prospect_get_360", { contactId })).toEqual({ contactId });
  });

  test("publishes exactly the stable eight resource URI templates", () => {
    expect(MCP_READ_RESOURCE_URIS).toEqual([
      "noosphere://workspace/current/summary",
      "noosphere://workspace/current/pipeline",
      "noosphere://companies/{companyId}/brief",
      "noosphere://prospects/{contactId}/360",
      "noosphere://opportunities/{opportunityId}",
      "noosphere://campaigns/{campaignId}/status",
      "noosphere://content/calendar",
      "noosphere://operations/health",
    ]);
  });

  test("redacts viewer-sensitive monetary and provider material recursively", () => {
    const value = redactMcpReadValue({
      id: "entity-1",
      amount: 500,
      currency: "EUR",
      providerPostId: "provider-secret",
      accountSnapshot: { providerAccountId: "provider-account", displayName: "Safe" },
      nested: { stable: true, secret: "remove" },
    }, "viewer");
    expect(value).toEqual({ id: "entity-1", accountSnapshot: { displayName: "Safe" }, nested: { stable: true } });
  });

  test("redacts provider labels and URLs for viewers", () => {
    expect(redactMcpReadValue({ provider: "unipile", providerUrl: "https://provider.invalid", name: "Acme" }, "viewer"))
      .toEqual({ name: "Acme" });
  });

  test("bounds conversation page offsets", () => {
    expect(() => parseMcpToolArguments("conversation_list", { page: 101 })).toThrow();
  });

  test("accepts bounded content calendar date filters", () => {
    expect(parseMcpToolArguments("content_get_calendar", {
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-31T23:59:59Z",
      limit: 10,
    })).toMatchObject({ from: "2026-01-01T00:00:00Z", to: "2026-01-31T23:59:59Z", limit: 10 });
  });

  test("keeps non-sensitive IDs and semantic 360 fields for non-viewer roles", () => {
    const value = redactMcpReadValue({
      facts: { confirmedNeeds: [{ eventId: "event-1" }] },
      hypotheses: [{ id: "hypothesis-1" }],
      recommendations: [{ id: "recommendation-1" }],
      contradictions: ["missing proof"],
      missingInformation: ["budget"],
      provenance: [{ sourceId: "source-1" }],
    }, "operator");
    expect(value).toMatchObject({ facts: expect.any(Object), hypotheses: expect.any(Array), recommendations: expect.any(Array), contradictions: ["missing proof"], missingInformation: ["budget"] });
  });
});
