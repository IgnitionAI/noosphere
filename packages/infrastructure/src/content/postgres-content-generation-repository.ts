import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  ContentAssetVersionView,
  ContentAssetView,
  ContentGenerationContext,
  ContentGenerationRepository,
  ContentGenerationRunView,
} from "@outbound/application/content/content-generation";
import {
  CONTENT_GENERATION_JOB_PRIORITY,
  CONTENT_GENERATION_JOB_TYPE,
} from "@outbound/application/content/content-generation";
import type { ContentIdeaEvidence, ContentIdeaView } from "@outbound/application/content/content-ideas";
import type { ContentIdeaStatus } from "@outbound/domain/content/content-idea";
import type { ContentGenerationStage, ContentGenerationStatus } from "@outbound/domain/content/content-asset";
import {
  contentBriefSnapshotSchema,
  contentDraftSnapshotSchema,
  contentEditorialCritiqueSchema,
  contentEvidenceAuditSchema,
  editorialStrategySnapshotSchema,
} from "@outbound/contracts/content";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  contentAssets,
  contentAssetVersions,
  contentBriefs,
  contentGenerationRuns,
  contentIdeaSources,
  contentIdeas,
  contentOperationRequests,
  contentPublications,
  editorialStrategyVersions,
  jobs,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

export class PostgresContentGenerationRepository implements ContentGenerationRepository {
  constructor(private readonly database: Database) {}

  async findRequest(input: Parameters<ContentGenerationRepository["findRequest"]>[0]): Promise<ContentGenerationRunView | null> {
    const requests = await this.database.select().from(contentOperationRequests).where(and(
      eq(contentOperationRequests.workspaceId, input.workspaceId),
      eq(contentOperationRequests.operation, input.operation),
      eq(contentOperationRequests.requestKey, input.requestKey),
    )).limit(1);
    return requests[0] ? this.findRun({ workspaceId: input.workspaceId, runId: requests[0].resourceId }) : null;
  }

