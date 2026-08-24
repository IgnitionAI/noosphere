import { and, asc, desc, eq, sql } from "drizzle-orm";
import { validateOfferForPublication, type OfferClaimDraft, type OfferDraft } from "@outbound/domain/gtm/offers";
import type { Database } from "@outbound/infrastructure/database/client";
import { auditLogs, offerClaims, offerVersions, offers, outboxEvents } from "@outbound/infrastructure/database/schema";

export class PostgresOfferRepository {
  constructor(private readonly db: Database) {}

  async listOffers(workspaceId: string) {
    return this.db.select().from(offers).where(eq(offers.workspaceId, workspaceId)).orderBy(desc(offers.updatedAt));
  }

  async createOffer(input: {
    id: string; workspaceId: string; name: string; category: string; targetAudience: string;
    createdBy: string;
  }) {
    const rows = await this.db.insert(offers).values({
      id: input.id, workspaceId: input.workspaceId, name: input.name, category: input.category,
      targetAudience: input.targetAudience, createdBy: input.createdBy,
    }).returning();
    return rows[0]!;
  }

  async getOffer(input: { workspaceId: string; offerId: string }) {
    const rows = await this.db.select().from(offers).where(and(eq(offers.workspaceId, input.workspaceId), eq(offers.id, input.offerId))).limit(1);
    const offer = rows[0];
    if (!offer) return null;
    const versions = await this.listVersions(input);
    return { ...offer, versions };
  }

  async updateOffer(input: {
    workspaceId: string; offerId: string; fields: Partial<Pick<typeof offers.$inferInsert,
      "name" | "category" | "valueProposition" | "targetAudience" | "pricing" | "commercialRules" | "constraints" | "claims" | "objections">>;
  }) {
    const rows = await this.db.update(offers).set({ ...input.fields, updatedAt: new Date() })
      .where(and(eq(offers.workspaceId, input.workspaceId), eq(offers.id, input.offerId))).returning();
    if (!rows[0]) throw new Error("OFFER_NOT_FOUND");
    return rows[0];
  }

  async listVersions(input: { workspaceId: string; offerId: string }) {
    const versions = await this.db.select().from(offerVersions)
      .where(and(eq(offerVersions.workspaceId, input.workspaceId), eq(offerVersions.offerId, input.offerId)))
      .orderBy(desc(offerVersions.version));
    if (!versions.length) return [];
    const allClaims = await this.db.select().from(offerClaims)
      .where(eq(offerClaims.workspaceId, input.workspaceId));
    return versions.map((version) => ({
      ...version,
      claims: allClaims.filter((claim) => claim.offerVersionId === version.id),
    }));
  }

  async publishOffer(input: { id: string; workspaceId: string; offerId: string; userId: string; publishedAt: Date }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.offerId}, 0))`);
      const rows = await tx.select().from(offers)
        .where(and(eq(offers.workspaceId, input.workspaceId), eq(offers.id, input.offerId))).limit(1);
      const offer = rows[0];
      if (!offer) throw new Error("OFFER_NOT_FOUND");
      if (offer.deletedAt) throw new Error("OFFER_DELETED");
      const draft = toDraft(offer);
      const missing = validateOfferForPublication(draft);
      if (missing.length) throw new Error(`OFFER_INVALID:${missing.join(",")}`);
      const previous = await tx.select().from(offerVersions)
        .where(and(eq(offerVersions.workspaceId, input.workspaceId), eq(offerVersions.offerId, input.offerId)))
        .orderBy(desc(offerVersions.version)).limit(1);
      const previousVersion = previous[0];
      const previousDraft = previousVersion ? snapshotDraft(previousVersion, await claimsFor(tx, input.workspaceId, previousVersion.id)) : null;
      if (previousDraft && JSON.stringify(previousDraft) === JSON.stringify(draft)) {
        return previousVersion;
      }
      const version = (previousVersion?.version ?? 0) + 1;
      const inserted = await tx.insert(offerVersions).values({
        id: input.id, workspaceId: input.workspaceId, offerId: input.offerId, version,
        name: offer.name,
        category: offer.category, valueProposition: offer.valueProposition, targetAudience: offer.targetAudience,
        pricing: offer.pricing, commercialRules: offer.commercialRules, constraints: offer.constraints,
        objections: offer.objections, publishedBy: input.userId, publishedAt: input.publishedAt,
      }).returning();
      const published = inserted[0]!;
      const claims = draft.claims.map((claim) => ({
        id: crypto.randomUUID(), workspaceId: input.workspaceId, offerVersionId: published.id,
        claim: claim.claim, validationStatus: claim.validationStatus, evidenceUri: claim.evidenceUri,
      }));
      await tx.insert(offerClaims).values(claims);
      await tx.update(offers).set({ currentVersion: version, updatedAt: input.publishedAt })
        .where(and(eq(offers.workspaceId, input.workspaceId), eq(offers.id, input.offerId)));
      const [outbox] = await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId, aggregateType: "Offer", aggregateId: input.offerId,
        eventType: "OfferVersionPublished",
        payload: { type: "OfferVersionPublished", offerId: input.offerId, version, versionId: published.id, workspaceId: input.workspaceId, actorUserId: input.userId },
      }).returning({ id: outboxEvents.id });
      if (outbox) {
        await tx.insert(auditLogs).values({
          workspaceId: input.workspaceId,
          actorUserId: input.userId,
          action: "OfferVersionPublished",
          subjectType: "Offer",
          subjectId: input.offerId,
          changes: { offerId: input.offerId, version, versionId: published.id },
          sourceEventId: outbox.id,
        });
      }
      return { ...published, claims };
    });
  }
}

function toDraft(offer: typeof offers.$inferSelect): OfferDraft {
  return {
    name: offer.name, category: offer.category, valueProposition: offer.valueProposition,
    targetAudience: offer.targetAudience, pricing: offer.pricing, commercialRules: offer.commercialRules,
    constraints: offer.constraints, objections: offer.objections, claims: claimsFromJson(offer.claims),
  };
}

function claimsFromJson(value: unknown): OfferClaimDraft[] {
  if (!Array.isArray(value)) return [];
  return value.filter((claim): claim is OfferClaimDraft => {
    if (!claim || typeof claim !== "object") return false;
    const row = claim as Record<string, unknown>;
    return typeof row.claim === "string" && ["hypothesis", "sourced", "validated", "invalidated"].includes(String(row.validationStatus));
  }).map((claim) => ({ claim: claim.claim, validationStatus: claim.validationStatus, evidenceUri: claim.evidenceUri ?? null }));
}

async function claimsFor(tx: any, workspaceId: string, versionId: string) {
  const rows = await tx.select().from(offerClaims).where(and(eq(offerClaims.workspaceId, workspaceId), eq(offerClaims.offerVersionId, versionId)));
  return rows.map((row: typeof offerClaims.$inferSelect) => ({
    claim: row.claim,
    validationStatus: row.validationStatus,
    evidenceUri: row.evidenceUri,
  }));
}

function snapshotDraft(version: typeof offerVersions.$inferSelect, claims: readonly OfferClaimDraft[]): OfferDraft {
  return {
    name: version.name, category: version.category, valueProposition: version.valueProposition,
    targetAudience: version.targetAudience, pricing: version.pricing, commercialRules: version.commercialRules,
    constraints: version.constraints, objections: version.objections, claims,
  };
}
