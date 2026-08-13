import { and, eq, inArray, sql } from "drizzle-orm";
import {
  PROSPECT_DECISION_JOB_TYPE,
  type ScheduleProspectDecisionInput,
} from "@outbound/application/campaigns/prospect-decision";
import type { Clock } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  contacts,
  jobs,
  outboxEvents,
  prospectDecisions,
} from "@outbound/infrastructure/database/schema";

export class ProspectDecisionSchedulerError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class PostgresProspectDecisionScheduler {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  async schedule(input: ScheduleProspectDecisionInput) {
    if (!input.reason.trim()) throw new ProspectDecisionSchedulerError("PROSPECT_DECISION_REASON_REQUIRED");
    if (!input.kind.trim()) throw new ProspectDecisionSchedulerError("PROSPECT_DECISION_KIND_REQUIRED");
    if (Number.isNaN(input.dueAt.getTime())) throw new ProspectDecisionSchedulerError("PROSPECT_DECISION_DUE_AT_INVALID");
    const priority = Math.max(-100, Math.min(100, Math.trunc(input.priority ?? 0)));
    const maxAttempts = Math.max(1, Math.min(20, Math.trunc(input.maxAttempts ?? 5)));

    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.idempotencyKey}`}, 0))`);
      const [contact] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, input.contactId)))
        .limit(1);
      if (!contact) throw new ProspectDecisionSchedulerError("PROSPECT_DECISION_CONTACT_NOT_FOUND");

      const [existing] = await tx
        .select()
        .from(prospectDecisions)
        .where(and(
          eq(prospectDecisions.workspaceId, input.workspaceId),
          eq(prospectDecisions.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (existing) {
        if (existing.status === "pending") {
          const now = this.clock.now();
          const [decision] = await tx
            .update(prospectDecisions)
            .set({
              reason: input.reason.trim(),
              dueAt: input.dueAt,
              priority,
              payload: input.payload ?? {},
              correlationId: input.correlationId,
              updatedAt: now,
            })
            .where(and(eq(prospectDecisions.workspaceId, input.workspaceId), eq(prospectDecisions.id, existing.id)))
            .returning();
          await tx
            .update(jobs)
            .set({
              availableAt: input.dueAt,
              correlationId: input.correlationId,
              payload: { workspaceId: input.workspaceId, decisionId: existing.id },
              priority,
              maxAttempts,
              updatedAt: now,
            })
            .where(and(
              eq(jobs.workspaceId, input.workspaceId),
              eq(jobs.id, existing.jobId),
              inArray(jobs.status, ["pending", "retry"]),
            ));
          return { created: false as const, decision: decision ?? existing };
        }
        return { created: false as const, decision: existing };
      }

      const jobId = crypto.randomUUID();
      const now = this.clock.now();
      await tx.insert(jobs).values({
        id: jobId,
        workspaceId: input.workspaceId,
        type: PROSPECT_DECISION_JOB_TYPE,
        payload: { workspaceId: input.workspaceId, decisionId: input.id },
        idempotencyKey: `${input.idempotencyKey}:execute`,
        correlationId: input.correlationId,
        maxAttempts,
        priority,
        availableAt: input.dueAt,
        createdAt: now,
        updatedAt: now,
      });
      const [decision] = await tx.insert(prospectDecisions).values({
        id: input.id,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        campaignId: input.campaignId ?? null,
        outreachActionId: input.outreachActionId ?? null,
        jobId,
        kind: input.kind.trim(),
        reason: input.reason.trim(),
        dueAt: input.dueAt,
        priority,
        maxAttempts,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        payload: input.payload ?? {},
        createdAt: now,
        updatedAt: now,
      }).returning();
      if (!decision) throw new ProspectDecisionSchedulerError("PROSPECT_DECISION_CREATE_FAILED");
      await tx.insert(outboxEvents).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        aggregateType: "ProspectDecision",
        aggregateId: decision.id,
        eventType: "ProspectDecisionScheduled",
        payload: {
          decisionId: decision.id,
          contactId: input.contactId,
          campaignId: input.campaignId ?? null,
          kind: input.kind,
          reason: input.reason,
          dueAt: input.dueAt.toISOString(),
          correlationId: input.correlationId,
        },
        availableAt: now,
        createdAt: now,
      });
      return { created: true as const, decision };
    });
  }

  async get(input: { workspaceId: string; decisionId: string }) {
    const [decision] = await this.database
      .select()
      .from(prospectDecisions)
      .where(and(eq(prospectDecisions.workspaceId, input.workspaceId), eq(prospectDecisions.id, input.decisionId)))
      .limit(1);
    return decision ?? null;
  }
}
