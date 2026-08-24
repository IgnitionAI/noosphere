import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { scoreProspect, type PopulationCriterion, type ProspectFacts } from "@outbound/domain/campaigns/population-scoring";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  campaignEnrollments,
  campaignProspects,
  campaigns,
  companies,
  contactEmployments,
  contactIdentities,
  contactSuppressions,
  contacts,
  icpCriterion,
  outboxEvents,
  sequenceVersions,
} from "@outbound/infrastructure/database/schema";
import { captureProspectMemoryMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-memory-mutation";

export class CampaignPopulationError extends Error {
  constructor(readonly code: string, readonly details: Readonly<Record<string, unknown>> = {}) {
    super(code);
  }
}

export class PostgresCampaignPopulationRepository {
  constructor(private readonly db: Database) {}

  async listPopulation(input: { workspaceId: string; campaignId: string }) {
    const campaign = await this.getCampaign(input);
    if (!campaign) throw new CampaignPopulationError("CAMPAIGN_NOT_FOUND");
    const criteria = await this.criteria(input.workspaceId, campaign.icpVersionId);
    const rows = await this.db.select().from(contacts)
      .where(eq(contacts.workspaceId, input.workspaceId))
      .orderBy(asc(contacts.createdAt), asc(contacts.id));
    const result = [];
    for (const contact of rows) {
      const facts = await this.facts(input.workspaceId, contact);
      const score = scoreProspect(criteria, facts);
      const prospect = await this.persistScore(input, contact.id, score, facts);
      result.push({ ...prospect, contact: { ...contact, identities: facts.identities, employment: facts.employment, company: facts.company } });
    }
    return result.sort((left, right) => Number(right.score) - Number(left.score));
  }

  async getExplanation(input: { workspaceId: string; campaignId: string; contactId: string }) {
    const campaign = await this.getCampaign(input);
    if (!campaign) throw new CampaignPopulationError("CAMPAIGN_NOT_FOUND");
    const contact = await this.contact(input.workspaceId, input.contactId);
    if (!contact) throw new CampaignPopulationError("CONTACT_NOT_FOUND");
    const criteria = await this.criteria(input.workspaceId, campaign.icpVersionId);
    const facts = await this.facts(input.workspaceId, contact);
    const score = scoreProspect(criteria, facts);
    const prospect = await this.persistScore(input, input.contactId, score, facts);
    return { ...prospect, contact: { ...contact, identities: facts.identities, employment: facts.employment, company: facts.company } };
  }

  async select(input: { workspaceId: string; campaignId: string; contactIds: readonly string[]; userId: string }) {
    if (input.contactIds.length === 0) throw new CampaignPopulationError("SELECTION_EMPTY");
    const campaign = await this.getCampaign(input);
    if (!campaign) throw new CampaignPopulationError("CAMPAIGN_NOT_FOUND");
    const selected: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const contactId of input.contactIds) {
        const rows = await tx.select().from(campaignProspects).where(and(
          eq(campaignProspects.workspaceId, input.workspaceId),
          eq(campaignProspects.campaignId, input.campaignId),
          eq(campaignProspects.contactId, contactId),
        )).limit(1);
        const prospect = rows[0];
        if (!prospect) throw new CampaignPopulationError("PROSPECT_NOT_FOUND", { contactId });
        if (prospect.status === "enrolled") throw new CampaignPopulationError("PROSPECT_ALREADY_ENROLLED", { contactId });
        if (prospect.status === "excluded") throw new CampaignPopulationError("PROSPECT_EXCLUDED", { contactId });
        if (prospect.status !== "selected") {
          await tx.update(campaignProspects).set({ status: "selected", selectedAt: new Date(), updatedAt: new Date() }).where(eq(campaignProspects.id, prospect.id));
          selected.push(contactId);
        }
      }
      if (selected.length) {
        const eventId = await this.recordEvent(tx, input.workspaceId, input.campaignId, input.userId, "CampaignProspectsSelected", { campaignId: input.campaignId, contactIds: selected });
        const observedAt = new Date();
        for (const contactId of selected) {
          await captureProspectMemoryMutation(tx, {
            workspaceId: input.workspaceId,
            sourceContactId: contactId,
            sourceKind: "campaign_membership",
            sourceId: `${eventId}:${contactId}`,
            sourceVersion: 1,
            kind: "campaign_changed",
            occurredAt: observedAt,
            observedAt,
            payload: { campaignId: input.campaignId, status: "selected" },
            correlationId: eventId,
          });
        }
        await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: "CampaignProspectsSelected", subjectType: "Campaign", subjectId: input.campaignId, changes: { contactIds: selected }, sourceEventId: eventId });
      }
    });
    return this.getProspects(input.workspaceId, input.campaignId, input.contactIds);
  }

  async exclude(input: { workspaceId: string; campaignId: string; contactId: string; userId: string; reason: string }) {
    const reason = input.reason.trim();
    if (!reason) throw new CampaignPopulationError("EXCLUSION_REASON_REQUIRED");
    const result = await this.db.transaction(async (tx) => {
      const rows = await tx.select().from(campaignProspects).where(and(
        eq(campaignProspects.workspaceId, input.workspaceId), eq(campaignProspects.campaignId, input.campaignId), eq(campaignProspects.contactId, input.contactId),
      )).limit(1);
      const prospect = rows[0];
      if (!prospect) throw new CampaignPopulationError("PROSPECT_NOT_FOUND");
      if (prospect.status === "enrolled") throw new CampaignPopulationError("PROSPECT_ALREADY_ENROLLED");
      if (prospect.status === "excluded") return prospect;
      const updated = await tx.update(campaignProspects).set({ status: "excluded", exclusionReason: reason, excludedAt: new Date(), updatedAt: new Date() }).where(eq(campaignProspects.id, prospect.id)).returning();
      const eventId = await this.recordEvent(tx, input.workspaceId, input.campaignId, input.userId, "CampaignProspectExcluded", { campaignId: input.campaignId, contactId: input.contactId, reason });
      const observedAt = new Date();
      await captureProspectMemoryMutation(tx, {
        workspaceId: input.workspaceId,
        sourceContactId: input.contactId,
        sourceKind: "campaign_membership",
        sourceId: eventId,
        sourceVersion: 1,
        kind: "campaign_changed",
        occurredAt: observedAt,
        observedAt,
        payload: { campaignId: input.campaignId, status: "excluded", reason },
        correlationId: eventId,
      });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: "CampaignProspectExcluded", subjectType: "CampaignProspect", subjectId: prospect.id, changes: { reason }, sourceEventId: eventId });
      return updated[0]!;
    });
    return result;
  }

  async enroll(input: { workspaceId: string; campaignId: string; contactId: string; userId: string }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.contactId}`}, 0))`);
      const campaignRows = await tx.select().from(campaigns).where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId))).limit(1);
      const campaign = campaignRows[0];
      if (!campaign) throw new CampaignPopulationError("CAMPAIGN_NOT_FOUND");
      if (campaign.status !== "active") throw new CampaignPopulationError("CAMPAIGN_NOT_ACTIVE");
      if (!campaign.sequenceVersionId) throw new CampaignPopulationError("SEQUENCE_VERSION_NOT_FOUND");
      const prospectRows = await tx.select().from(campaignProspects).where(and(
        eq(campaignProspects.workspaceId, input.workspaceId), eq(campaignProspects.campaignId, input.campaignId), eq(campaignProspects.contactId, input.contactId),
      )).limit(1);
      const prospect = prospectRows[0];
      if (!prospect) throw new CampaignPopulationError("PROSPECT_NOT_FOUND");
      const existingRows = await tx.select().from(campaignEnrollments).where(and(
        eq(campaignEnrollments.workspaceId, input.workspaceId), eq(campaignEnrollments.campaignId, input.campaignId), eq(campaignEnrollments.contactId, input.contactId),
      )).limit(1);
      const existing = existingRows[0];
      if (existing?.status === "active") return existing;
      if (prospect.status === "excluded") throw new CampaignPopulationError("PROSPECT_EXCLUDED");
      if (prospect.status !== "selected" && prospect.status !== "enrolled") throw new CampaignPopulationError("PROSPECT_NOT_SELECTED");
      const contact = await this.contactWithFacts(tx, input.workspaceId, input.contactId);
      if (!contact) throw new CampaignPopulationError("CONTACT_NOT_FOUND");
      const suppression = await this.globalSuppression(tx, input.workspaceId, input.contactId, contact.identities);
      if (suppression) {
        await tx.update(campaignProspects).set({ status: "excluded", exclusionReason: suppression.reason ?? "global suppression active", excludedAt: new Date(), updatedAt: new Date() }).where(eq(campaignProspects.id, prospect.id));
        throw new CampaignPopulationError("ENROLLMENT_SUPPRESSED", { suppressionId: suppression.id, reason: suppression.reason });
      }
      const sequenceRows = await tx.select().from(sequenceVersions).where(and(eq(sequenceVersions.workspaceId, input.workspaceId), eq(sequenceVersions.id, campaign.sequenceVersionId))).limit(1);
      const sequence = sequenceRows[0];
      if (!sequence) throw new CampaignPopulationError("SEQUENCE_VERSION_NOT_FOUND");
      const missingChannel = missingSequenceChannel(sequence.steps, contact.identities);
      if (missingChannel) throw new CampaignPopulationError("NO_VALID_CHANNEL", { channel: missingChannel });
      const conflictRows = await tx.select({ enrollment: campaignEnrollments, campaignName: campaigns.name }).from(campaignEnrollments).innerJoin(campaigns, and(
        eq(campaignEnrollments.workspaceId, campaigns.workspaceId), eq(campaignEnrollments.campaignId, campaigns.id),
      )).where(and(eq(campaignEnrollments.workspaceId, input.workspaceId), eq(campaignEnrollments.contactId, input.contactId), eq(campaignEnrollments.status, "active"))).limit(1);
      const conflict = conflictRows[0];
      if (conflict && conflict.enrollment.campaignId !== input.campaignId) throw new CampaignPopulationError("ACTIVE_SEQUENCE_CONFLICT", { campaignId: conflict.enrollment.campaignId, campaignName: conflict.campaignName });
      const enrolledAt = new Date();
      let enrollment;
      if (existing) {
        const updated = await tx.update(campaignEnrollments).set({ status: "active", sequenceVersionId: campaign.sequenceVersionId, enrolledBy: input.userId, enrolledAt, completedAt: null }).where(eq(campaignEnrollments.id, existing.id)).returning();
        enrollment = updated[0]!;
      } else {
        const inserted = await tx.insert(campaignEnrollments).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, campaignId: input.campaignId, contactId: input.contactId, sequenceVersionId: campaign.sequenceVersionId, enrolledBy: input.userId, enrolledAt }).returning();
        enrollment = inserted[0]!;
      }
      await tx.update(campaignProspects).set({ status: "enrolled", enrolledAt, updatedAt: enrolledAt }).where(eq(campaignProspects.id, prospect.id));
      const eventId = await this.recordEvent(tx, input.workspaceId, input.campaignId, input.userId, "CampaignProspectEnrolled", { campaignId: input.campaignId, contactId: input.contactId, sequenceVersionId: campaign.sequenceVersionId, enrollmentId: enrollment.id });
      await captureProspectMemoryMutation(tx, {
        workspaceId: input.workspaceId,
        sourceContactId: input.contactId,
        sourceKind: "campaign_membership",
        sourceId: eventId,
        sourceVersion: 1,
        kind: "campaign_changed",
        occurredAt: enrolledAt,
        observedAt: enrolledAt,
        payload: { campaignId: input.campaignId, status: "enrolled", enrollmentId: enrollment.id },
        correlationId: eventId,
      });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: "CampaignProspectEnrolled", subjectType: "CampaignEnrollment", subjectId: enrollment.id, changes: { campaignId: input.campaignId, contactId: input.contactId, sequenceVersionId: campaign.sequenceVersionId }, sourceEventId: eventId });
      return enrollment;
    });
  }

  private async getCampaign(input: { workspaceId: string; campaignId: string }) {
    const rows = await this.db.select().from(campaigns).where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId))).limit(1);
    return rows[0] ?? null;
  }

  private async contact(workspaceId: string, contactId: string) {
    const rows = await this.db.select().from(contacts).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId))).limit(1);
    return rows[0] ?? null;
  }

  private async criteria(workspaceId: string, versionId: string): Promise<PopulationCriterion[]> {
    const rows = await this.db.select().from(icpCriterion).where(and(eq(icpCriterion.workspaceId, workspaceId), eq(icpCriterion.icpVersionId, versionId))).orderBy(asc(icpCriterion.id));
    return rows.map((row) => ({ id: row.id, dimension: row.dimension, operator: row.operator, expectedValue: row.expectedValue, weight: row.weight === null ? null : Number(row.weight), required: row.required, exclusion: row.exclusion }));
  }

  private async facts(workspaceId: string, contact: typeof contacts.$inferSelect): Promise<ProspectFacts> {
    return this.contactFacts(this.db, workspaceId, contact);
  }

  private async contactWithFacts(tx: any, workspaceId: string, contactId: string) {
    const rows = await tx.select().from(contacts).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId))).limit(1);
    if (!rows[0]) return null;
    const facts = await this.contactFacts(tx, workspaceId, rows[0]);
    return { ...rows[0], ...facts };
  }

  private async contactFacts(executor: any, workspaceId: string, contact: typeof contacts.$inferSelect): Promise<ProspectFacts> {
    const identitiesRows = await executor.select().from(contactIdentities).where(and(eq(contactIdentities.workspaceId, workspaceId), eq(contactIdentities.contactId, contact.id)));
    const employmentRows = await executor.select({ employment: contactEmployments, company: companies }).from(contactEmployments).leftJoin(companies, and(eq(contactEmployments.workspaceId, companies.workspaceId), eq(contactEmployments.companyId, companies.id))).where(and(eq(contactEmployments.workspaceId, workspaceId), eq(contactEmployments.contactId, contact.id), eq(contactEmployments.isCurrent, true))).limit(1);
    const employment = employmentRows[0]?.employment ?? null;
    const company = employmentRows[0]?.company ?? null;
    const identities: Record<string, string[]> = {};
    for (const identity of identitiesRows) (identities[identity.type] ??= []).push(identity.normalizedValue);
    return { firstName: contact.firstName, lastName: contact.lastName, preferredChannel: contact.preferredChannel, status: contact.status, source: contact.source, identities, employment: employment ? { ...employment } : null, company: company ? { ...company } : null };
  }

  private async persistScore(input: { workspaceId: string; campaignId: string }, contactId: string, score: ReturnType<typeof scoreProspect>, _facts: ProspectFacts) {
    const existingRows = await this.db.select().from(campaignProspects).where(and(eq(campaignProspects.workspaceId, input.workspaceId), eq(campaignProspects.campaignId, input.campaignId), eq(campaignProspects.contactId, contactId))).limit(1);
    const existing = existingRows[0];
    if (existing && existing.status !== "candidate") return existing;
    const status = score.eligible ? "candidate" as const : "excluded" as const;
    const exclusionReason = score.eligible ? null : (score.explanation.exclusions[0]?.reason ?? "ICP criteria not met");
    if (!existing) {
      const rows = await this.db.insert(campaignProspects).values({ workspaceId: input.workspaceId, campaignId: input.campaignId, contactId, status, score: score.score, explanation: score.explanation, exclusionReason, excludedAt: status === "excluded" ? new Date() : null }).returning();
      return rows[0]!;
    }
    const rows = await this.db.update(campaignProspects).set({ status, score: score.score, explanation: score.explanation, exclusionReason, updatedAt: new Date(), ...(status === "excluded" ? { excludedAt: existing.excludedAt ?? new Date() } : {}) }).where(eq(campaignProspects.id, existing.id)).returning();
    return rows[0]!;
  }

  private async getProspects(workspaceId: string, campaignId: string, contactIds: readonly string[]) {
    return this.db.select().from(campaignProspects).where(and(eq(campaignProspects.workspaceId, workspaceId), eq(campaignProspects.campaignId, campaignId), inArray(campaignProspects.contactId, [...contactIds])));
  }

  private async globalSuppression(tx: any, workspaceId: string, contactId: string, identities: Readonly<Record<string, readonly string[]>>) {
    const identityConditions = Object.entries(identities).flatMap(([type, values]) => values.map((value) => and(eq(contactSuppressions.identityType, type as never), eq(contactSuppressions.normalizedValue, value))));
    const rows = await tx.select({ id: contactSuppressions.id, reason: contactSuppressions.reason }).from(contactSuppressions).where(and(eq(contactSuppressions.workspaceId, workspaceId), eq(contactSuppressions.channel, "global"), isNull(contactSuppressions.liftedAt), or(eq(contactSuppressions.contactId, contactId), ...identityConditions))).limit(1);
    return rows[0] ?? null;
  }

  private async recordEvent(tx: any, workspaceId: string, campaignId: string, userId: string, eventType: string, payload: unknown) {
    const eventPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? { type: eventType, ...(payload as Record<string, unknown>) } : { type: eventType, data: payload };
    const [event] = await tx.insert(outboxEvents).values({ workspaceId, aggregateType: "Campaign", aggregateId: campaignId, eventType, payload: eventPayload }).returning({ id: outboxEvents.id });
    if (!event) throw new Error("OUTBOX_EVENT_CREATE_FAILED");
    return event.id;
  }
}

function missingSequenceChannel(steps: unknown, identities: Readonly<Record<string, readonly string[]>>): string | null {
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const kind = (step as { kind?: unknown }).kind;
    const channel = kind === "linkedin_invite" || kind === "linkedin_message" ? "linkedin" : kind === "email" ? "email" : kind === "whatsapp" ? "whatsapp" : null;
    if (channel && !(identities[channel]?.length)) return channel;
  }
  return null;
}
