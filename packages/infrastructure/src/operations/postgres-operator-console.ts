import { and, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import { consoleJobRecoveryDisposition, sanitizeOperationalPayload } from "@outbound/domain/operations/operator-console";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  campaignEnrollments,
  campaigns,
  channelAssessments,
  integrationEvents,
  jobs,
  outreachActions,
  outreachAttempts,
  outboxEvents,
  prospectingPlans,
} from "@outbound/infrastructure/database/schema";

export type ConsoleJobStatus = "pending" | "running" | "retry" | "completed" | "dead_lettered";

export interface ConsoleJobView {
  readonly id: string;
  readonly type: string;
  readonly status: ConsoleJobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly correlationId: string;
  readonly payloadPreview: unknown;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly availableAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class OperatorConsoleError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export class PostgresOperatorConsole {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async listJobs(input: { workspaceId: string; statuses?: readonly ConsoleJobStatus[]; type?: string; from?: Date; to?: Date; limit: number }): Promise<readonly ConsoleJobView[]> {
    const conditions = [eq(jobs.workspaceId, input.workspaceId)];
    if (input.statuses?.length) conditions.push(inArray(jobs.status, [...input.statuses]));
    if (input.type) conditions.push(eq(jobs.type, input.type));
    if (input.from) conditions.push(gte(jobs.createdAt, input.from));
    if (input.to) conditions.push(lte(jobs.createdAt, input.to));
    const rows = await this.database.select().from(jobs).where(and(...conditions)).orderBy(desc(jobs.updatedAt)).limit(input.limit);
    return rows.map(jobView);
  }

  listDeadLetters(input: { workspaceId: string; type?: string; from?: Date; to?: Date; limit: number }) {
    return this.listJobs({ ...input, statuses: ["dead_lettered"] });
  }

  async listRejectedWebhooks(input: { workspaceId: string; from?: Date; to?: Date; limit: number }) {
    const conditions = [eq(integrationEvents.workspaceId, input.workspaceId), eq(integrationEvents.status, "rejected")];
    if (input.from) conditions.push(gte(integrationEvents.receivedAt, input.from));
    if (input.to) conditions.push(lte(integrationEvents.receivedAt, input.to));
    const rows = await this.database.select().from(integrationEvents).where(and(...conditions)).orderBy(desc(integrationEvents.receivedAt)).limit(input.limit);
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      providerEventId: row.providerEventId,
      eventType: row.eventType,
      reasonCode: row.errorCode,
      reason: row.errorMessage,
      payloadPreview: sanitizeOperationalPayload(row.payload),
      receivedAt: row.receivedAt,
    }));
  }

  async traceCorrelation(input: { workspaceId: string; correlationId: string }) {
    const jobRows = await this.database.select().from(jobs).where(and(eq(jobs.workspaceId, input.workspaceId), eq(jobs.correlationId, input.correlationId))).orderBy(desc(jobs.createdAt)).limit(100);
    const jobIds = jobRows.map((job) => job.id);
    const [eventRows, auditRows] = await Promise.all([
      this.database.select().from(outboxEvents).where(and(
        eq(outboxEvents.workspaceId, input.workspaceId),
        or(
          sql`${outboxEvents.payload} ->> 'correlationId' = ${input.correlationId}`,
          ...(jobIds.length ? [inArray(outboxEvents.aggregateId, jobIds)] : []),
        ),
      )).orderBy(desc(outboxEvents.createdAt)).limit(100),
      this.database.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, input.workspaceId), eq(auditLogs.correlationId, input.correlationId))).orderBy(desc(auditLogs.createdAt)).limit(100),
    ]);
    return {
      correlationId: input.correlationId,
      jobs: jobRows.map(jobView),
      events: eventRows.map((event) => ({ id: event.id, aggregateType: event.aggregateType, aggregateId: event.aggregateId, eventType: event.eventType, payloadPreview: sanitizeOperationalPayload(event.payload), attempts: event.attempts, publishedAt: event.publishedAt, createdAt: event.createdAt })),
      audit: auditRows.map((entry) => ({ id: entry.id, actorUserId: entry.actorUserId, action: entry.action, subjectType: entry.subjectType, subjectId: entry.subjectId, changes: sanitizeOperationalPayload(entry.changes), createdAt: entry.createdAt })),
    };
  }

  async requeue(input: { workspaceId: string; actorUserId: string; jobId: string }) {
    const now = this.clock.now();
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(jobs).where(and(eq(jobs.workspaceId, input.workspaceId), eq(jobs.id, input.jobId))).limit(1).for("update");
      if (!existing) throw new OperatorConsoleError("CONSOLE_JOB_NOT_FOUND", 404);
      const recovery = consoleJobRecoveryDisposition(existing);
      if (recovery === "automatic") {
        throw new OperatorConsoleError("CONSOLE_JOB_RETRY_SCHEDULED", 409);
      }
      if (recovery === "blocked") {
        throw new OperatorConsoleError("CONSOLE_JOB_MANUAL_RECOVERY_BLOCKED", 409);
      }
      if (recovery !== "manual") {
        throw new OperatorConsoleError(existing.status === "completed" ? "CONSOLE_JOB_COMPLETED" : "CONSOLE_JOB_ALREADY_QUEUED", 409);
      }
      await restoreAssociatedState(tx, existing, now);
      const [requeued] = await tx.update(jobs).set({
        status: "pending",
        attempts: 0,
        availableAt: now,
        lockedAt: null,
        lockedUntil: null,
        lockedBy: null,
        completedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: now,
      }).where(and(
        eq(jobs.workspaceId, input.workspaceId),
        eq(jobs.id, input.jobId),
        eq(jobs.status, existing.status),
      )).returning();
      if (!requeued) throw new OperatorConsoleError("CONSOLE_JOB_ALREADY_QUEUED", 409);
      const eventId = this.ids.generate();
      const payload = { jobId: requeued.id, jobType: requeued.type, previousStatus: existing.status, previousErrorCode: existing.lastErrorCode, correlationId: requeued.correlationId };
      await tx.insert(outboxEvents).values({ id: eventId, workspaceId: input.workspaceId, aggregateType: "job", aggregateId: requeued.id, eventType: "JobRequeued", payload, availableAt: now, createdAt: now });
      await tx.insert(auditLogs).values({ id: this.ids.generate(), workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "JobRequeued", subjectType: "job", subjectId: requeued.id, changes: payload, correlationId: requeued.correlationId, sourceEventId: eventId, createdAt: now });
      return { ...jobView(requeued), requeued: true as const };
    });
  }
}