  async createGeneration(input: Parameters<ContentGenerationRepository["createGeneration"]>[0]): Promise<ContentGenerationRunView> {
    return this.database.transaction(async (tx) => {
      const lockKey = input.ideaId ?? input.assetId;
      if (!lockKey) throw new Error("CONTENT_GENERATION_TARGET_REQUIRED");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${lockKey}`}, 0))`);
      const replay = await tx.select().from(contentOperationRequests).where(and(
        eq(contentOperationRequests.workspaceId, input.workspaceId),
        eq(contentOperationRequests.operation, input.operation),
        eq(contentOperationRequests.requestKey, input.requestKey),
      )).limit(1);
      if (replay[0]) {
        const retained = await tx.select().from(contentGenerationRuns).where(and(
          eq(contentGenerationRuns.workspaceId, input.workspaceId),
          eq(contentGenerationRuns.id, replay[0].resourceId),
        )).limit(1);
        if (retained[0]) return toRun(retained[0]);
      }

      let asset = input.assetId
        ? (await tx.select().from(contentAssets).where(and(eq(contentAssets.workspaceId, input.workspaceId), eq(contentAssets.id, input.assetId))).limit(1))[0]
        : undefined;
      const ideaId = input.ideaId ?? asset?.ideaId;
      if (!ideaId) throw new Error("CONTENT_ASSET_NOT_FOUND");
      const idea = (await tx.select().from(contentIdeas).where(and(eq(contentIdeas.workspaceId, input.workspaceId), eq(contentIdeas.id, ideaId))).limit(1))[0];
      if (!idea) throw new Error("CONTENT_IDEA_NOT_FOUND");
      if (idea.status === "discarded" || idea.status === "expired") throw new Error("CONTENT_IDEA_NOT_GENERATABLE");
      const sources = await tx.select({ id: contentIdeaSources.id }).from(contentIdeaSources).where(and(
        eq(contentIdeaSources.workspaceId, input.workspaceId),
        eq(contentIdeaSources.ideaId, idea.id),
      )).limit(1);
      if (sources.length === 0) throw new Error("CONTENT_IDEA_EVIDENCE_REQUIRED");

      if (!asset) {
        asset = (await tx.insert(contentAssets).values({
          id: crypto.randomUUID(), workspaceId: input.workspaceId, ideaId: idea.id, type: "linkedin_text", status: "draft", createdAt: input.now, updatedAt: input.now,
        }).onConflictDoNothing({ target: [contentAssets.workspaceId, contentAssets.ideaId, contentAssets.type] }).returning())[0];
        if (!asset) asset = (await tx.select().from(contentAssets).where(and(
          eq(contentAssets.workspaceId, input.workspaceId), eq(contentAssets.ideaId, idea.id), eq(contentAssets.type, "linkedin_text"),
        )).limit(1))[0];
      }
      if (!asset) throw new Error("CONTENT_ASSET_CREATION_FAILED");

      const runId = crypto.randomUUID();
      const run = (await tx.insert(contentGenerationRuns).values({
        id: runId,
        workspaceId: input.workspaceId,
        ideaId: idea.id,
        assetId: asset.id,
        strategyVersionId: idea.strategyVersionId,
        status: "queued",
        stage: "brief",
        instruction: input.instruction?.trim() || null,
        createdBy: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      }).returning())[0]!;
      await tx.insert(contentOperationRequests).values({
        workspaceId: input.workspaceId,
        operation: input.operation,
        requestKey: input.requestKey,
        resourceType: "ContentGenerationRun",
        resourceId: runId,
        response: { runId, assetId: asset.id },
      });
      await tx.insert(jobs).values({
        id: crypto.randomUUID(), workspaceId: input.workspaceId, type: CONTENT_GENERATION_JOB_TYPE,
        payload: { runId }, idempotencyKey: `content-generation:${runId}:v1`, correlationId: `content-generation:${runId}`,
        maxAttempts: 4, priority: CONTENT_GENERATION_JOB_PRIORITY, availableAt: input.now, createdAt: input.now, updatedAt: input.now,
      });
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: input.userId, runId, eventType: "ContentGenerationScheduled", changes: { ideaId: idea.id, assetId: asset.id, operation: input.operation } });
      return toRun(run);
    });
  }

  async findRun(input: { workspaceId: string; runId: string }): Promise<ContentGenerationRunView | null> {
    const rows = await this.database.select().from(contentGenerationRuns).where(and(
      eq(contentGenerationRuns.workspaceId, input.workspaceId), eq(contentGenerationRuns.id, input.runId),
    )).limit(1);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findIdea(input: { workspaceId: string; ideaId: string }): Promise<ContentIdeaView | null> {
    const rows = await this.database.select().from(contentIdeas).where(and(eq(contentIdeas.workspaceId, input.workspaceId), eq(contentIdeas.id, input.ideaId))).limit(1);
    if (!rows[0]) return null;
    const sources = await this.database.select().from(contentIdeaSources).where(and(eq(contentIdeaSources.workspaceId, input.workspaceId), eq(contentIdeaSources.ideaId, input.ideaId))).orderBy(desc(contentIdeaSources.collectedAt));
    return toIdea(rows[0], sources.map(toEvidence));
  }

  async findAssetByIdea(input: { workspaceId: string; ideaId: string }): Promise<ContentAssetView | null> {
    const assets = await this.database.select().from(contentAssets).where(and(eq(contentAssets.workspaceId, input.workspaceId), eq(contentAssets.ideaId, input.ideaId), eq(contentAssets.type, "linkedin_text"))).limit(1);
    const asset = assets[0];
    if (!asset) return null;
    const versions = await this.database.select().from(contentAssetVersions).where(and(eq(contentAssetVersions.workspaceId, input.workspaceId), eq(contentAssetVersions.assetId, asset.id))).orderBy(desc(contentAssetVersions.version)).limit(1);
    return toAsset(asset, versions[0] ? toVersion(versions[0]) : null);
  }

  async loadContext(input: { workspaceId: string; runId: string }): Promise<ContentGenerationContext> {
    const rows = await this.database.select({ run: contentGenerationRuns, idea: contentIdeas, strategy: editorialStrategyVersions.snapshot })
      .from(contentGenerationRuns)
      .innerJoin(contentIdeas, and(eq(contentIdeas.workspaceId, contentGenerationRuns.workspaceId), eq(contentIdeas.id, contentGenerationRuns.ideaId)))
      .innerJoin(editorialStrategyVersions, and(eq(editorialStrategyVersions.workspaceId, contentGenerationRuns.workspaceId), eq(editorialStrategyVersions.id, contentGenerationRuns.strategyVersionId)))
      .where(and(eq(contentGenerationRuns.workspaceId, input.workspaceId), eq(contentGenerationRuns.id, input.runId))).limit(1);
    const current = rows[0];
    if (!current) throw new Error("CONTENT_GENERATION_RUN_NOT_FOUND");
    const sourceRows = await this.database.select().from(contentIdeaSources).where(and(eq(contentIdeaSources.workspaceId, input.workspaceId), eq(contentIdeaSources.ideaId, current.idea.id))).orderBy(desc(contentIdeaSources.collectedAt));
    const recent = await this.database.select({
      body: contentAssetVersions.body,
      publishedAt: contentPublications.publishedAt,
    }).from(contentAssetVersions)
      .innerJoin(contentPublications, and(
        eq(contentPublications.workspaceId, contentAssetVersions.workspaceId),
        eq(contentPublications.assetVersionId, contentAssetVersions.id),
      ))
      .where(and(
        eq(contentAssetVersions.workspaceId, input.workspaceId),
        eq(contentPublications.status, "published"),
      ))
      .orderBy(desc(contentPublications.publishedAt))
      .limit(24);
    const evidence = sourceRows.map(toEvidence);
    const recentBodies = [...new Set(recent.map((item) => item.body))].slice(0, 12);
    return {
      run: toRun(current.run),
      idea: toIdea(current.idea, evidence),
      strategy: editorialStrategySnapshotSchema.parse(current.strategy),
      evidence,
      recentBodies,
      brief: current.run.briefSnapshot ? contentBriefSnapshotSchema.parse(current.run.briefSnapshot) : null,
      draft: current.run.draftSnapshot ? contentDraftSnapshotSchema.parse(current.run.draftSnapshot) : null,
      audit: current.run.auditSnapshot ? contentEvidenceAuditSchema.parse(current.run.auditSnapshot) : null,
      critique: current.run.critiqueSnapshot ? contentEditorialCritiqueSchema.parse(current.run.critiqueSnapshot) : null,
    };
  }

  async startRun(input: { workspaceId: string; runId: string; now: Date }): Promise<void> {
    await this.database.update(contentGenerationRuns).set({
      status: "running", startedAt: sql`coalesce(${contentGenerationRuns.startedAt}, ${input.now.toISOString()}::timestamptz)`, updatedAt: input.now,
    }).where(and(eq(contentGenerationRuns.workspaceId, input.workspaceId), eq(contentGenerationRuns.id, input.runId), sql`${contentGenerationRuns.status} in ('queued', 'running')`));
  }

  async saveBrief(input: Parameters<ContentGenerationRepository["saveBrief"]>[0]): Promise<void> {
    await this.database.transaction(async (tx) => {
      const run = (await tx.select().from(contentGenerationRuns).where(and(eq(contentGenerationRuns.workspaceId, input.workspaceId), eq(contentGenerationRuns.id, input.runId))).limit(1).for("update"))[0];
      if (!run) throw new Error("CONTENT_GENERATION_RUN_NOT_FOUND");
      if (stageAfter(run.stage as ContentGenerationStage, "brief")) return;
      const evidence = await tx.select({ key: contentIdeaSources.sourceRef, type: contentIdeaSources.type, hash: contentIdeaSources.contentHash }).from(contentIdeaSources).where(and(eq(contentIdeaSources.workspaceId, input.workspaceId), eq(contentIdeaSources.ideaId, run.ideaId)));
      await tx.insert(contentBriefs).values({
        id: crypto.randomUUID(), workspaceId: input.workspaceId, runId: run.id, ideaId: run.ideaId, strategyVersionId: run.strategyVersionId,
        snapshot: input.brief, evidenceSnapshot: evidence.map((item) => ({ key: `${item.type}:${item.key}`, contentHash: item.hash })), createdAt: input.now,
      }).onConflictDoNothing({ target: [contentBriefs.workspaceId, contentBriefs.runId] });
      await tx.update(contentGenerationRuns).set({ briefSnapshot: input.brief, stage: "writer", updatedAt: input.now }).where(and(eq(contentGenerationRuns.workspaceId, input.workspaceId), eq(contentGenerationRuns.id, run.id)));
      await tx.update(contentIdeas).set({ status: "briefed", updatedAt: input.now }).where(and(eq(contentIdeas.workspaceId, input.workspaceId), eq(contentIdeas.id, run.ideaId)));
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: null, runId: run.id, eventType: "ContentBriefCreated", changes: { evidenceCount: input.brief.evidenceKeys.length } });
    });
  }

  async saveDraft(input: Parameters<ContentGenerationRepository["saveDraft"]>[0]): Promise<void> {
    await this.advance(input.workspaceId, input.runId, "writer", { draftSnapshot: input.draft, stage: "audit", updatedAt: input.now }, "ContentDraftWritten", input.now);
  }

  async reviseDraftAfterAudit(input: Parameters<ContentGenerationRepository["reviseDraftAfterAudit"]>[0]): Promise<void> {
    await this.advance(input.workspaceId, input.runId, "audit", { draftSnapshot: input.draft, auditSnapshot: null, updatedAt: input.now }, "ContentDraftRepairedAfterAudit", input.now, "audit");
  }

  async saveAudit(input: Parameters<ContentGenerationRepository["saveAudit"]>[0]): Promise<void> {
    await this.advance(input.workspaceId, input.runId, "audit", { auditSnapshot: input.audit, stage: "critic", updatedAt: input.now }, "ContentEvidenceAudited", input.now);
  }

  async completeRun(input: Parameters<ContentGenerationRepository["completeRun"]>[0]): Promise<void> {
    await this.database.transaction(async (tx) => {
      const run = (await tx.select().from(contentGenerationRuns).where(and(eq(contentGenerationRuns.workspaceId, input.workspaceId), eq(contentGenerationRuns.id, input.runId))).limit(1).for("update"))[0];
      if (!run) throw new Error("CONTENT_GENERATION_RUN_NOT_FOUND");
      if (run.stage === "completed") return;
      if (!run.draftSnapshot || !run.auditSnapshot) throw new Error("CONTENT_GENERATION_CHECKPOINT_MISSING");
      const brief = (await tx.select().from(contentBriefs).where(and(eq(contentBriefs.workspaceId, input.workspaceId), eq(contentBriefs.runId, run.id))).limit(1))[0];
      if (!brief) throw new Error("CONTENT_BRIEF_CHECKPOINT_MISSING");
      const asset = (await tx.select().from(contentAssets).where(and(eq(contentAssets.workspaceId, input.workspaceId), eq(contentAssets.id, run.assetId))).limit(1).for("update"))[0];
      if (!asset) throw new Error("CONTENT_ASSET_NOT_FOUND");
      const versionId = crypto.randomUUID();
      const version = asset.latestVersion + 1;
      const draft = contentDraftSnapshotSchema.parse(run.draftSnapshot);
      const audit = contentEvidenceAuditSchema.parse(run.auditSnapshot);
      await tx.insert(contentAssetVersions).values({
        id: versionId, workspaceId: input.workspaceId, assetId: asset.id, briefId: brief.id, generationRunId: run.id,
        version, body: draft.body, draft, audit, critique: input.critique, readiness: input.readiness, ready: input.readiness.ready, createdAt: input.now,
      }).onConflictDoNothing({ target: [contentAssetVersions.workspaceId, contentAssetVersions.generationRunId] });
      await tx.update(contentAssets).set({ status: input.readiness.ready ? "ready" : "blocked", latestVersion: version, updatedAt: input.now }).where(and(eq(contentAssets.workspaceId, input.workspaceId), eq(contentAssets.id, asset.id)));
      await tx.update(contentGenerationRuns).set({
        status: input.readiness.ready ? "ready" : "blocked", stage: "completed", critiqueSnapshot: input.critique,
        assetVersionId: versionId, completedAt: input.now, updatedAt: input.now,
      }).where(and(eq(contentGenerationRuns.workspaceId, input.workspaceId), eq(contentGenerationRuns.id, run.id)));
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: null, runId: run.id, eventType: input.readiness.ready ? "ContentAssetReady" : "ContentAssetBlocked", changes: { assetId: asset.id, versionId, version, blockers: input.readiness.blockers } });
    });
  }

  async failRun(input: Parameters<ContentGenerationRepository["failRun"]>[0]): Promise<void> {
    await this.database.update(contentGenerationRuns).set({
      status: "failed", lastErrorCode: input.code, lastErrorMessage: input.message.slice(0, 4_000), completedAt: input.now, updatedAt: input.now,
    }).where(and(eq(contentGenerationRuns.workspaceId, input.workspaceId), eq(contentGenerationRuns.id, input.runId), sql`${contentGenerationRuns.status} in ('queued', 'running')`));
  }

  private async advance(workspaceId: string, runId: string, expected: ContentGenerationStage, values: Record<string, unknown>, eventType: string, now: Date, resultingStage?: ContentGenerationStage): Promise<void> {
    await this.database.transaction(async (tx) => {
      const run = (await tx.select().from(contentGenerationRuns).where(and(eq(contentGenerationRuns.workspaceId, workspaceId), eq(contentGenerationRuns.id, runId))).limit(1).for("update"))[0];
      if (!run) throw new Error("CONTENT_GENERATION_RUN_NOT_FOUND");
      if (stageAfter(run.stage as ContentGenerationStage, expected)) return;
      if (run.stage !== expected) throw new Error("CONTENT_GENERATION_STAGE_CONFLICT");
      await tx.update(contentGenerationRuns).set({ ...values, ...(resultingStage ? { stage: resultingStage } : {}) }).where(and(eq(contentGenerationRuns.workspaceId, workspaceId), eq(contentGenerationRuns.id, runId)));
      await appendEvent(tx, { workspaceId, userId: null, runId, eventType, changes: { at: now.toISOString() } });
    });
  }
}

