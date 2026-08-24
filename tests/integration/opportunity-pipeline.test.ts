import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, contacts, opportunities, opportunityStageHistory, workspaceMembers, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresOpportunityRepository } from "@outbound/infrastructure/pipeline/postgres-opportunity-repository";
import { createOpportunityHttpHandler } from "@outbound/interface/http/opportunity-handler";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-044 opportunity pipeline completion", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const repository = new PostgresOpportunityRepository(database.db);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const opportunityId = crypto.randomUUID();
  const context = { workspaceId, userId, role: "operator" as "owner" | "admin" | "operator" | "reviewer" | "viewer" };
  const handle = createOpportunityHttpHandler({ repository, contextResolver: { async resolve() { return context; } } });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `f044-${workspaceId}`, name: "F-044 A" },
      { id: otherWorkspaceId, slug: `f044-${otherWorkspaceId}`, name: "F-044 B" },
    ]);
    await database.db.insert(authUsers).values([
      { id: userId, name: "F-044 Owner", email: `f044-${userId}@example.com` },
      { id: otherUserId, name: "F-044 Other", email: `f044-${otherUserId}@example.com` },
    ]);
    await database.db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner" });
    await database.db.insert(contacts).values({ id: contactId, workspaceId, firstName: "Pipeline", lastName: "Prospect", source: "manual" });
    await database.db.insert(opportunities).values({ id: opportunityId, workspaceId, contactId, stage: "qualified" });
  });

  afterAll(async () => {
    await database.client`alter table audit_logs disable trigger user`;
    await database.client`alter table opportunity_stage_history disable trigger user`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from opportunities where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table opportunity_stage_history enable trigger user`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from workspace_members where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id in (${userId}, ${otherUserId})`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table audit_logs enable trigger user`;
    await database.close();
  });

  test("edits open opportunities and redacts amounts for viewers", async () => {
    const patch = await handle(new Request(`http://localhost/api/v1/opportunities/${opportunityId}`, { method: "PATCH", body: JSON.stringify({ amount: 1_000, currency: "EUR", probability: 60, ownerUserId: userId, expectedCloseDate: "2026-08-20T00:00:00Z" }) }));
    expect(patch.status).toBe(200);
    context.role = "viewer";
    const list = await handle(new Request("http://localhost/api/v1/opportunities"));
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).not.toContain("1000");
    context.role = "operator";
  });

  test("requires dedicated close fields, locks closed edits and audits reopen", async () => {
    const won = await handle(new Request(`http://localhost/api/v1/opportunities/${opportunityId}/actions/close`, { method: "POST", body: JSON.stringify({ stage: "won" }) }));
    expect(won.status).toBe(422);
    const missingLost = await handle(new Request(`http://localhost/api/v1/opportunities/${opportunityId}/actions/close`, { method: "POST", body: JSON.stringify({ stage: "lost" }) }));
    expect(missingLost.status).toBe(422);
    const lost = await handle(new Request(`http://localhost/api/v1/opportunities/${opportunityId}/actions/close`, { method: "POST", body: JSON.stringify({ stage: "lost", lostReason: "budget", lostComment: "Budget gelé" }) }));
    expect(lost.status).toBe(200);
    const locked = await handle(new Request(`http://localhost/api/v1/opportunities/${opportunityId}`, { method: "PATCH", body: JSON.stringify({ amount: 2_000 }) }));
    expect(locked.status).toBe(409);
    context.role = "viewer";
    expect((await handle(new Request(`http://localhost/api/v1/opportunities/${opportunityId}/actions/reopen`, { method: "POST" }))).status).toBe(403);
    context.role = "owner";
    const reopened = await handle(new Request(`http://localhost/api/v1/opportunities/${opportunityId}/actions/reopen`, { method: "POST" }));
    expect(reopened.status).toBe(200);
    const history = await database.db.select().from(opportunityStageHistory).where(and(eq(opportunityStageHistory.workspaceId, workspaceId), eq(opportunityStageHistory.opportunityId, opportunityId)));
    expect(history.map((row) => row.toStage)).toEqual(["lost", "qualified"]);
    context.role = "operator";
  });

  test("forecasts weighted revenue deterministically and isolates workspaces", async () => {
    const forecast = await handle(new Request("http://localhost/api/v1/pipeline/forecast?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z"));
    expect(forecast.status).toBe(200);
    const body = await forecast.json() as { data: { weightedRevenue: number }[] };
    expect(body.data[0]?.weightedRevenue).toBe(600);
    context.workspaceId = otherWorkspaceId;
    const isolated = await handle(new Request("http://localhost/api/v1/opportunities"));
    expect(((await isolated.json()) as { data: unknown[] }).data).toHaveLength(0);
    context.workspaceId = workspaceId;
  });
});
