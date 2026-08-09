import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import { sanitizeOperationalPayload } from "@outbound/domain/operations/operator-console";
import type { Database } from "@outbound/infrastructure/database/client";
import { auditLogs, integrationEvents, jobs, outboxEvents } from "@outbound/infrastructure/database/schema";

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
      if (existing.status !== "retry" && existing.status !== "dead_lettered") {
        throw new OperatorConsoleError(existing.status === "completed" ? "CONSOLE_JOB_COMPLETED" : "CONSOLE_JOB_ALREADY_QUEUED", 409);
      }
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
