import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { jobs, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresOperationalViews } from "@outbound/infrastructure/workspaces/postgres-operational-views";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("Noosphere operational projections", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const views = new PostgresOperationalViews(database.db);
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const jobA = crypto.randomUUID();
  const jobB = crypto.randomUUID();
  const lockedAt = new Date("2026-08-20T06:00:00.000Z");
  const lockedUntil = new Date("2026-08-20T06:05:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceA, slug: `noosphere-a-${workspaceA}`, name: "Noosphere A" },
      { id: workspaceB, slug: `noosphere-b-${workspaceB}`, name: "Noosphere B" },
    ]);
    await database.db.insert(jobs).values([
      { id: jobA, workspaceId: workspaceA, type: "campaign.autopilot", payload: {}, idempotencyKey: "axis-a", correlationId: "axis-proof-a", status: "running", attempts: 1, maxAttempts: 3, availableAt: lockedAt, lockedAt, lockedUntil, lockedBy: "worker-a" },
      { id: jobB, workspaceId: workspaceB, type: "campaign.autopilot", payload: {}, idempotencyKey: "axis-b", correlationId: "axis-proof-b", status: "running", attempts: 1, maxAttempts: 3, availableAt: lockedAt, lockedAt, lockedUntil, lockedBy: "worker-b" },
    ]);
  });

  afterAll(async () => {
    await database.client`delete from jobs where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from workspaces where id in (${workspaceA}, ${workspaceB})`;
    await database.close();
  });

  test("switching the three lenses never changes a running job or its lease", async () => {
    const [before] = await database.db.select().from(jobs).where(eq(jobs.id, jobA));
    const pages = await Promise.all([
      views.getActivity({ workspaceId: workspaceA, lens: "inbound" }),
      views.getActivity({ workspaceId: workspaceA, lens: "symbiosis" }),
      views.getActivity({ workspaceId: workspaceA, lens: "outbound" }),
    ]);
    expect(pages.map((page) => page.lens)).toEqual(["inbound", "symbiosis", "outbound"]);
    const [after] = await database.db.select().from(jobs).where(eq(jobs.id, jobA));
    expect(after).toMatchObject({
      id: before!.id,
      status: before!.status,
      lockedAt: before!.lockedAt,
      lockedUntil: before!.lockedUntil,
      lockedBy: before!.lockedBy,
      attempts: before!.attempts,
    });
  });

  test("summary and activity stay isolated to the session workspace", async () => {
    const summaryA = await views.getSummary(workspaceA);
    const summaryB = await views.getSummary(workspaceB);
    expect(summaryA.jobs.running.map((job) => job.id)).toEqual([jobA]);
    expect(summaryB.jobs.running.map((job) => job.id)).toEqual([jobB]);
    expect(summaryA.engines.inbound.status).toBe("not_configured");
    expect(summaryA.engines.outbound.status).toBe("running");
  });
});