function toRun(row: typeof contentGenerationRuns.$inferSelect): ContentGenerationRunView {
  return {
    id: row.id, workspaceId: row.workspaceId, ideaId: row.ideaId, assetId: row.assetId, assetVersionId: row.assetVersionId,
    status: row.status as ContentGenerationStatus, stage: row.stage as ContentGenerationStage, instruction: row.instruction,
    lastErrorCode: row.lastErrorCode, lastErrorMessage: row.lastErrorMessage, createdAt: row.createdAt, completedAt: row.completedAt,
  };
}

function toIdea(row: typeof contentIdeas.$inferSelect, sources: readonly ContentIdeaEvidence[]): ContentIdeaView {
  return { id: row.id, workspaceId: row.workspaceId, strategyVersionId: row.strategyVersionId, status: row.status as ContentIdeaStatus, angle: row.angle, rationale: row.rationale, audience: row.audience, pillar: row.pillar, priority: row.priority, freshnessUntil: row.freshnessUntil, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, sources };
}

function toEvidence(row: typeof contentIdeaSources.$inferSelect): ContentIdeaEvidence {
  return { key: `${row.type}:${row.sourceRef}`, type: row.type as ContentIdeaEvidence["type"], sourceRef: row.sourceRef, canonicalUrl: row.canonicalUrl, title: row.title, excerpt: row.excerpt, contentHash: row.contentHash, collectedAt: row.collectedAt };
}

