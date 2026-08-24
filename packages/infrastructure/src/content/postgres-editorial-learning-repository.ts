import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type {
  EditorialLearningEvidence,
  EditorialLearningRepository,
  EditorialLearningVersionView,
} from "@outbound/application/content/editorial-learning";
import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  attributionTouches,
  auditLogs,
  contentAssets,
  contentAssetVersions,
  contentIdeaSchedules,
  contentIdeas,
  contentOperationRequests,
  contentPublications,
  editorialLearningVersions,
  editorialStrategies,
  editorialStrategyVersions,
  outboxEvents,
  socialContentItems,
  socialInteractions,
} from "@outbound/infrastructure/database/schema";

const WINDOW_MS = 90 * 24 * 60 * 60_000;

export class PostgresEditorialLearningRepository implements EditorialLearningRepository {
  constructor(private readonly database: Database) {}

  async listEnabledWorkspaces(limit: number): Promise<readonly string[]> {
    const rows = await this.database.selectDistinct({ workspaceId: contentIdeaSchedules.workspaceId })
      .from(contentIdeaSchedules)
      .innerJoin(editorialStrategies, and(
        eq(editorialStrategies.workspaceId, contentIdeaSchedules.workspaceId),
        eq(editorialStrategies.status, "active"),
        isNull(editorialStrategies.deletedAt),
        sql`${editorialStrategies.currentVersion} > 0`,
      ))
      .where(eq(contentIdeaSchedules.enabled, true))
      .orderBy(asc(contentIdeaSchedules.workspaceId))
      .limit(limit);
    return rows.map((row) => row.workspaceId);
  }