async function restoreAssociatedState(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  job: typeof jobs.$inferSelect,
  now: Date,
): Promise<void> {
  if (job.type === "outreach.dispatch") {
    await restorePreSendOutreachAction(tx, job, now);
    return;
  }
  if (job.type === "prospecting.channel.assess") {
    await restoreChannelAssessment(tx, job, now);
  }
}

async function restorePreSendOutreachAction(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  job: typeof jobs.$inferSelect,
  now: Date,
): Promise<void> {
  const actionId = payloadUuid(job.payload, "actionId");
  if (!actionId || job.lastErrorCode !== "CAMPAIGN_JIT_GENERATION_FAILED") {
    throw new OperatorConsoleError("CONSOLE_JOB_MANUAL_RECOVERY_BLOCKED", 409);
  }
  const [action] = await tx.select({
    id: outreachActions.id,
    campaignId: outreachActions.campaignId,
    enrollmentId: outreachActions.enrollmentId,
    contactId: outreachActions.contactId,
    status: outreachActions.status,
    lastErrorCode: outreachActions.lastErrorCode,
  }).from(outreachActions).where(and(
    eq(outreachActions.workspaceId, job.workspaceId),
    eq(outreachActions.id, actionId),
  )).limit(1).for("update");
  if (!action || action.status !== "failed" || action.lastErrorCode !== "CAMPAIGN_JIT_GENERATION_FAILED") {
    throw new OperatorConsoleError("CONSOLE_JOB_RECOVERY_STATE_MISMATCH", 409);
  }
  const [[attempt], [campaign], [competingEnrollment]] = await Promise.all([
    tx.select({ id: outreachAttempts.id }).from(outreachAttempts).where(and(
      eq(outreachAttempts.workspaceId, job.workspaceId),
      or(eq(outreachAttempts.actionId, action.id), eq(outreachAttempts.outreachActionId, action.id)),
    )).limit(1),
    tx.select({ status: campaigns.status }).from(campaigns).where(and(
      eq(campaigns.workspaceId, job.workspaceId),
      eq(campaigns.id, action.campaignId),
    )).limit(1),
    tx.select({ id: campaignEnrollments.id }).from(campaignEnrollments).where(and(
      eq(campaignEnrollments.workspaceId, job.workspaceId),
      eq(campaignEnrollments.contactId, action.contactId),
      ne(campaignEnrollments.id, action.enrollmentId),
      eq(campaignEnrollments.status, "active"),
    )).limit(1),
  ]);
  if (attempt || campaign?.status !== "active" || competingEnrollment) {
    throw new OperatorConsoleError("CONSOLE_JOB_MANUAL_RECOVERY_BLOCKED", 409);
  }
  const [restored] = await tx.update(outreachActions).set({
    status: "scheduled",
    dueAt: now,
    lockedAt: null,
    lockedUntil: null,
    lockedBy: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    updatedAt: now,
  }).where(and(
    eq(outreachActions.workspaceId, job.workspaceId),
    eq(outreachActions.id, action.id),
    eq(outreachActions.status, "failed"),
    eq(outreachActions.lastErrorCode, "CAMPAIGN_JIT_GENERATION_FAILED"),
  )).returning({ id: outreachActions.id });
  if (!restored) throw new OperatorConsoleError("CONSOLE_JOB_RECOVERY_STATE_MISMATCH", 409);
  await tx.update(campaignEnrollments).set({
    status: "active",
    completedAt: null,
  }).where(and(
    eq(campaignEnrollments.workspaceId, job.workspaceId),
    eq(campaignEnrollments.id, action.enrollmentId),
  ));
  await tx.update(campaigns).set({
    automationStage: "sending",
    automationErrorCode: null,
    automationErrorMessage: null,
    updatedAt: now,
  }).where(and(
    eq(campaigns.workspaceId, job.workspaceId),
    eq(campaigns.id, action.campaignId),
    eq(campaigns.status, "active"),
  ));
}

