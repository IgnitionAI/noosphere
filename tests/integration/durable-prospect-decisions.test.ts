import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { PROSPECT_DECISION_JOB_TYPE } from "@outbound/application/campaigns/prospect-decision";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { contacts, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { PostgresProspectDecisionScheduler } from "@outbound/infrastructure/campaigns/postgres-prospect-decision-scheduler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("AI-150 durable prospect decisions", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const queue = new PostgresJobQueue(database.client);
  const scheduler = new PostgresProspectDecisionScheduler(database.db);
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const contactA = crypto.randomUUID();
  const contactB = crypto.randomUUID();

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values([
      { id: workspaceA, slug: `decision-a-${workspaceA}`, name: "Decision A" },
      { id: workspaceB, slug: `decision-b-${workspaceB}`, name: "Decision B" },
    ]);
    await database.db.insert(contacts).values([
      { id: contactA, workspaceId: workspaceA, firstName: "Ada", lastName: "Martin" },
      { id: contactB, workspaceId: workspaceB, firstName: "Grace", lastName: "Durand" },
    ]);
  });

  afterAll(async () => {
    await database.client`delete from prospect_decisions where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from jobs where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from contacts where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from workspaces where id in (${workspaceA}, ${workspaceB})`;
    await database.close();
  });

  test("reschedules one logical decision and keeps identical keys isolated by workspace", async () => {
    const firstDueAt = new Date("2026-08-13T10:00:00.000Z");
    const revisedDueAt = new Date("2026-08-13T11:00:00.000Z");
    const idempotencyKey = "contact-recheck:active-campaign";

    const first = await scheduler.schedule({
      id: crypto.randomUUID(),
      workspaceId: workspaceA,
      contactId: contactA,
      kind: "recheck",
      reason: "Revoir le prospect après le délai de réponse initial.",
      dueAt: firstDueAt,
      idempotencyKey,
      correlationId: "decision-a",
    });
    const replay = await scheduler.schedule({
      id: crypto.randomUUID(),
      workspaceId: workspaceA,
      contactId: contactA,
      kind: "recheck",
      reason: "Attendre la fin de la fenêtre de réponse observée.",
      dueAt: revisedDueAt,
      idempotencyKey,
      correlationId: "decision-a",
    });
    const otherWorkspace = await scheduler.schedule({
      id: crypto.randomUUID(),
      workspaceId: workspaceB,
      contactId: contactB,
      kind: "recheck",
      reason: "Même clé logique, autre workspace.",
      dueAt: firstDueAt,
      idempotencyKey,
      correlationId: "decision-b",
    });

    expect(first.created).toBe(true);
    expect(replay).toMatchObject({ created: false, decision: { id: first.decision.id } });
    expect(replay.decision.reason).toBe("Attendre la fin de la fenêtre de réponse observée.");
    expect(replay.decision.dueAt).toEqual(revisedDueAt);
    expect(otherWorkspace).toMatchObject({ created: true });
    expect(otherWorkspace.decision.id).not.toBe(first.decision.id);

    const tooEarly = await queue.lease({
      workerId: "decision-worker-early",
      types: [PROSPECT_DECISION_JOB_TYPE],
      limit: 10,
      leaseMs: 30_000,
      now: new Date("2026-08-13T10:30:00.000Z"),
    });
    expect(tooEarly.map((job) => job.workspaceId)).toEqual([workspaceB]);
    await queue.acknowledge(tooEarly[0]!.id, tooEarly[0]!.lockedBy, new Date("2026-08-13T10:30:01.000Z"));

    const due = await queue.lease({
      workerId: "decision-worker-due",
      types: [PROSPECT_DECISION_JOB_TYPE],
      limit: 10,
      leaseMs: 30_000,
      now: new Date("2026-08-13T11:00:00.000Z"),
    });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ workspaceId: workspaceA });
  });
});
