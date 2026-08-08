import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { ProspectEnricher, ProspectEnrichmentResult } from "@outbound/application/crm/prospect-enrichment-ports";
import type { EmailVerifier } from "@outbound/application/crm/email-verification-ports";
import type { Clock } from "@outbound/application/shared/ports";
import { assertEnrichmentObservation, canReplaceObservation, type EnrichmentObservationStatus } from "@outbound/domain/crm/enrichment-observation";
import { normalizeEmail, normalizePhone, normalizeLinkedinUrl } from "@outbound/domain/crm/normalization";
import type { Database } from "@outbound/infrastructure/database/client";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import {
  auditLogs,
  companies,
  contactEmployments,
  contactIdentities,
  contactSuppressions,
  contacts,
  enrichmentJobs,
  enrichmentObservations,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

export const ENRICHMENT_JOB_TYPE = "crm.enrichment.execute";

type EnrichmentJobPayload = {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly contactId: string;
};

export class PostgresEnrichmentRepository {
  constructor(private readonly db: Database, private readonly clock: Clock = { now: () => new Date() }) {}

  async request(input: {
    id: string;
    workspaceId: string;
    contactId: string;
    requestKey: string;
    correlationId: string;
    requestedBy: string;
    provider?: string;
  }) {
    const contact = await this.contactContext(input.workspaceId, input.contactId);
    if (!contact) throw new Error("CONTACT_NOT_FOUND");
    if (!contact.companyName) throw new Error("ENRICHMENT_IDENTITY_REQUIRED");
    const [created] = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(enrichmentJobs)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          entityType: "contact",
          entityId: input.contactId,
          requestKey: input.requestKey,
          correlationId: input.correlationId,
          requestedBy: input.requestedBy,
          provider: input.provider ?? "crawler",
        })
        .onConflictDoNothing({ target: [enrichmentJobs.workspaceId, enrichmentJobs.requestKey] })
        .returning();
      if (inserted) {
        const eventId = crypto.randomUUID();
        await tx.insert(outboxEvents).values({
          id: eventId, workspaceId: input.workspaceId, aggregateType: "EnrichmentJob", aggregateId: inserted.id,
          eventType: "EnrichmentJobRequested", payload: { jobId: inserted.id, contactId: input.contactId, requestKey: input.requestKey },
        });
        await tx.insert(auditLogs).values({
          id: crypto.randomUUID(), workspaceId: input.workspaceId, actorUserId: input.requestedBy,
          action: "enrichment.requested", subjectType: "Contact", subjectId: input.contactId,
          changes: { jobId: inserted.id, requestKey: input.requestKey }, correlationId: input.correlationId, sourceEventId: eventId,
        });
      }
      return [inserted];
    });
    if (created) return { job: created, created: true };
    const [existing] = await this.db
      .select()
      .from(enrichmentJobs)
      .where(and(eq(enrichmentJobs.workspaceId, input.workspaceId), eq(enrichmentJobs.requestKey, input.requestKey)))
      .limit(1);
    if (!existing) throw new Error("ENRICHMENT_JOB_NOT_FOUND");
    return { job: existing, created: false };
  }

  async getJob(input: { workspaceId: string; jobId: string }) {
    const [job] = await this.db
      .select()
      .from(enrichmentJobs)
      .where(and(eq(enrichmentJobs.workspaceId, input.workspaceId), eq(enrichmentJobs.id, input.jobId)))
      .limit(1);
    return job ?? null;
  }

  async retryJob(input: { workspaceId: string; jobId: string }) {
    const [job] = await this.db
      .update(enrichmentJobs)
      .set({ status: "queued", errorCode: null, errorMessage: null, completedAt: null, updatedAt: this.clock.now() })
      .where(and(eq(enrichmentJobs.workspaceId, input.workspaceId), eq(enrichmentJobs.id, input.jobId), eq(enrichmentJobs.status, "failed")))
      .returning();
    return job ?? this.getJob(input);
  }

  async listObservations(input: { workspaceId: string; contactId: string }) {
    return this.db
      .select()
      .from(enrichmentObservations)
      .where(and(
        eq(enrichmentObservations.workspaceId, input.workspaceId),
        eq(enrichmentObservations.entityType, "contact"),
        eq(enrichmentObservations.entityId, input.contactId),
      ))
      .orderBy(asc(enrichmentObservations.field), desc(enrichmentObservations.observedAt));
  }

  async coverage(input: { workspaceId: string }) {
    return this.db
      .select({
        source: enrichmentObservations.source,
        status: enrichmentObservations.status,
        count: sql<number>`count(*)::int`,
      })
      .from(enrichmentObservations)
      .where(eq(enrichmentObservations.workspaceId, input.workspaceId))
      .groupBy(enrichmentObservations.source, enrichmentObservations.status)
      .orderBy(asc(enrichmentObservations.source), asc(enrichmentObservations.status));
  }

  async processJob(input: {
    job: LeasedJob<EnrichmentJobPayload> | { id: string; workspaceId: string; jobId: string; contactId: string; lockedBy?: string };
    enricher: ProspectEnricher;
    verifier?: EmailVerifier;
    queue?: JobQueue;
  }): Promise<void> {
    const jobId = input.job.id;
    const workspaceId = input.job.workspaceId;
    const payload = "jobId" in input.job ? input.job : input.job.payload;
    const now = this.clock.now();
    const [job] = await this.db
      .update(enrichmentJobs)
      .set({ status: "running", attempts: sql`${enrichmentJobs.attempts} + 1`, startedAt: now, updatedAt: now })
      .where(and(eq(enrichmentJobs.workspaceId, workspaceId), eq(enrichmentJobs.id, payload.jobId)))
      .returning();
    if (!job) throw new Error("ENRICHMENT_JOB_NOT_FOUND");
    try {
      const contact = await this.contactContext(workspaceId, payload.contactId);
      if (!contact) throw new Error("CONTACT_NOT_FOUND");
      const channels = await this.currentChannels(workspaceId, payload.contactId);
      const result = await this.enricherResult(input.enricher, contact, channels, job.requestKey, job.correlationId);
      const verifiedFields = await this.persistResult({ workspaceId, contactId: payload.contactId, job, result });
      await this.db.transaction(async (tx) => {
        const completedAt = this.clock.now();
        await tx.update(enrichmentJobs).set({ status: "succeeded", completedAt, updatedAt: completedAt, errorCode: null, errorMessage: null }).where(eq(enrichmentJobs.id, job.id));
        const eventId = crypto.randomUUID();
        await tx.insert(outboxEvents).values({
          id: eventId,
          workspaceId,
          aggregateType: "EnrichmentJob",
          aggregateId: job.id,
          eventType: "EnrichmentJobCompleted",
          payload: { jobId: job.id, contactId: payload.contactId },
        });
        for (const field of verifiedFields) {
          await tx.insert(outboxEvents).values({
            id: crypto.randomUUID(), workspaceId, aggregateType: "Contact", aggregateId: payload.contactId,
            eventType: "ContactIdentityVerified", payload: { contactId: payload.contactId, field, jobId: job.id },
          });
        }
        await tx.insert(auditLogs).values({
          id: crypto.randomUUID(),
          workspaceId,
          actorUserId: job.requestedBy,
          action: "enrichment.completed",
          subjectType: "Contact",
          subjectId: payload.contactId,
          changes: { jobId: job.id },
          correlationId: job.correlationId,
          sourceEventId: eventId,
        });
      });
      if ("lockedBy" in input.job && input.queue) await input.queue.acknowledge(jobId, input.job.lockedBy, this.clock.now());
    } catch (error) {
      const failedAt = this.clock.now();
      await this.db.update(enrichmentJobs).set({ status: "failed", errorCode: errorCode(error), errorMessage: errorMessage(error), completedAt: failedAt, updatedAt: failedAt }).where(eq(enrichmentJobs.id, job.id));
      if ("lockedBy" in input.job && input.queue) {
        await input.queue.retry({ jobId, workerId: input.job.lockedBy, availableAt: new Date(failedAt.getTime() + 30_000), errorCode: errorCode(error), errorMessage: errorMessage(error) });
      }
      if (!("lockedBy" in input.job)) throw error;
    }
  }

  private async enricherResult(
    enricher: ProspectEnricher,
    contact: ContactContext,
    channels: Awaited<ReturnType<PostgresEnrichmentRepository["currentChannels"]>>,
    requestKey: string,
    correlationId: string,
  ): Promise<ProspectEnrichmentResult> {
    return enricher.enrich({
      fullName: `${contact.firstName} ${contact.lastName}`,
      companyName: contact.companyName ?? "",
      location: contact.companyLocation,
      linkedinUrl: channels.linkedin.value,
      channels,
      correlationId,
      requestKey,
    });
  }

  private async persistResult(input: {
    workspaceId: string;
    contactId: string;
    job: typeof enrichmentJobs.$inferSelect;
    result: ProspectEnrichmentResult;
    verifier?: EmailVerifier;
  }): Promise<readonly string[]> {
    const suppressions = await this.db.select({ channel: contactSuppressions.channel, identityType: contactSuppressions.identityType })
      .from(contactSuppressions)
      .where(and(eq(contactSuppressions.workspaceId, input.workspaceId), eq(contactSuppressions.contactId, input.contactId), isNull(contactSuppressions.liftedAt)));
    const blocked = (field: string) => suppressions.some((item) => item.channel === "global" || item.channel === field || item.identityType === field);
    const observations: Array<{
      field: string;
      value: string;
      normalizedValue: string;
      status: EnrichmentObservationStatus;
      confidence: string;
      source: string;
      evidenceUrl: string | null;
      evidenceSnippet: string | null;
      phoneKind: "public_company" | "personal" | null;
    }> = [];
    const evidenceByKind = new Map(input.result.evidence.map((evidence) => [evidence.kind, evidence]));
    if (input.result.companyWebsite && !blocked("company")) observations.push({ field: "company.website", value: input.result.companyWebsite, normalizedValue: input.result.companyWebsite.toLowerCase(), status: "found", confidence: "medium", source: "crawler", evidenceUrl: evidenceByKind.get("company_website")?.url ?? null, evidenceSnippet: evidenceByKind.get("company_website")?.snippet ?? null, phoneKind: null });
    if (input.result.companyDomain && !blocked("company")) observations.push({ field: "company.domain", value: input.result.companyDomain, normalizedValue: input.result.companyDomain.toLowerCase(), status: "found", confidence: "medium", source: "crawler", evidenceUrl: evidenceByKind.get("company_website")?.url ?? null, evidenceSnippet: evidenceByKind.get("company_website")?.snippet ?? null, phoneKind: null });
    const email = input.result.channels.email;
    if (email.value && !blocked("email")) {
      const verified = input.verifier && (email.status === "found" || email.status === "unverified")
        ? await input.verifier.verify({ email: email.value, workspaceId: input.workspaceId, correlationId: input.job.correlationId })
        : null;
      observations.push({ field: "email", value: email.value, normalizedValue: normalizeEmail(email.value), status: verified?.status ?? mapStatus(email.status), confidence: verified?.confidence ?? email.confidence, source: verified?.source ?? email.source ?? "crawler", evidenceUrl: verified?.evidenceUrl ?? email.evidenceUrl ?? null, evidenceSnippet: verified?.evidenceSnippet ?? email.evidenceSnippet ?? null, phoneKind: null });
    }
    const phone = input.result.channels.whatsapp;
    if (phone.value && phone.phoneKind && !blocked("phone")) observations.push({ field: "phone", value: phone.value, normalizedValue: normalizePhone(phone.value), status: mapStatus(phone.status), confidence: phone.confidence, source: phone.source ?? "crawler", evidenceUrl: phone.evidenceUrl ?? null, evidenceSnippet: phone.evidenceSnippet ?? null, phoneKind: phone.phoneKind });
    const linkedin = input.result.channels.linkedin;
    if (linkedin.value && !blocked("linkedin")) observations.push({ field: "linkedin", value: linkedin.value, normalizedValue: normalizeLinkedinUrl(linkedin.value), status: mapStatus(linkedin.status), confidence: linkedin.confidence, source: linkedin.source ?? "crawler", evidenceUrl: linkedin.evidenceUrl ?? null, evidenceSnippet: linkedin.evidenceSnippet ?? null, phoneKind: null });
    if (observations.length === 0) return [];
    const verifiedFields: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const observation of observations) {
        assertEnrichmentObservation({ field: observation.field, status: observation.status, phoneKind: observation.phoneKind });
        const [existing] = await tx.select({ id: enrichmentObservations.id, status: enrichmentObservations.status, observedAt: enrichmentObservations.observedAt }).from(enrichmentObservations).where(and(
          eq(enrichmentObservations.workspaceId, input.workspaceId),
          eq(enrichmentObservations.entityId, input.contactId),
          eq(enrichmentObservations.field, observation.field),
          eq(enrichmentObservations.normalizedValue, observation.normalizedValue),
        )).limit(1);
        if (existing) {
          const observedAt = this.clock.now();
          if (canReplaceObservation(existing as { status: EnrichmentObservationStatus; observedAt: Date }, { status: observation.status, observedAt })) {
            await tx.update(enrichmentObservations).set({
              status: observation.status, confidence: observation.confidence, source: observation.source,
              provider: input.job.provider, evidenceUrl: observation.evidenceUrl, evidenceSnippet: observation.evidenceSnippet,
              phoneKind: observation.phoneKind, observedAt,
            }).where(eq(enrichmentObservations.id, existing.id));
            if (observation.status === "verified") verifiedFields.push(observation.field);
          }
          continue;
        }
        await tx.insert(enrichmentObservations).values({
          id: crypto.randomUUID(), workspaceId: input.workspaceId, jobId: input.job.id,
          entityType: "contact", entityId: input.contactId, contactId: input.contactId,
          field: observation.field, value: observation.value, normalizedValue: observation.normalizedValue,
          status: observation.status, confidence: observation.confidence, source: observation.source,
          provider: input.job.provider, evidenceUrl: observation.evidenceUrl, evidenceSnippet: observation.evidenceSnippet,
          phoneKind: observation.phoneKind, observedAt: this.clock.now(),
        }).onConflictDoNothing();
        if (observation.status === "verified") verifiedFields.push(observation.field);
      }
    });
    return verifiedFields;
  }

  private async contactContext(workspaceId: string, contactId: string): Promise<ContactContext | null> {
    const [contact] = await this.db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, status: contacts.status })
      .from(contacts).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId))).limit(1);
    if (!contact) return null;
    const [employment] = await this.db.select({ companyName: companies.name, location: companies.location })
      .from(contactEmployments).innerJoin(companies, and(eq(companies.workspaceId, contactEmployments.workspaceId), eq(companies.id, contactEmployments.companyId)))
      .where(and(eq(contactEmployments.workspaceId, workspaceId), eq(contactEmployments.contactId, contactId), eq(contactEmployments.isCurrent, true))).limit(1);
    return { firstName: contact.firstName, lastName: contact.lastName, companyName: employment?.companyName ?? null, companyLocation: employment?.location ?? null, status: contact.status };
  }

  private async currentChannels(workspaceId: string, contactId: string) {
    const [contact] = await this.db.select({ status: contacts.status }).from(contacts).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId))).limit(1);
    const rows = await this.db.select({ type: contactIdentities.type, value: contactIdentities.value, verificationStatus: contactIdentities.verificationStatus })
      .from(contactIdentities).where(and(eq(contactIdentities.workspaceId, workspaceId), eq(contactIdentities.contactId, contactId)));
    const suppressions = await this.db.select({ channel: contactSuppressions.channel, identityType: contactSuppressions.identityType })
      .from(contactSuppressions)
      .where(and(eq(contactSuppressions.workspaceId, workspaceId), eq(contactSuppressions.contactId, contactId), isNull(contactSuppressions.liftedAt)));
    const globallyBlocked = contact?.status === "suppressed" || suppressions.some((item) => item.channel === "global");
    const channel = (type: string) => {
      const row = rows.find((item) => item.type === type);
      if (!row) return { value: null, normalizedValue: null, status: "unavailable" as const, confidence: "none" as const, source: null };
      const blocked = globallyBlocked || suppressions.some((item) => item.channel === type || item.identityType === type);
      if (blocked) return { value: null, normalizedValue: null, status: "unavailable" as const, confidence: "none" as const, source: "suppression" };
      return { value: row.value, normalizedValue: row.value, status: row.verificationStatus === "verified" ? "verified" as const : row.verificationStatus === "invalid" ? "unavailable" as const : "found" as const, confidence: row.verificationStatus === "verified" ? "high" as const : "low" as const, source: "crm" };
    };
    return { linkedin: channel("linkedin"), email: channel("email"), whatsapp: channel("whatsapp") };
  }
}

export class EnrichmentJobProcessor {
  constructor(private readonly repository: PostgresEnrichmentRepository, private readonly enricher: ProspectEnricher, private readonly queue: JobQueue) {}
  async process(job: LeasedJob): Promise<void> {
    const payload = job.payload as Partial<EnrichmentJobPayload>;
    if (!payload.jobId || !payload.contactId) throw new Error("ENRICHMENT_JOB_INVALID");
    await this.repository.processJob({ job: { ...job, payload: payload as EnrichmentJobPayload }, enricher: this.enricher, queue: this.queue });
  }
}

interface ContactContext { firstName: string; lastName: string; companyName: string | null; companyLocation: string | null; status?: string }

function mapStatus(status: string): EnrichmentObservationStatus {
  if (status === "verified") return "verified";
  if (status === "invalid") return "invalid";
  if (status === "found") return "found";
  return "probable";
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message.includes(":") ? error.message.split(":", 1)[0]! : error instanceof Error ? error.message : "ENRICHMENT_FAILED";
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4_000);
}