async function restoreChannelAssessment(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  job: typeof jobs.$inferSelect,
  now: Date,
): Promise<void> {
  const assessmentId = payloadUuid(job.payload, "assessmentId");
  if (!assessmentId) throw new OperatorConsoleError("CONSOLE_JOB_RECOVERY_STATE_MISMATCH", 409);
  const [assessment] = await tx.select({
    id: channelAssessments.id,
    planId: channelAssessments.planId,
    status: channelAssessments.status,
  }).from(channelAssessments).where(and(
    eq(channelAssessments.workspaceId, job.workspaceId),
    eq(channelAssessments.id, assessmentId),
  )).limit(1).for("update");
  if (!assessment || assessment.status !== "failed") {
    throw new OperatorConsoleError("CONSOLE_JOB_RECOVERY_STATE_MISMATCH", 409);
  }
  await tx.update(channelAssessments).set({
    status: "pending",
    recommendation: null,
    score: null,
    strategy: {},
    metrics: {},
    evidence: [],
    rationale: null,
    sampleSize: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  }).where(and(
    eq(channelAssessments.workspaceId, job.workspaceId),
    eq(channelAssessments.id, assessment.id),
    eq(channelAssessments.status, "failed"),
  ));
  await tx.update(prospectingPlans).set({ status: "assessing", updatedAt: now }).where(and(
    eq(prospectingPlans.workspaceId, job.workspaceId),
    eq(prospectingPlans.id, assessment.planId),
  ));
}

function payloadUuid(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

function jobView(row: typeof jobs.$inferSelect): ConsoleJobView {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    correlationId: row.correlationId,
    payloadPreview: sanitizeOperationalPayload(row.payload),
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage ? String(sanitizeOperationalPayload(row.lastErrorMessage, 500)) : null,
    availableAt: row.availableAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
