import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { recordRejectedUnipileWebhook } from "@outbound/infrastructure/campaigns/unipile-webhook-ingestor";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { auditLogs, authUsers, connectedAccounts, integrationEvents, jobs, outboxEvents, workspaces } from "@outbound/infrastructure/database/schema";
import { OperatorConsoleError, PostgresOperatorConsole } from "@outbound/infrastructure/operations/postgres-operator-console";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-003 operator console", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const otherJobId = crypto.randomUUID();
  const correlationId = `operator-console:${jobId}`;
  const now = new Date("2026-08-09T20:00:00.000Z");
  const service = new PostgresOperatorConsole(database.db, { now: () => now }, { generate: () => crypto.randomUUID() });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `console-${workspaceId}`, name: "Console" },
      { id: otherWorkspaceId, slug: `console-other-${otherWorkspaceId}`, name: "Console other" },
    ]);
    await database.db.insert(authUsers).values({ id: ownerId, name: "Console Owner", email: `console-${ownerId}@example.com` });
    await database.db.insert(connectedAccounts).values({ id: crypto.randomUUID(), workspaceId, provider: "unipile", providerAccountId: "account-console-test", status: "connected", encryptedSecret: "test-only-encrypted-placeholder", createdBy: ownerId, createdAt: now, updatedAt: now });
    await database.db.insert(jobs).values([
      { id: jobId, workspaceId, type: "test.console", payload: { authorization: "Bearer leaked-token", email: "person@example.com", safe: "PROVIDER_DOWN" }, idempotencyKey: "original-key", correlationId, status: "dead_lettered", attempts: 3, maxAttempts: 3, availableAt: now, lastErrorCode: "PROVIDER_DOWN", lastErrorMessage: "Failure for person@example.com", createdAt: now, updatedAt: now },
      { id: otherJobId, workspaceId: otherWorkspaceId, type: "test.console", payload: { secret: "other-secret" }, idempotencyKey: "other-key", correlationId, status: "dead_lettered", attempts: 3, maxAttempts: 3, availableAt: now, createdAt: now, updatedAt: now },
    ]);
    const correlationEventId = crypto.randomUUID();
    await database.db.insert(outboxEvents).values({ id: correlationEventId, workspaceId, aggregateType: "test", aggregateId: jobId, eventType: "TestFailed", payload: { correlationId, token: "event-secret" }, createdAt: now, availableAt: now });
    await database.db.insert(auditLogs).values({ id: crypto.randomUUID(), workspaceId, actorUserId: ownerId, action: "TestFailed", subjectType: "job", subjectId: jobId, changes: { email: "person@example.com" }, correlationId, sourceEventId: correlationEventId, createdAt: now });
    expect(await recordRejectedUnipileWebhook(database.db, JSON.stringify({ account_id: "account-console-test", apiKey: "webhook-secret" }), "INVALID_WEBHOOK_SIGNATURE", now)).toBe(true);
  });

  afterAll(async () => {
    await database.client.begin(async (tx) => {
      await tx`delete from integration_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from connected_accounts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`alter table audit_logs disable trigger user`;
      await tx`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`alter table audit_logs enable trigger user`;
      await tx`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from auth_users where id = ${ownerId}`;
      await tx`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  test("isolates and redacts diagnostic data while tracing the full correlation", async () => {
    const listed = await service.listDeadLetters({ workspaceId, limit: 50 });
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("leaked-token");
    expect(JSON.stringify(listed)).not.toContain("person@example.com");
    expect(listed[0]).toMatchObject({ id: jobId, correlationId });
    expect(JSON.stringify(listed)).not.toContain("original-key");
    const rejected = await service.listRejectedWebhooks({ workspaceId, limit: 50 });
    expect(rejected).toHaveLength(1);
    expect(JSON.stringify(rejected)).not.toContain("webhook-secret");
    expect(await recordRejectedUnipileWebhook(database.db, JSON.stringify({ account_id: "account-console-test", different: "body" }), "INVALID_WEBHOOK_SIGNATURE", now)).toBe(false);
    const trace = await service.traceCorrelation({ workspaceId, correlationId });
    expect(trace.jobs).toHaveLength(1);
    expect(trace.events).toHaveLength(1);
    expect(trace.audit).toHaveLength(1);
    expect(JSON.stringify(trace)).not.toContain("event-secret");
  });

  test("requeues once under concurrency and preserves the original identity", async () => {
    const results = await Promise.allSettled([
      service.requeue({ workspaceId, actorUserId: ownerId, jobId }),
      service.requeue({ workspaceId, actorUserId: ownerId, jobId }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(OperatorConsoleError);
    expect(rejected?.reason.code).toBe("CONSOLE_JOB_ALREADY_QUEUED");
    const [stored] = await database.db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)));
    expect(stored).toMatchObject({ status: "pending", attempts: 0, idempotencyKey: "original-key", correlationId });
    expect(await database.db.select().from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.eventType, "JobRequeued")))).toHaveLength(1);
    expect(await database.db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.action, "JobRequeued")))).toHaveLength(1);
  });
});
