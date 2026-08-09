import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, contacts, opportunities, workspaces } from "@outbound/infrastructure/database/schema";
import { createAnalyticsHttpHandler } from "@outbound/interface/http/analytics-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-051 deterministic workspace analytics", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const opportunityId = crypto.randomUUID();
  const context = { workspaceId, userId, role: "owner" as "owner" | "admin" | "operator" | "reviewer" | "viewer" };
  const handle = createAnalyticsHttpHandler({ database: database.db, contextResolver: { async resolve() { return context; } } });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `analytics-${workspaceId}`, name: "Analytics" });
    await database.db.insert(authUsers).values({ id: userId, name: "Analytics Tester", email: `analytics-${userId}@example.com` });
    await database.db.insert(contacts).values({ id: contactId, workspaceId, firstName: "Analytics", lastName: "Prospect", source: "manual" });
  });

  afterAll(async () => {
    await database.client`alter table audit_logs disable trigger user`;
    await database.client`delete from audit_logs where workspace_id = ${workspaceId}`;
    await database.client`delete from opportunities where id = ${opportunityId}`;
    await database.client`delete from contacts where id = ${contactId}`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.client`alter table audit_logs enable trigger user`;
    await database.close();
  });

  test("returns reproducible zero metrics without counting outbox events", async () => {
    const path = "http://localhost/api/v1/analytics/funnel?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z";
    const first = await handle(new Request(path));
    const second = await handle(new Request(path));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toEqual(await second.json());
    expect((firstBody as { metrics: { prospectsFound: number; revenue: number } }).metrics).toMatchObject({ prospectsFound: 0, revenue: 0 });
  });

  test("protects costs/export and validates periods", async () => {
    context.role = "operator";
    expect((await handle(new Request("http://localhost/api/v1/analytics/costs"))).status).toBe(403);
    expect((await handle(new Request("http://localhost/api/v1/analytics/export"))).status).toBe(403);
    context.role = "owner";
    const invalid = await handle(new Request("http://localhost/api/v1/analytics/funnel?from=2026-08-02T00:00:00Z&to=2026-08-01T00:00:00Z"));
    expect(invalid.status).toBe(400);
    const exported = await handle(new Request("http://localhost/api/v1/analytics/export"));
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/csv");
  });

  test("projects won opportunity amount into revenue", async () => {
    await database.db.insert(opportunities).values({
      id: opportunityId,
      workspaceId,
      contactId,
      stage: "won",
      amount: 1250.5,
      currency: "EUR",
    });
    const response = await handle(new Request("http://localhost/api/v1/analytics/funnel?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z"));
    expect(response.status).toBe(200);
    expect((await response.json() as { metrics: { opportunities: number; revenue: number } }).metrics).toMatchObject({ opportunities: 1, revenue: 1250.5 });
    const breakdown = await handle(new Request("http://localhost/api/v1/analytics/breakdown?dimension=campaign&from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z"));
    expect(breakdown.status).toBe(200);
    expect((await breakdown.json() as { data: Array<{ key: string; opportunities: number | null; revenue: number | null }> }).data).toMatchObject([{ key: "unknown", opportunities: 1, revenue: 1250.5 }]);
  });

  test("supports every deterministic breakdown dimension", async () => {
    for (const dimension of ["campaign", "icp", "channel", "role", "signal"]) {
      const response = await handle(new Request(`http://localhost/api/v1/analytics/breakdown?dimension=${dimension}&from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z`));
      expect(response.status).toBe(200);
      const body = await response.json() as { data: unknown[] };
      if (dimension === "channel") expect(body.data).toEqual([]);
      else expect(body.data).toHaveLength(1);
    }
  });
});