  async loadContext(workspaceId: string, now: Date) {
    const strategyRows = await this.database.select({
      strategyId: editorialStrategies.id,
      strategyVersionId: editorialStrategyVersions.id,
      icpVersionId: editorialStrategyVersions.icpVersionId,
      snapshot: editorialStrategyVersions.snapshot,
    }).from(editorialStrategies)
      .innerJoin(editorialStrategyVersions, and(
        eq(editorialStrategyVersions.workspaceId, editorialStrategies.workspaceId),
        eq(editorialStrategyVersions.strategyId, editorialStrategies.id),
        eq(editorialStrategyVersions.version, editorialStrategies.currentVersion),
      ))
      .where(and(
        eq(editorialStrategies.workspaceId, workspaceId),
        eq(editorialStrategies.status, "active"),
        isNull(editorialStrategies.deletedAt),
      )).orderBy(desc(editorialStrategies.updatedAt)).limit(1);
    const current = strategyRows[0];
    if (!current) return null;
    const windowStartedAt = new Date(now.getTime() - WINDOW_MS);
    const baseConditions = and(
      eq(socialInteractions.workspaceId, workspaceId),
      eq(socialInteractions.status, "observed"),
      eq(socialInteractions.direction, "incoming"),
      inArray(socialInteractions.type, ["comment", "reply"]),
      gte(socialInteractions.firstSeenAt, windowStartedAt),
      eq(contentIdeas.strategyVersionId, current.strategyVersionId),
    );
    const responseRows = await this.database.select({
      interactionId: socialInteractions.id,
      type: socialInteractions.type,
      occurredAt: socialInteractions.occurredAt,
      firstSeenAt: socialInteractions.firstSeenAt,
      pillar: contentIdeas.pillar,
      angle: contentIdeas.angle,
    }).from(socialInteractions)
      .innerJoin(socialContentItems, and(eq(socialContentItems.workspaceId, socialInteractions.workspaceId), eq(socialContentItems.id, socialInteractions.socialContentId)))
      .innerJoin(contentPublications, and(eq(contentPublications.workspaceId, socialContentItems.workspaceId), eq(contentPublications.id, socialContentItems.publicationId)))
      .innerJoin(contentAssetVersions, and(eq(contentAssetVersions.workspaceId, contentPublications.workspaceId), eq(contentAssetVersions.id, contentPublications.assetVersionId)))
      .innerJoin(contentAssets, and(eq(contentAssets.workspaceId, contentAssetVersions.workspaceId), eq(contentAssets.id, contentAssetVersions.assetId)))
      .innerJoin(contentIdeas, and(eq(contentIdeas.workspaceId, contentAssets.workspaceId), eq(contentIdeas.id, contentAssets.ideaId)))
      .where(baseConditions)
      .orderBy(asc(socialInteractions.firstSeenAt), asc(socialInteractions.id));
    const bookingRows = await this.database.select({
      interactionId: socialInteractions.id,
      bookingId: attributionTouches.bookingId,
      certainty: attributionTouches.certainty,
      proofHref: attributionTouches.proofHref,
      occurredAt: attributionTouches.occurredAt,
      pillar: contentIdeas.pillar,
      angle: contentIdeas.angle,
    }).from(attributionTouches)
      .innerJoin(socialInteractions, and(eq(socialInteractions.workspaceId, attributionTouches.workspaceId), eq(socialInteractions.id, attributionTouches.socialInteractionId)))
      .innerJoin(socialContentItems, and(eq(socialContentItems.workspaceId, socialInteractions.workspaceId), eq(socialContentItems.id, socialInteractions.socialContentId)))
      .innerJoin(contentPublications, and(eq(contentPublications.workspaceId, socialContentItems.workspaceId), eq(contentPublications.id, socialContentItems.publicationId)))
      .innerJoin(contentAssetVersions, and(eq(contentAssetVersions.workspaceId, contentPublications.workspaceId), eq(contentAssetVersions.id, contentPublications.assetVersionId)))
      .innerJoin(contentAssets, and(eq(contentAssets.workspaceId, contentAssetVersions.workspaceId), eq(contentAssets.id, contentAssetVersions.assetId)))
      .innerJoin(contentIdeas, and(eq(contentIdeas.workspaceId, contentAssets.workspaceId), eq(contentIdeas.id, contentAssets.ideaId)))
      .where(and(baseConditions, eq(attributionTouches.kind, "booking"), eq(attributionTouches.status, "active"), sql`${attributionTouches.bookingId} is not null`))
      .orderBy(asc(attributionTouches.occurredAt), asc(attributionTouches.id));
    const evidence: EditorialLearningEvidence[] = [
      ...responseRows.map((row) => ({
        kind: "response" as const,
        certainty: "fact" as const,
        pillar: row.pillar,
        angle: row.angle,
        sourceRef: `social-interaction:${row.interactionId}`,
        sourceHref: `/attribution?interaction=${row.interactionId}`,
        occurredAt: row.occurredAt ?? row.firstSeenAt,
      })),
      ...bookingRows.map((row) => ({
        kind: "booking" as const,
        certainty: row.certainty === "evidence" ? "fact" as const : "inference" as const,
        pillar: row.pillar,
        angle: row.angle,
        sourceRef: `booking:${row.bookingId}`,
        sourceHref: row.proofHref ?? `/appointments?booking=${row.bookingId}`,
        occurredAt: row.occurredAt,
      })),
    ].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.sourceRef.localeCompare(right.sourceRef));
    return {
      workspaceId,
      strategyId: current.strategyId,
      strategyVersionId: current.strategyVersionId,
      icpVersionId: current.icpVersionId,
      strategy: editorialStrategySnapshotSchema.parse(current.snapshot),
      evidence,
      windowStartedAt,
      windowEndedAt: now,
    };
  }

  async latest(workspaceId: string): Promise<EditorialLearningVersionView | null> {
    const rows = await this.database.select().from(editorialLearningVersions)
      .where(eq(editorialLearningVersions.workspaceId, workspaceId))
      .orderBy(desc(editorialLearningVersions.createdAt), desc(editorialLearningVersions.version)).limit(1);
    return rows[0] ? toView(rows[0]) : null;
  }

  async save(input: Parameters<EditorialLearningRepository["save"]>[0]): Promise<EditorialLearningVersionView> {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.context.workspaceId}:editorial-learning`}, 0))`);
      const replay = await tx.select().from(editorialLearningVersions).where(and(
        eq(editorialLearningVersions.workspaceId, input.context.workspaceId),
        eq(editorialLearningVersions.strategyVersionId, input.context.strategyVersionId),
        eq(editorialLearningVersions.inputHash, input.inputHash),
      )).limit(1);
      if (replay[0]) return toView(replay[0]);
      const latest = await tx.select({ version: editorialLearningVersions.version }).from(editorialLearningVersions).where(and(
        eq(editorialLearningVersions.workspaceId, input.context.workspaceId),
        eq(editorialLearningVersions.strategyId, input.context.strategyId),
      )).orderBy(desc(editorialLearningVersions.version)).limit(1);
      const id = crypto.randomUUID();
      const row = (await tx.insert(editorialLearningVersions).values({
        id,
        workspaceId: input.context.workspaceId,
        strategyId: input.context.strategyId,
        strategyVersionId: input.context.strategyVersionId,
        version: (latest[0]?.version ?? 0) + 1,
        inputHash: input.inputHash,
        facts: input.facts,
        inferences: input.inferences,
        recommendations: input.recommendations,
        bounds: input.bounds,
        modelVersion: input.modelVersion,
        windowStartedAt: input.context.windowStartedAt,
        windowEndedAt: input.context.windowEndedAt,
        createdAt: input.now,
      }).returning())[0]!;
      await tx.insert(contentOperationRequests).values({
        workspaceId: input.context.workspaceId,
        operation: "editorial-learning.derive",
        requestKey: `editorial-learning:${input.context.strategyVersionId}:${input.inputHash}`,
        resourceType: "EditorialLearningVersion",
        resourceId: id,
        response: { version: row.version, recommendationCount: input.recommendations.length },
      });
      const events = await tx.insert(outboxEvents).values({
        workspaceId: input.context.workspaceId,
        aggregateType: "EditorialLearningVersion",
        aggregateId: id,
        eventType: "EditorialLearningVersionDerived",
        payload: { type: "EditorialLearningVersionDerived", workspaceId: input.context.workspaceId, versionId: id, strategyVersionId: input.context.strategyVersionId, recommendationCount: input.recommendations.length },
      }).returning({ id: outboxEvents.id });
      if (events[0]) await tx.insert(auditLogs).values({
        workspaceId: input.context.workspaceId,
        actorUserId: null,
        action: "EditorialLearningVersionDerived",
        subjectType: "EditorialLearningVersion",
        subjectId: id,
        changes: { strategyVersionId: input.context.strategyVersionId, facts: input.facts.length, inferences: input.inferences.length, recommendations: input.recommendations.length, bounds: input.bounds },
        sourceEventId: events[0].id,
      });
      return toView(row);
    });
  }
}

function toView(row: typeof editorialLearningVersions.$inferSelect): EditorialLearningVersionView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    strategyId: row.strategyId,
    strategyVersionId: row.strategyVersionId,
    version: row.version,
    facts: parseEvidence(row.facts),
    inferences: parseEvidence(row.inferences),
    recommendations: row.recommendations as EditorialLearningVersionView["recommendations"],
    bounds: row.bounds as EditorialLearningVersionView["bounds"],
    modelVersion: row.modelVersion,
    windowStartedAt: row.windowStartedAt,
    windowEndedAt: row.windowEndedAt,
    createdAt: row.createdAt,
  };
}

function parseEvidence(value: unknown): readonly EditorialLearningEvidence[] {
  if (!Array.isArray(value)) throw new Error("EDITORIAL_LEARNING_EVIDENCE_INVALID");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("EDITORIAL_LEARNING_EVIDENCE_INVALID");
    const row = item as Record<string, unknown>;
    if (typeof row.occurredAt !== "string") throw new Error("EDITORIAL_LEARNING_EVIDENCE_INVALID");
    return { ...row, occurredAt: new Date(row.occurredAt) } as unknown as EditorialLearningEvidence;
  });
}