function toVersion(row: typeof contentAssetVersions.$inferSelect): ContentAssetVersionView {
  const readiness = row.readiness as { ready?: unknown; blockers?: unknown };
  return {
    id: row.id, assetId: row.assetId, briefId: row.briefId, version: row.version, body: row.body,
    draft: contentDraftSnapshotSchema.parse(row.draft), audit: contentEvidenceAuditSchema.parse(row.audit), critique: contentEditorialCritiqueSchema.parse(row.critique),
    readiness: { ready: readiness.ready === true, blockers: Array.isArray(readiness.blockers) ? readiness.blockers.filter((item): item is string => typeof item === "string") : [] },
    createdAt: row.createdAt,
  };
}

function toAsset(row: typeof contentAssets.$inferSelect, latest: ContentAssetVersionView | null): ContentAssetView {
  return { id: row.id, workspaceId: row.workspaceId, ideaId: row.ideaId, type: "linkedin_text", status: row.status as ContentAssetView["status"], latestVersion: row.latestVersion, latest, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function stageAfter(current: ContentGenerationStage, expected: ContentGenerationStage): boolean {
  return ["brief", "writer", "audit", "critic", "completed"].indexOf(current) > ["brief", "writer", "audit", "critic", "completed"].indexOf(expected);
}

async function appendEvent(tx: any, input: { workspaceId: string; userId: string | null; runId: string; eventType: string; changes: unknown }) {
  const events = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: "ContentGenerationRun", aggregateId: input.runId, eventType: input.eventType, payload: { type: input.eventType, runId: input.runId, workspaceId: input.workspaceId, ...input.changes as object } }).returning({ id: outboxEvents.id });
  if (events[0]) await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: input.eventType, subjectType: "ContentGenerationRun", subjectId: input.runId, changes: input.changes, sourceEventId: events[0].id });
}
