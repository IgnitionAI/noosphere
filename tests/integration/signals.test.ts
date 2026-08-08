import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, companies, contacts, workspaces } from "@outbound/infrastructure/database/schema";
import type { SignalSource } from "@outbound/application/crm/signal-source";
import { createSignalHttpHandler } from "@outbound/interface/http/signal-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-027 intent signals", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  let calls = 0;
  const source: SignalSource = {
    name: "fake-public-source",
    supportedTypes: ["hiring", "job_change"],
    async collect(input) {
      calls += 1;
      return [{ signalType: "hiring", entityType: input.entityType, entityId: input.entityId, companyId: input.companyId, contactId: input.contactId, source: "fake-public-source", providerEventId: "provider-1", evidenceUrl: "https://example.test/careers", evidenceSnippet: "Hiring engineers", observedAt: new Date("2026-08-01T00:00:00Z"), expiresAt: new Date("2026-09-15T00:00:00Z"), confidence: "medium", deduplicationKey: `hiring:${input.entityId}:2026-08-01`, legalBasis: "public_professional_information", sourceAuthorized: true }];
    },
  };
  const context = { userId, workspaceId, role: "owner" as "owner" | "admin" | "operator" | "viewer" | "reviewer" };
  const handle = createSignalHttpHandler({ database: database.db, contextResolver: { async resolve() { return context; } }, signalSource: () => source });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `signals-a-${workspaceId}`, name: "Signals A" },
      { id: otherWorkspaceId, slug: `signals-b-${otherWorkspaceId}`, name: "Signals B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Signal Tester", email: `signals-${userId}@example.com` });
    await database.db.insert(companies).values({ id: companyId, workspaceId, name: "Signal Co", normalizedDomain: `signals-${companyId}.example`, source: "manual" });
    await database.db.insert(contacts).values({ id: contactId, workspaceId, firstName: "Signal", lastName: "Tester", source: "manual" });
  });

  afterAll(async () => {
    await database.client`alter table audit_logs disable trigger user`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from signals where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from signal_collection_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from companies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table audit_logs enable trigger user`;
    await database.close();
  });

  test("collects idempotently, exposes current signals, and emits one observation event", async () => {
    const request = () => handle(new Request("http://localhost/api/v1/signals/actions/collect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, requestKey: "same-signal-request", signalTypes: ["hiring"] }) }));
    expect((await request()).status).toBe(202);
    expect((await request()).status).toBe(200);
    expect(calls).toBe(1);
    const listed = await handle(new Request(`http://localhost/api/v1/companies/${companyId}/signals`));
    expect(listed.status).toBe(200);
    expect((await listed.json() as { data: unknown[] }).data).toHaveLength(1);
    const events = await database.client<{ count: number }[]>`select count(*)::int as count from outbox_events where workspace_id = ${workspaceId} and event_type = 'SignalObserved'`;
    expect(events[0]?.count).toBe(1);
  });

  test("keeps workspace isolation and reserves collection to owner/admin", async () => {
    context.role = "operator";
    expect((await handle(new Request("http://localhost/api/v1/signals/actions/collect", { method: "POST", body: JSON.stringify({ companyId }) }))).status).toBe(403);
    context.role = "viewer";
    context.workspaceId = otherWorkspaceId;
    const foreign = await handle(new Request(`http://localhost/api/v1/companies/${companyId}/signals`));
    expect((await foreign.json() as { data: unknown[] }).data).toHaveLength(0);
    context.workspaceId = workspaceId;
    context.role = "owner";
  });
});
