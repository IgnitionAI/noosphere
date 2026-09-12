import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createMcpWriteCapabilities } from "@outbound/bootstrap/create-noosphere-api-runtime";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, mcpOauthClients, workspaceMembers, workspaces } from "@outbound/infrastructure/database/schema";
import { canonicalMcpWriteHash } from "@outbound/interface/mcp/mcp-write-contracts";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";
import type { AiCapability } from "@outbound/application/ai/model-gateway";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("MCP Setup IA availability composition", () => {
  if (!url) return;
  const database = createDatabase(url);
  const workspaceId = crypto.randomUUID(), userId = crypto.randomUUID(), clientId = crypto.randomUUID();
  const context: McpExecutionContext = { workspaceId, userId, clientId, role: "owner", scopes: ["mcp:read", "mcp:write"], audience: "https://mcp.example.test/mcp" };
  const clock = { now: () => new Date("2026-09-10T12:00:00Z") };
  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: workspaceId, name: "MCP AI availability" });
    await database.db.insert(authUsers).values({ id: userId, name: "Synthetic owner", email: `${userId}@example.test` });
    await database.db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner", status: "active" });
    await database.db.insert(mcpOauthClients).values({ clientId, clientName: "Test", redirectUris: [], userId, workspaceId, workspaceSlug: workspaceId, allowedScopes: ["mcp:read", "mcp:write"] });
  }, 60_000);
  afterAll(() => database.close());

  test("research launch refuses missing AI and rolls back its draft and queued work", async () => {
    const checks: unknown[] = [];
    const writes = createMcpWriteCapabilities(database.db, clock, () => async (id, capability) => { checks.push([id, capability]); return false; });
    const args = { requestKey: crypto.randomUUID(), brief: { productUrl: "https://example.test", productName: "Example", description: "", geography: "France", languages: ["fr"], salesMotion: "saas", knownCompetitors: [], internalDocumentIds: [], depth: "standard", audienceGoal: "end_customers", buyerConstraints: "", researchVersion: 2 } };
    await expect(writes.execute(context, { operation: "research_launch", requestKey: args.requestKey, inputHash: canonicalMcpWriteHash(args), arguments: args })).rejects.toThrow("AI_SETUP_REQUIRED");
    expect(checks).toEqual([[workspaceId, "icp_research"]]);
    expect(await database.client`select id from product_research_runs where workspace_id = ${workspaceId}`).toHaveLength(0);
    expect(await database.client`select id from jobs where workspace_id = ${workspaceId}`).toHaveLength(0);
    expect(await database.client`select id from mcp_write_operations where workspace_id = ${workspaceId}`).toHaveLength(0);
  });

  test("enabling autopilot checks every required capability before configuration", async () => {
    const capabilities: AiCapability[] = ["content_idea", "content_brief", "content_writer", "content_audit", "content_critic"];
    for (const unavailable of capabilities) {
      const checks: unknown[] = [];
      const writes = createMcpWriteCapabilities(database.db, clock, () => async (id, capability) => { checks.push([id, capability]); return capability !== unavailable; });
      const args = { requestKey: crypto.randomUUID(), enabled: true, localTime: "06:00", timezone: "Europe/Paris" };
      await expect(writes.execute(context, { operation: "content_autopilot_configure", requestKey: args.requestKey, inputHash: canonicalMcpWriteHash(args), arguments: args })).rejects.toThrow("AI_SETUP_REQUIRED");
      expect(checks).toEqual(capabilities.slice(0, capabilities.indexOf(unavailable) + 1).map(capability => [workspaceId, capability]));
    }
    expect(await database.client`select workspace_id from content_idea_schedules where workspace_id = ${workspaceId}`).toHaveLength(0);
    expect(await database.client`select id from mcp_write_operations where workspace_id = ${workspaceId}`).toHaveLength(0);
  });

  test("disabling autopilot still reaches existing configuration prerequisites without requiring AI", async () => {
    const checks: unknown[] = [];
    const writes = createMcpWriteCapabilities(database.db, clock, () => async (id, capability) => { checks.push([id, capability]); return false; });
    const args = { requestKey: crypto.randomUUID(), enabled: false, localTime: "06:00", timezone: "Europe/Paris" };
    await expect(writes.execute(context, { operation: "content_autopilot_configure", requestKey: args.requestKey, inputHash: canonicalMcpWriteHash(args), arguments: args })).rejects.toThrow("CONTENT_AUTOPILOT_ACTIVE_STRATEGY_REQUIRED");
    expect(checks).toEqual([]);
  });
});
