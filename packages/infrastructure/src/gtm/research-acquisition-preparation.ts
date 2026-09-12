import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { ProductResearchBrief } from "@outbound/domain/gtm/product-research";
import type { Database } from "@outbound/infrastructure/database/client";
import { auditLogs, icpVersions, jobs, offerClaims, offers, offerVersions, outboxEvents, productResearchRuns, researchStageRuns } from "@outbound/infrastructure/database/schema";

export const RESEARCH_INBOUND_JOB_TYPE = "content.strategy.prepare";

export function researchOfferId(workspaceId: string, runId: string): string {
  const hash = createHash("sha256").update(`research-offer:${workspaceId}:${runId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Called in the same transaction as ICP publication. No publication or outreach is dispatched here. */
export async function prepareResearchAcquisition(
  tx: Pick<Database, "select" | "insert" | "update">,
  input: { workspaceId: string; runId: string; icpVersionId: string; now: Date },
): Promise<string> {
  const [run] = await tx.select().from(productResearchRuns).where(and(eq(productResearchRuns.workspaceId, input.workspaceId), eq(productResearchRuns.id, input.runId))).limit(1);
  const [icp] = await tx.select().from(icpVersions).where(and(eq(icpVersions.workspaceId, input.workspaceId), eq(icpVersions.id, input.icpVersionId), eq(icpVersions.runId, input.runId))).limit(1);
  if (!run || !icp) throw new Error("RESEARCH_ACQUISITION_SOURCE_NOT_FOUND");
  const offerId = researchOfferId(input.workspaceId, input.runId);
  let [version] = await tx.select().from(offerVersions).where(and(eq(offerVersions.workspaceId, input.workspaceId), eq(offerVersions.offerId, offerId))).orderBy(asc(offerVersions.version)).limit(1);
  if (!version) {
    const brief = run.brief as ProductResearchBrief;
    const [truth] = await tx.select().from(researchStageRuns).where(and(eq(researchStageRuns.workspaceId, input.workspaceId), eq(researchStageRuns.runId, input.runId), eq(researchStageRuns.stage, "product_truth"), eq(researchStageRuns.status, "completed"))).orderBy(desc(researchStageRuns.attempt)).limit(1);
    const summary = (truth?.output as { productSummary?: string } | null)?.productSummary;
    const valueProposition = brief.description.trim() || summary?.trim();
    if (!valueProposition) throw new Error("RESEARCH_PRODUCT_DESCRIPTION_REQUIRED");
    const productName = brief.productName.trim() || new URL(brief.productUrl).hostname;
    const [sameName] = await tx.select({ id: offers.id }).from(offers).where(and(eq(offers.workspaceId, input.workspaceId), eq(offers.name, productName))).limit(1);
    const name = sameName && sameName.id !== offerId ? `${productName.slice(0, 450)} — étude ${input.runId.slice(0, 8)}` : productName;
    // The brief is user-supplied context, not independently verified commercial proof.
    const claims = [{ claim: valueProposition, validationStatus: "hypothesis" as const, evidenceUri: null }];
    const fields = {
      name, category: brief.salesMotion, valueProposition, targetAudience: icp.name,
      pricing: {}, objections: [],
      commercialRules: { sourceResearchRunId: input.runId, productUrl: brief.productUrl, languages: brief.languages },
      constraints: { missingInformation: ["Tarifs et conditions commerciales", "Preuves des promesses commerciales"], buyerConstraints: brief.buyerConstraints ?? null },
    };
    await tx.insert(offers).values({ id: offerId, workspaceId: input.workspaceId, ...fields, claims, currentVersion: 1, createdBy: null, createdAt: input.now, updatedAt: input.now }).onConflictDoNothing();
    // Stable version ID and transaction make completion/recovery idempotent.
    const [created] = await tx.insert(offerVersions).values({ id: offerId, offerId, workspaceId: input.workspaceId, version: 1, ...fields, publishedBy: null, publishedAt: input.now }).onConflictDoNothing().returning();
    if (created) {
      await tx.insert(offerClaims).values(claims.map((claim) => ({ id: crypto.randomUUID(), workspaceId: input.workspaceId, offerVersionId: created.id, ...claim })));
      const [event] = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: "Offer", aggregateId: offerId, eventType: "OfferVersionPublished", payload: { type: "OfferVersionPublished", workspaceId: input.workspaceId, offerId, versionId: created.id, version: 1, actorUserId: null, sourceResearchRunId: input.runId } }).returning({ id: outboxEvents.id });
      if (event) await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: null, action: "OfferVersionPublished", subjectType: "Offer", subjectId: offerId, sourceEventId: event.id, changes: { offerVersionId: created.id, sourceResearchRunId: input.runId } });
    }
    [version] = await tx.select().from(offerVersions).where(and(eq(offerVersions.workspaceId, input.workspaceId), eq(offerVersions.id, offerId))).limit(1);
  }
  if (!version) throw new Error("RESEARCH_OFFER_PREPARATION_FAILED");
  await tx.insert(jobs).values({
    id: crypto.randomUUID(), workspaceId: input.workspaceId, type: RESEARCH_INBOUND_JOB_TYPE,
    payload: { workspaceId: input.workspaceId, runId: input.runId, offerVersionId: version.id, icpVersionId: input.icpVersionId },
    idempotencyKey: `research-inbound:${input.runId}`, correlationId: `research:${input.runId}`, maxAttempts: 3, availableAt: input.now,
  }).onConflictDoNothing();
  return version.id;
}
