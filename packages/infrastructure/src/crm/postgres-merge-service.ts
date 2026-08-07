import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  companies,
  contactEmployments,
  contactIdentities,
  contactMerges,
  contactSuppressions,
  contacts,
  mergeCandidates,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

type MatchType = "certain" | "probable";

export class PostgresMergeService {
  constructor(private readonly db: Database) {}

  async discover(workspaceId: string) {
    const people = await this.db.select().from(contacts).where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.status, ["active", "suppressed"])));
    const identities = await this.db.select().from(contactIdentities).where(eq(contactIdentities.workspaceId, workspaceId));
    const pairs = new Map<string, { primaryContactId: string; secondaryContactId: string; matchType: MatchType; signals: Record<string, unknown> }>();
    const add = (primaryContactId: string, secondaryContactId: string, matchType: MatchType, signals: Record<string, unknown>) => {
      if (primaryContactId === secondaryContactId) return;
      const [left, right] = [primaryContactId, secondaryContactId].sort();
      const key = `${left}:${right}`;
      const current = pairs.get(key);
      if (!current || (matchType === "certain" && current.matchType !== "certain")) {
        pairs.set(key, { primaryContactId: left!, secondaryContactId: right!, matchType, signals });
      }
    };
    const groups = new Map<string, string[]>();
    for (const identity of identities) {
      const group = groups.get(`${identity.type}:${identity.normalizedValue}`) ?? [];
      group.push(identity.contactId);
      groups.set(`${identity.type}:${identity.normalizedValue}`, group);
    }
    for (const [fingerprint, contactIds] of groups) {
      for (let index = 0; index < contactIds.length; index += 1) {
        for (let next = index + 1; next < contactIds.length; next += 1) {
          add(contactIds[index]!, contactIds[next]!, "certain", { identity: fingerprint });
        }
      }
    }
    const employmentRows = await this.db
      .select({ contactId: contactEmployments.contactId, companyId: contactEmployments.companyId })
      .from(contactEmployments)
      .where(and(eq(contactEmployments.workspaceId, workspaceId), eq(contactEmployments.isCurrent, true)));
    const companyByContact = new Map(employmentRows.map((row) => [row.contactId, row.companyId]));
    const byName = new Map<string, typeof people>();
    for (const person of people) {
      const key = `${person.firstName.trim().toLowerCase()}:${person.lastName.trim().toLowerCase()}`;
      const group = byName.get(key) ?? [];
      group.push(person);
      byName.set(key, group);
    }
    for (const group of byName.values()) {
      for (let index = 0; index < group.length; index += 1) {
        for (let next = index + 1; next < group.length; next += 1) {
          const left = group[index]!;
          const right = group[next]!;
          const leftCompany = companyByContact.get(left.id);
          const rightCompany = companyByContact.get(right.id);
          if (!leftCompany || !rightCompany || leftCompany !== rightCompany) continue;
          add(left.id, right.id, "probable", { sameName: true, sameCompanyId: leftCompany });
        }
      }
    }
    for (const pair of pairs.values()) {
      await this.db.insert(mergeCandidates).values({
        id: crypto.randomUUID(),
        workspaceId,
        primaryContactId: pair.primaryContactId,
        secondaryContactId: pair.secondaryContactId,
        pairKey: `${pair.primaryContactId}:${pair.secondaryContactId}`,
        matchType: pair.matchType,
        signals: pair.signals,
      }).onConflictDoNothing();
    }
    return this.listCandidates({ workspaceId, status: "pending" });
  }

  async listCandidates(input: { workspaceId: string; status?: string }) {
    const conditions = [eq(mergeCandidates.workspaceId, input.workspaceId)];
    if (input.status) conditions.push(eq(mergeCandidates.status, input.status));
    const candidates = await this.db.select().from(mergeCandidates).where(and(...conditions)).orderBy(asc(mergeCandidates.createdAt));
    const data = [];
    for (const candidate of candidates) {
      const contactsRows = await this.db.select().from(contacts).where(and(eq(contacts.workspaceId, input.workspaceId), inArray(contacts.id, [candidate.primaryContactId, candidate.secondaryContactId])));
      data.push({ ...candidate, contacts: contactsRows });
    }
    return data;
  }

  async reject(input: { workspaceId: string; candidateId: string; decidedBy: string; reason: string | null }) {
    const rows = await this.db.update(mergeCandidates).set({ status: "rejected", decisionReason: input.reason, decidedBy: input.decidedBy, decidedAt: new Date() }).where(and(eq(mergeCandidates.workspaceId, input.workspaceId), eq(mergeCandidates.id, input.candidateId), eq(mergeCandidates.status, "pending"))).returning();
    if (!rows[0]) {
      const existing = await this.db.select().from(mergeCandidates).where(and(eq(mergeCandidates.workspaceId, input.workspaceId), eq(mergeCandidates.id, input.candidateId))).limit(1);
      if (!existing[0]) throw new Error("MERGE_CANDIDATE_NOT_FOUND");
      return existing[0];
    }
    const eventId = await this.recordEvent(this.db, input.workspaceId, input.candidateId, "MergeCandidateRejected", { candidateId: input.candidateId, reason: input.reason });
    await this.db.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.decidedBy, action: "MergeCandidateRejected", subjectType: "MergeCandidate", subjectId: input.candidateId, changes: { reason: input.reason }, sourceEventId: eventId });
    return rows[0];
  }

  async approve(input: { workspaceId: string; candidateId: string; decidedBy: string }) {
    const rows = await this.db.select().from(mergeCandidates).where(and(eq(mergeCandidates.workspaceId, input.workspaceId), eq(mergeCandidates.id, input.candidateId))).limit(1);
    const candidate = rows[0];
    if (!candidate) throw new Error("MERGE_CANDIDATE_NOT_FOUND");
    if (candidate.status === "rejected") throw new Error("MERGE_CANDIDATE_REJECTED");
    if (candidate.status === "approved") {
      const existing = await this.db.select().from(contactMerges).where(and(eq(contactMerges.workspaceId, input.workspaceId), eq(contactMerges.candidateId, input.candidateId))).limit(1);
      if (existing[0]) return existing[0];
    }
    return this.merge({ workspaceId: input.workspaceId, candidateId: candidate.id, survivorContactId: candidate.primaryContactId, mergedContactId: candidate.secondaryContactId, mergedBy: input.decidedBy });
  }

  async merge(input: { workspaceId: string; candidateId: string | null; survivorContactId: string; mergedContactId: string; mergedBy: string }) {
    return this.db.transaction(async (tx) => {
      const contactRows = await tx.select().from(contacts).where(and(eq(contacts.workspaceId, input.workspaceId), inArray(contacts.id, [input.survivorContactId, input.mergedContactId])));
      const survivor = contactRows.find((row) => row.id === input.survivorContactId);
      const merged = contactRows.find((row) => row.id === input.mergedContactId);
      if (!survivor || !merged) throw new Error("CONTACT_NOT_FOUND");
      const identityRows = await tx.select().from(contactIdentities).where(and(eq(contactIdentities.workspaceId, input.workspaceId), inArray(contactIdentities.contactId, [survivor.id, merged.id])));
      const employmentRows = await tx.select().from(contactEmployments).where(and(eq(contactEmployments.workspaceId, input.workspaceId), inArray(contactEmployments.contactId, [survivor.id, merged.id])));
      const suppressionRows = await tx.select().from(contactSuppressions).where(and(eq(contactSuppressions.workspaceId, input.workspaceId), inArray(contactSuppressions.contactId, [survivor.id, merged.id])));
      const snapshot = { contacts: [survivor, merged], identities: identityRows, employments: employmentRows, suppressions: suppressionRows };
      const survivorCurrent = employmentRows.some((row) => row.contactId === survivor.id && row.isCurrent);
      const mergedIdentities = identityRows.filter((row) => row.contactId === merged.id);
      for (const identity of mergedIdentities) {
        await tx.update(contactIdentities).set({ contactId: survivor.id }).where(and(eq(contactIdentities.workspaceId, input.workspaceId), eq(contactIdentities.id, identity.id)));
      }
      for (const employment of employmentRows.filter((row) => row.contactId === merged.id)) {
        await tx.update(contactEmployments).set({ contactId: survivor.id, isCurrent: employment.isCurrent && !survivorCurrent, endedOn: employment.isCurrent && survivorCurrent ? new Date().toISOString().slice(0, 10) : employment.endedOn }).where(and(eq(contactEmployments.workspaceId, input.workspaceId), eq(contactEmployments.id, employment.id)));
      }
      for (const suppression of suppressionRows.filter((row) => row.contactId === merged.id)) {
        await tx.update(contactSuppressions).set({ contactId: survivor.id }).where(and(eq(contactSuppressions.workspaceId, input.workspaceId), eq(contactSuppressions.id, suppression.id)));
      }
      await tx.update(contacts).set({ status: "suppressed", mergedIntoId: survivor.id, mergedAt: new Date(), updatedAt: new Date() }).where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, merged.id)));
      if (input.candidateId) await tx.update(mergeCandidates).set({ status: "approved", decidedBy: input.mergedBy, decidedAt: new Date() }).where(and(eq(mergeCandidates.workspaceId, input.workspaceId), eq(mergeCandidates.id, input.candidateId)));
      const mergeRows = await tx.insert(contactMerges).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, survivorContactId: survivor.id, mergedContactId: merged.id, candidateId: input.candidateId, snapshot }).returning();
      const merge = mergeRows[0]!;
      const eventId = await this.recordEvent(tx, input.workspaceId, merge.id, "ContactMerged", { mergeId: merge.id, survivorContactId: survivor.id, mergedContactId: merged.id });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.mergedBy, action: "ContactMerged", subjectType: "ContactMerge", subjectId: merge.id, changes: { survivorContactId: survivor.id, mergedContactId: merged.id }, sourceEventId: eventId });
      return merge;
    });
  }

  async undo(input: { workspaceId: string; contactId: string; undoneBy: string }) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(contactMerges).where(and(eq(contactMerges.workspaceId, input.workspaceId), or(eq(contactMerges.survivorContactId, input.contactId), eq(contactMerges.mergedContactId, input.contactId)), eq(contactMerges.status, "active"))).orderBy(asc(contactMerges.mergedAt)).limit(1);
      const merge = rows[0];
      if (!merge) {
        const undone = await tx.select({ id: contactMerges.id }).from(contactMerges).where(and(eq(contactMerges.workspaceId, input.workspaceId), or(eq(contactMerges.survivorContactId, input.contactId), eq(contactMerges.mergedContactId, input.contactId)), eq(contactMerges.status, "undone"))).limit(1);
        throw new Error(undone[0] ? "MERGE_ALREADY_UNDONE" : "MERGE_NOT_FOUND");
      }
      const snapshot = merge.snapshot as { contacts: Array<Record<string, unknown>>; identities: Array<Record<string, unknown>>; employments: Array<Record<string, unknown>>; suppressions: Array<Record<string, unknown>> };
      for (const contact of snapshot.contacts) {
        const id = String(contact.id);
        await tx.update(contacts).set({ firstName: String(contact.firstName), lastName: String(contact.lastName), photoUrl: contact.photoUrl as string | null, preferredChannel: contact.preferredChannel as string | null, status: contact.status as "active" | "suppressed", source: contact.source as "manual" | "csv" | "icp_research" | "provider", mergedIntoId: contact.mergedIntoId as string | null, mergedAt: contact.mergedAt ? new Date(String(contact.mergedAt)) : null, updatedAt: new Date() }).where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, id)));
      }
      for (const identity of snapshot.identities) await tx.update(contactIdentities).set({ contactId: String(identity.contactId), type: identity.type as "email" | "linkedin" | "phone" | "whatsapp", value: String(identity.value), normalizedValue: String(identity.normalizedValue), source: identity.source as "manual" | "csv" | "icp_research" | "provider" }).where(and(eq(contactIdentities.workspaceId, input.workspaceId), eq(contactIdentities.id, String(identity.id))));
      for (const employment of snapshot.employments) await tx.update(contactEmployments).set({ contactId: String(employment.contactId), companyId: String(employment.companyId), title: String(employment.title), startedOn: employment.startedOn as string | null, endedOn: employment.endedOn as string | null, isCurrent: Boolean(employment.isCurrent) }).where(and(eq(contactEmployments.workspaceId, input.workspaceId), eq(contactEmployments.id, String(employment.id))));
      for (const suppression of snapshot.suppressions) await tx.update(contactSuppressions).set({ contactId: suppression.contactId ? String(suppression.contactId) : null }).where(and(eq(contactSuppressions.workspaceId, input.workspaceId), eq(contactSuppressions.id, String(suppression.id))));
      await tx.update(contactMerges).set({ status: "undone", undoneBy: input.undoneBy, undoneAt: new Date() }).where(and(eq(contactMerges.workspaceId, input.workspaceId), eq(contactMerges.id, merge.id)));
      const eventId = await this.recordEvent(tx, input.workspaceId, merge.id, "ContactMergeUndone", { mergeId: merge.id });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.undoneBy, action: "ContactMergeUndone", subjectType: "ContactMerge", subjectId: merge.id, changes: {}, sourceEventId: eventId });
      return { ...merge, status: "undone", undoneBy: input.undoneBy };
    });
  }

  async history(input: { workspaceId: string; contactId: string }) {
    return this.db.select().from(contactMerges).where(and(eq(contactMerges.workspaceId, input.workspaceId), or(eq(contactMerges.survivorContactId, input.contactId), eq(contactMerges.mergedContactId, input.contactId)))).orderBy(asc(contactMerges.mergedAt));
  }

  private async recordEvent(executor: Pick<Database, "insert">, workspaceId: string, aggregateId: string, eventType: string, payload: Readonly<Record<string, unknown>>) {
    const rows = await executor.insert(outboxEvents).values({ workspaceId, aggregateType: "ContactMerge", aggregateId, eventType, payload }).returning({ id: outboxEvents.id });
    return rows[0]!.id;
  }
}
