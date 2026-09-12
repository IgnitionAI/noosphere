import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createMcpWriteCapabilities } from "@outbound/bootstrap/create-noosphere-api-runtime";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, contacts, mcpOauthClients, opportunities, workspaceMembers, workspaces } from "@outbound/infrastructure/database/schema";
import { canonicalMcpWriteHash } from "@outbound/interface/mcp/mcp-write-contracts";
import type { McpExecutionContext, McpWriteToolName } from "@outbound/application/mcp/mcp-write-capabilities";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("MCP composed safe-write audit correlations", () => {
  if (!url) return;
  const database = createDatabase(url);
  const workspaceId = crypto.randomUUID(), userId = crypto.randomUUID(), clientId = crypto.randomUUID();
  const contactId = crypto.randomUUID(), opportunityId = crypto.randomUUID();
  const context: McpExecutionContext = { workspaceId, userId, clientId, role: "owner", scopes: ["mcp:read", "mcp:write"], audience: "/mcp" };
  const clock = { now: () => new Date("2026-09-10T12:00:00Z") };
  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: workspaceId, name: "MCP correlation fixture" });
    await database.db.insert(authUsers).values({ id: userId, name: "Synthetic owner", email: `${userId}@example.test` });
    await database.db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner", status: "active" });
    await database.db.insert(mcpOauthClients).values({ clientId, clientName: "Test", redirectUris: [], userId, workspaceId, workspaceSlug: workspaceId, allowedScopes: ["mcp:read", "mcp:write"] });
    await database.db.insert(contacts).values({ id: contactId, workspaceId, firstName: "Synthetic", lastName: "Contact" });
    await database.db.insert(opportunities).values({ id: opportunityId, workspaceId, contactId });
  }, 60_000);
  afterAll(() => database.close());

  const cases: Array<[McpWriteToolName, Record<string, unknown>]> = [
    ["company_upsert", { name: "Synthetic company" }],
    ["contact_upsert", { firstName: "New", lastName: "Contact", email: `${crypto.randomUUID()}@example.test` }],
    ["opportunity_update", { opportunityId, amount: 100, currency: "EUR" }],
    ["opportunity_change_stage", { opportunityId, stage: "meeting_booked" }],
    ["prospect_add_note", { contactId, note: "Synthetic internal note" }],
    ["prospect_schedule_dry_run", { contactId }],
  ];
  for (const [operation, input] of cases) {
    test(`${operation} preserves audit correlation and exact result across replay`, async () => {
      const args = { ...input, requestKey: crypto.randomUUID() };
      const command = { operation, requestKey: args.requestKey, arguments: args, inputHash: canonicalMcpWriteHash(args) };
      const first = await createMcpWriteCapabilities(database.db, clock).execute(context, command);
      const replay = await createMcpWriteCapabilities(database.db, clock).execute(context, command);
      expect(replay).toEqual(first);
      expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
      const [audit] = await database.client`select correlation_id, outcome from mcp_oauth_audit_events where id = ${first.auditId!}`;
      const [ledger] = await database.client`select correlation_id, result from mcp_write_operations where workspace_id = ${workspaceId} and request_key = ${args.requestKey}`;
      expect(audit?.outcome).toBe("accepted");
      expect(first.correlationId).toBe(audit?.correlation_id);
      expect(first.correlationId).toBe(ledger?.correlation_id);
      expect(ledger?.result).toEqual(first);
      if (operation === "prospect_schedule_dry_run") {
        const traces = await database.client`select d.correlation_id, j.correlation_id as job_correlation_id from prospect_decisions d join jobs j on j.id = d.job_id where d.workspace_id = ${workspaceId} and d.id = ${first.id}`;
        expect(traces).toHaveLength(1);
        expect(traces[0]?.correlation_id).toBe(first.correlationId);
        expect(traces[0]?.job_correlation_id).toBe(first.correlationId);
      }
    });
  }
});
