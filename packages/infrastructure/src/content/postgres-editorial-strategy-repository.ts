import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  EditorialStrategyGrounding,
  EditorialStrategyRepository,
  EditorialStrategyVersionView,
  EditorialStrategyView,
} from "@outbound/application/content/editorial-strategy";
import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  contentOperationRequests,
  editorialStrategies,
  editorialStrategyVersions,
  icpVersions,
  offerClaims,
  offerVersions,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

export class PostgresEditorialStrategyRepository implements EditorialStrategyRepository {
  constructor(private readonly database: Database) {}

  async grounding(workspaceId: string): Promise<EditorialStrategyGrounding> {
    const [offers, icps] = await Promise.all([
      this.database.select().from(offerVersions)
        .where(eq(offerVersions.workspaceId, workspaceId))
        .orderBy(desc(offerVersions.publishedAt)).limit(1),
      this.database.select().from(icpVersions)
        .where(eq(icpVersions.workspaceId, workspaceId))
        .orderBy(desc(icpVersions.publishedAt)).limit(1),
    ]);
    const offer = offers[0];
    const icp = icps[0];
    if (!offer) throw new Error("EDITORIAL_STRATEGY_OFFER_REQUIRED");
    if (!icp) throw new Error("EDITORIAL_STRATEGY_ICP_REQUIRED");
    const claims = await this.database.select().from(offerClaims).where(and(
      eq(offerClaims.workspaceId, workspaceId),
      eq(offerClaims.offerVersionId, offer.id),
    ));
    return {
      offer: {
        id: offer.offerId,
        versionId: offer.id,
        name: offer.name,
        category: offer.category,
        valueProposition: offer.valueProposition,
        targetAudience: offer.targetAudience,
        pricing: offer.pricing,
        commercialRules: offer.commercialRules,
        constraints: offer.constraints,
        objections: offer.objections,
        claims: claims.map((claim) => ({
          id: claim.id,
          claim: claim.claim,
          validationStatus: claim.validationStatus,
          evidenceUri: claim.evidenceUri,
        })),
      },
      icp: {
        id: icp.icpId,
        versionId: icp.id,
        name: icp.name,
        criteria: icp.criteria,
        buyingCommittee: icp.buyingCommittee,
        problems: icp.problems,
        signals: icp.signals,
        exclusions: icp.exclusions,
      },
    };
  }

  async find(workspaceId: string): Promise<EditorialStrategyView | null> {
    const rows = await this.database.select().from(editorialStrategies).where(and(
      eq(editorialStrategies.workspaceId, workspaceId),
      isNull(editorialStrategies.deletedAt),
    )).orderBy(desc(editorialStrategies.updatedAt)).limit(1);
    return rows[0] ? toStrategy(rows[0]) : null;
  }

  async findRequest(input: { workspaceId: string; operation: string; requestKey: string }): Promise<EditorialStrategyView | EditorialStrategyVersionView | null> {
    const rows = await this.database.select().from(contentOperationRequests).where(and(
      eq(contentOperationRequests.workspaceId, input.workspaceId),
      eq(contentOperationRequests.operation, input.operation),
      eq(contentOperationRequests.requestKey, input.requestKey),
    )).limit(1);
    const request = rows[0];
    if (!request) return null;
    if (request.resourceType === "EditorialStrategyVersion") {
      const versions = await this.database.select().from(editorialStrategyVersions).where(and(
        eq(editorialStrategyVersions.workspaceId, input.workspaceId),
        eq(editorialStrategyVersions.id, request.resourceId),
      )).limit(1);
      return versions[0] ? toVersion(versions[0]) : null;
    }
    const strategies = await this.database.select().from(editorialStrategies).where(and(
      eq(editorialStrategies.workspaceId, input.workspaceId),
      eq(editorialStrategies.id, request.resourceId),
    )).limit(1);
    return strategies[0] ? toStrategy(strategies[0]) : null;
  }

