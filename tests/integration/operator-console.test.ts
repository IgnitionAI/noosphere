import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { recordRejectedUnipileWebhook } from "@outbound/infrastructure/campaigns/unipile-webhook-ingestor";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { auditLogs, authUsers, channelAssessments, connectedAccounts, integrationEvents, jobs, outreachActions, outboxEvents, prospectingPlans, workspaces } from "@outbound/infrastructure/database/schema";
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
  const automaticRetryJobId = crypto.randomUUID();
  const dispatchJobId = crypto.randomUUID();
  const outreachActionId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const sequenceId = crypto.randomUUID();
  const sequenceVersionId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const enrollmentId = crypto.randomUUID();
  const planId = crypto.randomUUID();
  const assessmentId = crypto.randomUUID();
  const assessmentJobId = crypto.randomUUID();
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
      { id: automaticRetryJobId, workspaceId, type: "outreach.dispatch", payload: { workspaceId, actionId: crypto.randomUUID() }, idempotencyKey: "automatic-retry-key", correlationId: `${correlationId}:automatic`, status: "retry", attempts: 1, maxAttempts: 5, availableAt: new Date(now.getTime() + 60_000), lastErrorCode: "OUTSIDE_SENDING_WINDOW", lastErrorMessage: "Waiting for the next business window", createdAt: now, updatedAt: now },
    ]);
    await database.client`insert into icps (id, workspace_id, name, current_version) values (${icpId}, ${workspaceId}, 'Console ICP', 1)`;
    await database.client`insert into icp_versions (id, workspace_id, icp_id, version, name, confidence, criteria, buying_committee, problems, signals, exclusions, unknowns, unresolved_contradictions, blocked_findings, published_by, published_at) values (${icpVersionId}, ${workspaceId}, ${icpId}, 1, 'Console ICP', 0.9, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ${ownerId}, ${now})`;
    await database.client`insert into sequences (id, workspace_id, name) values (${sequenceId}, ${workspaceId}, 'Console sequence')`;
    await database.client`insert into sequence_versions (id, workspace_id, sequence_id, version, steps, published_by, published_at) values (${sequenceVersionId}, ${workspaceId}, ${sequenceId}, 1, '[]'::jsonb, ${ownerId}, ${now})`;
    await database.client`insert into campaigns (id, workspace_id, name, status, icp_version_id, channel, sequence_id, sequence_version_id, created_by) values (${campaignId}, ${workspaceId}, 'Console campaign', 'active', ${icpVersionId}, 'linkedin', ${sequenceId}, ${sequenceVersionId}, ${ownerId})`;
    await database.client`insert into contacts (id, workspace_id, first_name, last_name) values (${contactId}, ${workspaceId}, 'Ada', 'Console')`;
    await database.client`insert into campaign_enrollments (id, workspace_id, campaign_id, contact_id, sequence_version_id, enrolled_by) values (${enrollmentId}, ${workspaceId}, ${campaignId}, ${contactId}, ${sequenceVersionId}, ${ownerId})`;
    await database.client`insert into outreach_actions (id, workspace_id, campaign_id, enrollment_id, contact_id, sequence_version_id, step_position, step_kind, channel, idempotency_key, status, due_at, last_error_code, last_error_message) values (${outreachActionId}, ${workspaceId}, ${campaignId}, ${enrollmentId}, ${contactId}, ${sequenceVersionId}, 1, 'linkedin_message', 'linkedin', 'console-jit-recovery', 'failed', ${now}, 'CAMPAIGN_JIT_GENERATION_FAILED', 'Provider quota was exhausted before any delivery attempt')`;
    await database.db.insert(jobs).values({ id: dispatchJobId, workspaceId, type: "outreach.dispatch", payload: { workspaceId, actionId: outreachActionId }, idempotencyKey: "dispatch-recovery-key", correlationId: `${correlationId}:dispatch`, status: "dead_lettered", attempts: 5, maxAttempts: 5, availableAt: now, lastErrorCode: "CAMPAIGN_JIT_GENERATION_FAILED", lastErrorMessage: "Provider quota was exhausted before any delivery attempt", createdAt: now, updatedAt: now });
    await database.client`insert into prospecting_plans (id, workspace_id, icp_version_id, name, status) values (${planId}, ${workspaceId}, ${icpVersionId}, 'Console plan', 'ready')`;
    await database.client`insert into channel_assessments (id, workspace_id, plan_id, channel, status, error_code, error_message, completed_at) values (${assessmentId}, ${workspaceId}, ${planId}, 'email', 'failed', 'CHANNEL_ASSESSMENT_FAILED', 'Structured model unavailable', ${now})`;
    await database.db.insert(jobs).values({ id: assessmentJobId, workspaceId, type: "prospecting.channel.assess", payload: { workspaceId, assessmentId }, idempotencyKey: "assessment-recovery-key", correlationId: `${correlationId}:assessment`, status: "dead_lettered", attempts: 3, maxAttempts: 3, availableAt: now, lastErrorCode: "CHANNEL_ASSESSMENT_FAILED", lastErrorMessage: "Structured model unavailable", createdAt: now, updatedAt: now });
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
      await tx`delete from outreach_actions where workspace_id = ${workspaceId}`;
      await tx`delete from campaign_enrollments where workspace_id = ${workspaceId}`;
      await tx`delete from campaigns where workspace_id = ${workspaceId}`;
      await tx`delete from channel_assessments where workspace_id = ${workspaceId}`;
      await tx`delete from prospecting_plans where workspace_id = ${workspaceId}`;
      await tx`alter table icp_versions disable trigger user`;
      await tx`alter table sequence_versions disable trigger user`;
      await tx`delete from icp_versions where workspace_id = ${workspaceId}`;
      await tx`delete from sequence_versions where workspace_id = ${workspaceId}`;
      await tx`alter table icp_versions enable trigger user`;
      await tx`alter table sequence_versions enable trigger user`;
      await tx`delete from icps where workspace_id = ${workspaceId}`;
      await tx`delete from sequences where workspace_id = ${workspaceId}`;
      await tx`delete from contacts where workspace_id = ${workspaceId}`;
      await tx`delete from auth_users where id = ${ownerId}`;
      await tx`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  test("isolates and redacts diagnostic data while tracing the full correlation", async () => {
    const listed = await service.listDeadLetters({ workspaceId, type: "test.console", limit: 50 });
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

  test("does not turn an automatic business-window retry into an immediate manual retry", async () => {
    await expect(service.requeue({ workspaceId, actorUserId: ownerId, jobId: automaticRetryJobId }))
      .rejects.toMatchObject({ code: "CONSOLE_JOB_RETRY_SCHEDULED", status: 409 });
    const [stored] = await database.db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, automaticRetryJobId)));
    expect(stored).toMatchObject({ status: "retry", attempts: 1, lastErrorCode: "OUTSIDE_SENDING_WINDOW" });
  });

  test("restores a proven pre-send outreach action together with its dead job", async () => {
    await service.requeue({ workspaceId, actorUserId: ownerId, jobId: dispatchJobId });
    const [storedJob] = await database.db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, dispatchJobId)));
    const [storedAction] = await database.db.select().from(outreachActions).where(and(eq(outreachActions.workspaceId, workspaceId), eq(outreachActions.id, outreachActionId)));
    expect(storedJob).toMatchObject({ status: "pending", attempts: 0, lastErrorCode: null });
    expect(storedAction).toMatchObject({ status: "scheduled", lastErrorCode: null, lastErrorMessage: null });
    expect(storedAction?.dueAt).toEqual(now);
  });

  test("restarts a failed channel assessment together with its dead job", async () => {
    await service.requeue({ workspaceId, actorUserId: ownerId, jobId: assessmentJobId });
    const [storedJob] = await database.db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, assessmentJobId)));
    const [storedAssessment] = await database.db.select().from(channelAssessments).where(and(eq(channelAssessments.workspaceId, workspaceId), eq(channelAssessments.id, assessmentId)));
    const [storedPlan] = await database.db.select().from(prospectingPlans).where(and(eq(prospectingPlans.workspaceId, workspaceId), eq(prospectingPlans.id, planId)));
    expect(storedJob).toMatchObject({ status: "pending", attempts: 0, lastErrorCode: null });
    expect(storedAssessment).toMatchObject({ status: "pending", errorCode: null, errorMessage: null, completedAt: null });
    expect(storedPlan).toMatchObject({ status: "assessing" });
  });
});
