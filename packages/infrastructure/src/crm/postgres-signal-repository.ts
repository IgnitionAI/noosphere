import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { SignalSource, SignalSourceObservation } from "@outbound/application/crm/signal-source";
import type { Clock } from "@outbound/application/shared/ports";
import {
  assertSignal,
  confidenceRank,
  type SignalConfidence,
  type SignalEntityType,
  type SignalType,
} from "@outbound/domain/crm/intent-signal";
import type { Database } from "@outbound/infrastructure/database/client";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import {
  auditLogs,
  companies,
  contactSuppressions,
  contacts,
  outboxEvents,
  signalCollectionRuns,
  signals,
  workspaceSignalSettings,
} from "@outbound/infrastructure/database/schema";

export const SIGNAL_COLLECTION_JOB_TYPE = "crm.signals.collect";
export type SignalCollectionPayload = { readonly workspaceId: string; readonly runId: string; readonly signalTypes?: readonly SignalType[] };

export class PostgresSignalRepository {
  constructor(private readonly db: Database, private readonly clock: Clock = { now: () => new Date() }) {}

  async requestCollection(input: {
    id: string; workspaceId: string; companyId?: string; contactId?: string;
    requestKey: string; source: string; requestedBy: string; correlationId: string;
  }) {
    if ((input.companyId ? 1 : 0) + (input.contactId ? 1 : 0) !== 1) throw new Error("SIGNAL_TARGET_REQUIRED");
    if (input.companyId) {
      const [company] = await this.db.select({ id: companies.id }).from(companies)
        .where(and(eq(companies.id, input.companyId), eq(companies.workspaceId, input.workspaceId))).limit(1);
      if (!company) throw new Error("COMPANY_NOT_FOUND");
    } else {
      const [contact] = await this.db.select({ id: contacts.id }).from(contacts)
        .where(and(eq(contacts.id, input.contactId!), eq(contacts.workspaceId, input.workspaceId))).limit(1);
      if (!contact) throw new Error("CONTACT_NOT_FOUND");
    }
    const [created] = await this.db.transaction(async (tx) => {
      const [run] = await tx.insert(signalCollectionRuns).values({
        id: input.id, workspaceId: input.workspaceId, companyId: input.companyId ?? null,
        contactId: input.contactId ?? null, requestKey: input.requestKey, source: input.source,
        requestedBy: input.requestedBy,
      }).onConflictDoNothing({ target: [signalCollectionRuns.workspaceId, signalCollectionRuns.requestKey] }).returning();
      if (run) {
        const eventId = crypto.randomUUID();
        await tx.insert(outboxEvents).values({ id: eventId, workspaceId: input.workspaceId,
          aggregateType: "SignalCollectionRun", aggregateId: run.id, eventType: "SignalCollectionRequested",
          payload: { runId: run.id, companyId: run.companyId, contactId: run.contactId, requestKey: run.requestKey } });
        await tx.insert(auditLogs).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId,
          actorUserId: input.requestedBy, action: "signals.collection_requested", subjectType: "SignalCollectionRun",
          subjectId: run.id, changes: { requestKey: input.requestKey }, correlationId: input.correlationId, sourceEventId: eventId });
      }
      return [run];
    });
    if (created) return { run: created, created: true };
    const [existing] = await this.db.select().from(signalCollectionRuns).where(and(
      eq(signalCollectionRuns.workspaceId, input.workspaceId), eq(signalCollectionRuns.requestKey, input.requestKey),
    )).limit(1);
    if (!existing) throw new Error("SIGNAL_RUN_NOT_FOUND");
    return { run: existing, created: false };
  }

  async getRun(input: { workspaceId: string; runId: string }) {
    const [run] = await this.db.select().from(signalCollectionRuns).where(and(
      eq(signalCollectionRuns.workspaceId, input.workspaceId), eq(signalCollectionRuns.id, input.runId),
    )).limit(1);
    return run ?? null;
  }

  async getConfiguredSignalTypes(input: { workspaceId: string; fallback: readonly SignalType[] }): Promise<readonly SignalType[]> {
    const [settings] = await this.db.select({ signalTypes: workspaceSignalSettings.signalTypes }).from(workspaceSignalSettings)
      .where(eq(workspaceSignalSettings.workspaceId, input.workspaceId)).limit(1);
    if (!settings) return input.fallback;
    const allowed = new Set<SignalType>(input.fallback);
    return (Array.isArray(settings.signalTypes) ? settings.signalTypes : []).filter((type): type is SignalType => typeof type === "string" && allowed.has(type as SignalType));
  }

  async setConfiguredSignalTypes(input: { workspaceId: string; signalTypes: readonly SignalType[]; updatedBy: string }) {
    const [settings] = await this.db.insert(workspaceSignalSettings).values({ workspaceId: input.workspaceId, signalTypes: input.signalTypes, updatedBy: input.updatedBy })
      .onConflictDoUpdate({ target: workspaceSignalSettings.workspaceId, set: { signalTypes: input.signalTypes, updatedBy: input.updatedBy, updatedAt: this.clock.now() } }).returning();
    return settings;
  }

  async listSignals(input: {
    workspaceId: string; entityType?: SignalEntityType; entityId?: string; signalType?: SignalType;
    includeExpired?: boolean; now?: Date; limit?: number;
  }) {
    const now = input.now ?? this.clock.now();
    const filters = [eq(signals.workspaceId, input.workspaceId)];
    if (input.entityType) filters.push(eq(signals.entityType, input.entityType));
    if (input.entityId) filters.push(eq(signals.entityId, input.entityId));
    if (input.signalType) filters.push(eq(signals.signalType, input.signalType));
    if (!input.includeExpired) filters.push(gt(signals.expiresAt, now));
    return this.db.select().from(signals).where(and(...filters))
      .orderBy(desc(signals.observedAt)).limit(Math.min(input.limit ?? 100, 500));
  }

  async processRun(input: {
    workspaceId: string; runId: string; source: SignalSource; signalTypes: readonly SignalType[];
    correlationId?: string; queue?: JobQueue; job?: LeasedJob<SignalCollectionPayload>;
  }) {
    const run = await this.getRun(input);
    if (!run) throw new Error("SIGNAL_RUN_NOT_FOUND");
    if (run.status === "succeeded" || run.status === "partial") return run;
    const now = this.clock.now();
    const [started] = await this.db.update(signalCollectionRuns).set({ status: "running", startedAt: now, updatedAt: now })
      .where(and(eq(signalCollectionRuns.id, run.id), inArray(signalCollectionRuns.status, ["queued", "failed"]))).returning();
    if (!started) return (await this.getRun(input))!;
    try {
      if (started.contactId && await this.isSuppressed(input.workspaceId, started.contactId)) {
        return (await this.finishRun(started.id, "succeeded", null))!;
      }
      const observations = await input.source.collect({
        workspaceId: input.workspaceId, entityType: started.companyId ? "company" : "contact",
        entityId: started.companyId ?? started.contactId!, companyId: started.companyId, contactId: started.contactId,
        signalTypes: input.signalTypes.filter((type) => input.source.supportedTypes.includes(type)),
        correlationId: input.correlationId ?? crypto.randomUUID(), requestKey: started.requestKey,
      });
      for (const observation of observations) await this.persistObservation(input.workspaceId, started, observation);
      return (await this.finishRun(started.id, "succeeded", null))!;
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return (await this.finishRun(started.id, "failed", code))!;
    } finally {
      if (input.job && input.queue) await input.queue.acknowledge(input.job.id, input.job.lockedBy, this.clock.now());
    }
  }

  private async persistObservation(workspaceId: string, run: typeof signalCollectionRuns.$inferSelect, observation: SignalSourceObservation) {
    assertSignal(observation);
    const existing = await this.db.transaction(async (tx) => {
      const [inserted] = await tx.insert(signals).values({
        id: crypto.randomUUID(), workspaceId, signalType: observation.signalType, entityType: observation.entityType,
        entityId: observation.entityId, companyId: observation.companyId, contactId: observation.contactId,
        source: observation.source, sources: [observation.source], providerEventId: observation.providerEventId ?? null,
        evidenceUrl: observation.evidenceUrl, evidenceSnippet: observation.evidenceSnippet ?? null,
        observedAt: observation.observedAt, expiresAt: observation.expiresAt, confidence: observation.confidence,
        deduplicationKey: observation.deduplicationKey, legalBasis: observation.legalBasis,
        sourceAuthorized: observation.sourceAuthorized,
      }).onConflictDoNothing({ target: [signals.workspaceId, signals.deduplicationKey] }).returning();
      if (inserted) {
        const eventTypes = inserted.signalType === "job_change" ? ["SignalObserved", "EmploymentChanged"] : ["SignalObserved"];
        for (const eventType of eventTypes) {
          const eventId = crypto.randomUUID();
          await tx.insert(outboxEvents).values({ id: eventId, workspaceId, aggregateType: "Signal", aggregateId: inserted.id,
            eventType, payload: { signalId: inserted.id, signalType: inserted.signalType, entityType: inserted.entityType,
              entityId: inserted.entityId, companyId: inserted.companyId, contactId: inserted.contactId } });
          await tx.insert(auditLogs).values({ id: crypto.randomUUID(), workspaceId, actorUserId: run.requestedBy,
            action: "signals.observed", subjectType: "Signal", subjectId: inserted.id,
            changes: { signalType: inserted.signalType, source: inserted.source, eventType }, sourceEventId: eventId });
        }
        return inserted;
      }
      return null;
    });
    if (!existing) {
      const [row] = await this.db.select({ id: signals.id, sources: signals.sources, confidence: signals.confidence })
        .from(signals).where(and(eq(signals.workspaceId, workspaceId), eq(signals.deduplicationKey, observation.deduplicationKey))).limit(1);
      if (!row) return;
      const sources = Array.isArray(row.sources) ? row.sources.filter((source): source is string => typeof source === "string") : [];
      if (!sources.includes(observation.source)) sources.push(observation.source);
      const stronger = confidenceRank(observation.confidence) > confidenceRank(row.confidence as SignalConfidence);
      await this.db.update(signals).set({ sources, ...(stronger ? { confidence: observation.confidence } : {}), updatedAt: this.clock.now() }).where(eq(signals.id, row.id));
    }
  }

  private async isSuppressed(workspaceId: string, contactId: string): Promise<boolean> {
    const [contact] = await this.db.select({ status: contacts.status }).from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId))).limit(1);
    if (!contact) throw new Error("CONTACT_NOT_FOUND");
    if (contact.status === "suppressed") return true;
    const [suppression] = await this.db.select({ id: contactSuppressions.id }).from(contactSuppressions)
      .where(and(eq(contactSuppressions.workspaceId, workspaceId), eq(contactSuppressions.contactId, contactId), isNull(contactSuppressions.liftedAt))).limit(1);
    return Boolean(suppression);
  }

  private async finishRun(runId: string, status: "succeeded" | "failed", error: string | null) {
    const [run] = await this.db.update(signalCollectionRuns).set({ status, errorCode: error, errorMessage: error,
      completedAt: this.clock.now(), updatedAt: this.clock.now() }).where(eq(signalCollectionRuns.id, runId)).returning();
    return run ?? null;
  }
}

export class SignalCollectionJobProcessor {
  constructor(private readonly repository: PostgresSignalRepository, private readonly source: SignalSource, private readonly queue: JobQueue) {}
  async process(job: LeasedJob): Promise<void> {
    const payload = job.payload as SignalCollectionPayload;
    await this.repository.processRun({ workspaceId: job.workspaceId, runId: payload.runId, source: this.source, signalTypes: payload.signalTypes ?? this.source.supportedTypes, queue: this.queue, job: job as LeasedJob<SignalCollectionPayload> });
  }
}