  async saveDerived(input: Parameters<EditorialStrategyRepository["saveDerived"]>[0]): Promise<EditorialStrategyView> {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:editorial-strategy`}, 0))`);
      const replay = await tx.select().from(contentOperationRequests).where(and(
        eq(contentOperationRequests.workspaceId, input.workspaceId),
        eq(contentOperationRequests.operation, "strategy.derive"),
        eq(contentOperationRequests.requestKey, input.requestKey),
      )).limit(1);
      if (replay[0]) {
        const current = await tx.select().from(editorialStrategies).where(and(
          eq(editorialStrategies.workspaceId, input.workspaceId),
          eq(editorialStrategies.id, replay[0].resourceId),
        )).limit(1);
        if (current[0]) return toStrategy(current[0]);
      }
      const existing = await tx.select().from(editorialStrategies).where(and(
        eq(editorialStrategies.workspaceId, input.workspaceId),
        eq(editorialStrategies.offerId, input.grounding.offer.id),
        eq(editorialStrategies.icpId, input.grounding.icp.id),
        isNull(editorialStrategies.deletedAt),
      )).limit(1);
      const now = new Date();
      const values = {
        workspaceId: input.workspaceId,
        name: `${input.grounding.offer.name} · ${input.grounding.icp.name}`,
        offerId: input.grounding.offer.id,
        offerVersionId: input.grounding.offer.versionId,
        icpId: input.grounding.icp.id,
        icpVersionId: input.grounding.icp.versionId,
        draft: input.snapshot,
        provider: input.derivation.provider,
        model: input.derivation.model,
        promptVersion: input.derivation.promptVersion,
        aiRunId: input.derivation.aiRunId,
        updatedAt: now,
      };
      const saved = existing[0]
        ? (await tx.update(editorialStrategies).set(values).where(eq(editorialStrategies.id, existing[0].id)).returning())[0]!
        : (await tx.insert(editorialStrategies).values({ id: crypto.randomUUID(), createdBy: input.userId, ...values }).returning())[0]!;
      await tx.insert(contentOperationRequests).values({
        workspaceId: input.workspaceId,
        operation: "strategy.derive",
        requestKey: input.requestKey,
        resourceType: "EditorialStrategy",
        resourceId: saved.id,
        response: { strategyId: saved.id },
      });
      await appendEvent(tx, {
        workspaceId: input.workspaceId,
        userId: input.userId,
        strategyId: saved.id,
        eventType: "EditorialStrategyDerived",
        changes: { offerVersionId: saved.offerVersionId, icpVersionId: saved.icpVersionId, model: saved.model },
      });
      return toStrategy(saved);
    });
  }

  async updateDraft(input: Parameters<EditorialStrategyRepository["updateDraft"]>[0]): Promise<EditorialStrategyView> {
    return this.database.transaction(async (tx) => {
      const current = await tx.select().from(editorialStrategies).where(and(
        eq(editorialStrategies.workspaceId, input.workspaceId),
        isNull(editorialStrategies.deletedAt),
      )).orderBy(desc(editorialStrategies.updatedAt)).limit(1);
      if (!current[0]) throw new Error("EDITORIAL_STRATEGY_NOT_FOUND");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${current[0].id}, 0))`);
      const replay = await tx.select().from(contentOperationRequests).where(and(
        eq(contentOperationRequests.workspaceId, input.workspaceId),
        eq(contentOperationRequests.operation, "strategy.update"),
        eq(contentOperationRequests.requestKey, input.requestKey),
      )).limit(1);
      if (replay[0]) {
        const retained = await tx.select().from(editorialStrategies).where(and(
          eq(editorialStrategies.workspaceId, input.workspaceId),
          eq(editorialStrategies.id, replay[0].resourceId),
        )).limit(1);
        if (retained[0]) return toStrategy(retained[0]);
      }
      const saved = (await tx.update(editorialStrategies).set({ draft: input.snapshot, updatedAt: new Date() })
        .where(and(eq(editorialStrategies.workspaceId, input.workspaceId), eq(editorialStrategies.id, current[0].id))).returning())[0]!;
      await tx.insert(contentOperationRequests).values({ workspaceId: input.workspaceId, operation: "strategy.update", requestKey: input.requestKey, resourceType: "EditorialStrategy", resourceId: saved.id, response: { strategyId: saved.id } });
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: input.userId, strategyId: saved.id, eventType: "EditorialStrategyDraftUpdated", changes: {} });
      return toStrategy(saved);
    });
  }

  async publish(input: Parameters<EditorialStrategyRepository["publish"]>[0]): Promise<EditorialStrategyVersionView> {
    return this.database.transaction(async (tx) => {
      const strategies = await tx.select().from(editorialStrategies).where(and(
        eq(editorialStrategies.workspaceId, input.workspaceId),
        isNull(editorialStrategies.deletedAt),
      )).orderBy(desc(editorialStrategies.updatedAt)).limit(1);
      const strategy = strategies[0];
      if (!strategy) throw new Error("EDITORIAL_STRATEGY_NOT_FOUND");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${strategy.id}, 0))`);
      const replay = await tx.select().from(contentOperationRequests).where(and(
        eq(contentOperationRequests.workspaceId, input.workspaceId),
        eq(contentOperationRequests.operation, "strategy.publish"),
        eq(contentOperationRequests.requestKey, input.requestKey),
      )).limit(1);
      if (replay[0]) {
        const retained = await tx.select().from(editorialStrategyVersions).where(and(
          eq(editorialStrategyVersions.workspaceId, input.workspaceId),
          eq(editorialStrategyVersions.id, replay[0].resourceId),
        )).limit(1);
        if (retained[0]) return toVersion(retained[0]);
      }
      const current = (await tx.select().from(editorialStrategies).where(and(
        eq(editorialStrategies.workspaceId, input.workspaceId),
        eq(editorialStrategies.id, strategy.id),
        isNull(editorialStrategies.deletedAt),
      )).limit(1))[0];
      if (!current) throw new Error("EDITORIAL_STRATEGY_NOT_FOUND");
      const latest = await tx.select().from(editorialStrategyVersions).where(and(
        eq(editorialStrategyVersions.workspaceId, input.workspaceId),
        eq(editorialStrategyVersions.strategyId, current.id),
      )).orderBy(desc(editorialStrategyVersions.version)).limit(1);
      const latestVersion = latest[0];
      let version = latestVersion;
      if (!latestVersion || JSON.stringify(latestVersion.snapshot) !== JSON.stringify(current.draft)) {
        version = (await tx.insert(editorialStrategyVersions).values({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          strategyId: current.id,
          version: (latestVersion?.version ?? 0) + 1,
          offerVersionId: current.offerVersionId,
          icpVersionId: current.icpVersionId,
          snapshot: current.draft,
          provider: current.provider,
          model: current.model,
          promptVersion: current.promptVersion,
          aiRunId: current.aiRunId,
          publishedBy: input.userId,
          publishedAt: new Date(),
        }).returning())[0]!;
        await tx.update(editorialStrategies).set({ status: "active", currentVersion: version.version, updatedAt: version.publishedAt }).where(eq(editorialStrategies.id, current.id));
        await appendEvent(tx, { workspaceId: input.workspaceId, userId: input.userId, strategyId: current.id, eventType: "EditorialStrategyVersionPublished", changes: { version: version.version, versionId: version.id } });
      }
      await tx.insert(contentOperationRequests).values({ workspaceId: input.workspaceId, operation: "strategy.publish", requestKey: input.requestKey, resourceType: "EditorialStrategyVersion", resourceId: version!.id, response: { strategyVersionId: version!.id } });
      return toVersion(version!);
    });
  }
}

function toStrategy(row: typeof editorialStrategies.$inferSelect): EditorialStrategyView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    offerId: row.offerId,
    offerVersionId: row.offerVersionId,
    icpId: row.icpId,
    icpVersionId: row.icpVersionId,
    currentVersion: row.currentVersion,
    draft: editorialStrategySnapshotSchema.parse(row.draft),
    derivation: { provider: row.provider, model: row.model, promptVersion: row.promptVersion, aiRunId: row.aiRunId },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toVersion(row: typeof editorialStrategyVersions.$inferSelect): EditorialStrategyVersionView {
  return {
    id: row.id,
    strategyId: row.strategyId,
    version: row.version,
    snapshot: editorialStrategySnapshotSchema.parse(row.snapshot),
    offerVersionId: row.offerVersionId,
    icpVersionId: row.icpVersionId,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    aiRunId: row.aiRunId,
    publishedAt: row.publishedAt,
  };
}

async function appendEvent(tx: any, input: { workspaceId: string; userId: string; strategyId: string; eventType: string; changes: unknown }) {
  const events = await tx.insert(outboxEvents).values({
    workspaceId: input.workspaceId,
    aggregateType: "EditorialStrategy",
    aggregateId: input.strategyId,
    eventType: input.eventType,
    payload: { type: input.eventType, strategyId: input.strategyId, workspaceId: input.workspaceId, ...input.changes as object },
  }).returning({ id: outboxEvents.id });
  if (events[0]) await tx.insert(auditLogs).values({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: input.eventType,
    subjectType: "EditorialStrategy",
    subjectId: input.strategyId,
    changes: input.changes,
    sourceEventId: events[0].id,
  });
}
