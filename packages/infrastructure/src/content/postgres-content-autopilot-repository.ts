import { and, asc, count, desc, eq, exists, gte, inArray, isNull, like, lte, notExists, sql } from "drizzle-orm";
import type {
  ContentAutopilotRepository,
  ContentAutopilotView,
  ContentAutopilotWorkspace,
} from "@outbound/application/content/content-autopilot";
import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  contentAssets,
  contentAssetVersions,
  contentGenerationRuns,
  contentIdeaDiscoveryRuns,
  contentIdeaSchedules,
  contentIdeaSources,
  contentIdeas,
  contentOperationRequests,
  contentPublications,
  editorialStrategies,
  editorialStrategyVersions,
  jobs,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";
import { CONTENT_PUBLICATION_JOB_TYPE } from "@outbound/application/content/content-publications";
import { firstDailyOccurrence } from "@outbound/infrastructure/campaigns/daily-prospecting-scheduler";

const DEFAULT_TIME = "06:00";
const DEFAULT_TIMEZONE = "Europe/Paris";

export class PostgresContentAutopilotRepository implements ContentAutopilotRepository {
  constructor(private readonly database: Database) {}

  async get(input: { readonly workspaceId: string }): Promise<ContentAutopilotView> {
    const [scheduleRows, queuedIdeas, generatingAssets, failedGenerationRuns, readyAssets, blockedAssets, scheduledPublications, failedPublications, nextPublications] = await Promise.all([
      this.database.select().from(contentIdeaSchedules).where(eq(contentIdeaSchedules.workspaceId, input.workspaceId)).limit(1),
      this.countIdeas(input.workspaceId),
      this.countGenerationRuns(input.workspaceId, ["queued", "running"]),
      this.countGenerationRuns(input.workspaceId, ["failed"]),
      this.countAssets(input.workspaceId, "ready"),
      this.countAssets(input.workspaceId, "blocked"),
      this.countPublications(input.workspaceId, ["scheduled", "retry", "publishing"]),
      this.countPublications(input.workspaceId, ["unknown", "failed"]),
      this.database.select({ scheduledFor: contentPublications.scheduledFor }).from(contentPublications).where(and(
        eq(contentPublications.workspaceId, input.workspaceId),
        sql`${contentPublications.status} in ('scheduled', 'retry')`,
      )).orderBy(asc(contentPublications.scheduledFor)).limit(1),
    ]);
    const schedule = scheduleRows[0];
    return {
      configured: Boolean(schedule),
      enabled: schedule?.enabled ?? false,
      localTime: schedule?.localTime ?? DEFAULT_TIME,
      timezone: schedule?.timezone ?? DEFAULT_TIMEZONE,
      lastRunAt: schedule?.lastRunAt ?? null,
      nextRunAt: schedule?.nextRunAt ?? null,
      nextPublicationAt: nextPublications[0]?.scheduledFor ?? null,
      queuedIdeas,
      generatingAssets,
      readyAssets,
      scheduledPublications,
      blockedAssets,
      exceptions: blockedAssets + failedGenerationRuns + failedPublications,
    };
  }

  async configure(input: Parameters<ContentAutopilotRepository["configure"]>[0]): Promise<ContentAutopilotView> {
    await this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:content-autopilot`}, 0))`);
      const replay = await tx.select({ id: contentOperationRequests.id }).from(contentOperationRequests).where(and(
        eq(contentOperationRequests.workspaceId, input.workspaceId),
        eq(contentOperationRequests.operation, "autopilot.configure"),
        eq(contentOperationRequests.requestKey, input.requestKey),
      )).limit(1);
      if (replay[0]) return;
      const strategy = await tx.select({ id: editorialStrategies.id }).from(editorialStrategies).where(and(
        eq(editorialStrategies.workspaceId, input.workspaceId),
        eq(editorialStrategies.status, "active"),
        isNull(editorialStrategies.deletedAt),
        sql`${editorialStrategies.currentVersion} > 0`,
      )).limit(1);
      if (!strategy[0]) throw new Error("CONTENT_AUTOPILOT_ACTIVE_STRATEGY_REQUIRED");
      const nextRunAt = firstDailyOccurrence(input.now, input.localTime, input.timezone);
      await tx.insert(contentIdeaSchedules).values({
        workspaceId: input.workspaceId,
        enabled: input.enabled,
        localTime: input.localTime,
        timezone: input.timezone,
        nextRunAt,
        createdAt: input.now,
        updatedAt: input.now,
      }).onConflictDoUpdate({
        target: contentIdeaSchedules.workspaceId,
        set: { enabled: input.enabled, localTime: input.localTime, timezone: input.timezone, nextRunAt, updatedAt: input.now },
      });
      let cancelled = 0;
      if (!input.enabled) {
        const pending = await tx.select({ id: contentPublications.id }).from(contentPublications).where(and(
          eq(contentPublications.workspaceId, input.workspaceId),
          sql`${contentPublications.status} in ('scheduled', 'retry')`,
          like(contentPublications.requestKey, "autopilot:publication:%"),
        )).for("update");
        if (pending.length) {
          const ids = pending.map((row) => row.id);
          cancelled = ids.length;
          await tx.update(contentPublications).set({ status: "cancelled", cancelledAt: input.now, updatedAt: input.now }).where(and(
            eq(contentPublications.workspaceId, input.workspaceId),
            inArray(contentPublications.id, ids),
          ));
          await tx.update(jobs).set({ status: "completed", completedAt: input.now, lockedAt: null, lockedUntil: null, lockedBy: null, updatedAt: input.now }).where(and(
            eq(jobs.workspaceId, input.workspaceId),
            eq(jobs.type, CONTENT_PUBLICATION_JOB_TYPE),
            inArray(jobs.idempotencyKey, ids.map((id) => `content-publication:${id}:v1`)),
          ));
        }
      }
      await tx.insert(contentOperationRequests).values({
        workspaceId: input.workspaceId,
        operation: "autopilot.configure",
        requestKey: input.requestKey,
        resourceType: "ContentAutopilot",
        resourceId: input.workspaceId,
        response: { enabled: input.enabled, localTime: input.localTime, timezone: input.timezone, cancelledPublications: cancelled },
      });
      await appendEvent(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        aggregateId: input.workspaceId,
        eventType: input.enabled ? "ContentAutopilotResumed" : "ContentAutopilotPaused",
        changes: { localTime: input.localTime, timezone: input.timezone, cancelledPublications: cancelled },
      });
    });
    return this.get({ workspaceId: input.workspaceId });
  }

  async listEnabled(input: { readonly limit: number }): Promise<readonly ContentAutopilotWorkspace[]> {
    const rows = await this.database.select({
      workspaceId: contentIdeaSchedules.workspaceId,
      strategyVersionId: editorialStrategyVersions.id,
      snapshot: editorialStrategyVersions.snapshot,
    }).from(contentIdeaSchedules)
      .innerJoin(editorialStrategies, and(
        eq(editorialStrategies.workspaceId, contentIdeaSchedules.workspaceId),
        eq(editorialStrategies.status, "active"),
        isNull(editorialStrategies.deletedAt),
        sql`${editorialStrategies.currentVersion} > 0`,
      ))
      .innerJoin(editorialStrategyVersions, and(
        eq(editorialStrategyVersions.workspaceId, editorialStrategies.workspaceId),
        eq(editorialStrategyVersions.strategyId, editorialStrategies.id),
        eq(editorialStrategyVersions.version, editorialStrategies.currentVersion),
      ))
      .where(eq(contentIdeaSchedules.enabled, true))
      .orderBy(asc(contentIdeaSchedules.workspaceId))
      .limit(input.limit);
    return rows.map((row) => ({
      workspaceId: row.workspaceId,
      strategyVersionId: row.strategyVersionId,
      cadence: editorialStrategySnapshotSchema.parse(row.snapshot).cadence,
    }));
  }

  async listGenerationCandidates(input: Parameters<ContentAutopilotRepository["listGenerationCandidates"]>[0]) {
    return this.database.select({ ideaId: contentIdeas.id }).from(contentIdeas).where(and(
      eq(contentIdeas.workspaceId, input.workspaceId),
      eq(contentIdeas.strategyVersionId, input.strategyVersionId),
      sql`${contentIdeas.status} in ('discovered', 'shortlisted')`,
      gte(contentIdeas.freshnessUntil, input.now),
      notExists(this.database.select({ id: contentAssets.id }).from(contentAssets).where(and(
        eq(contentAssets.workspaceId, contentIdeas.workspaceId),
        eq(contentAssets.ideaId, contentIdeas.id),
      ))),
      exists(this.database.select({ id: contentIdeaSources.id }).from(contentIdeaSources)
        .innerJoin(contentIdeaDiscoveryRuns, and(
          eq(contentIdeaDiscoveryRuns.workspaceId, contentIdeaSources.workspaceId),
          eq(contentIdeaDiscoveryRuns.id, contentIdeaSources.runId),
        ))
        .where(and(
          eq(contentIdeaSources.workspaceId, contentIdeas.workspaceId),
          eq(contentIdeaSources.ideaId, contentIdeas.id),
          sql`${contentIdeaDiscoveryRuns.status} in ('completed', 'partial')`,
        ))),
    )).orderBy(desc(contentIdeas.priority), desc(contentIdeas.lastSeenAt), asc(contentIdeas.id)).limit(input.limit);
  }

  async listPublicationCandidates(input: Parameters<ContentAutopilotRepository["listPublicationCandidates"]>[0]) {
    return this.database.select({
      assetId: contentAssets.id,
      assetVersionId: contentAssetVersions.id,
      publicationSequence: sql<number>`1 + (select count(*)::int from ${contentPublications} cancelled where cancelled.workspace_id = ${contentAssets.workspaceId} and cancelled.asset_version_id = ${contentAssetVersions.id} and cancelled.status = 'cancelled' and cancelled.request_key like 'autopilot:publication:%')`.mapWith(Number),
    })
      .from(contentAssets)
      .innerJoin(contentIdeas, and(
        eq(contentIdeas.workspaceId, contentAssets.workspaceId),
        eq(contentIdeas.id, contentAssets.ideaId),
        eq(contentIdeas.strategyVersionId, input.strategyVersionId),
      ))
      .innerJoin(contentAssetVersions, and(
        eq(contentAssetVersions.workspaceId, contentAssets.workspaceId),
        eq(contentAssetVersions.assetId, contentAssets.id),
        eq(contentAssetVersions.version, contentAssets.latestVersion),
        eq(contentAssetVersions.ready, true),
      ))
      .where(and(
        eq(contentAssets.workspaceId, input.workspaceId),
        eq(contentAssets.status, "ready"),
        notExists(this.database.select({ id: contentPublications.id }).from(contentPublications).where(and(
          eq(contentPublications.workspaceId, contentAssets.workspaceId),
          eq(contentPublications.assetVersionId, contentAssetVersions.id),
          sql`${contentPublications.status} <> 'cancelled'`,
        ))),
      )).orderBy(desc(contentIdeas.priority), asc(contentAssets.updatedAt), asc(contentAssets.id)).limit(input.limit);
  }

  async listOccupiedPublicationTimes(input: Parameters<ContentAutopilotRepository["listOccupiedPublicationTimes"]>[0]): Promise<readonly Date[]> {
    const rows = await this.database.select({ scheduledFor: contentPublications.scheduledFor }).from(contentPublications).where(and(
      eq(contentPublications.workspaceId, input.workspaceId),
      sql`${contentPublications.status} in ('scheduled', 'retry', 'publishing', 'published')`,
      gte(contentPublications.scheduledFor, input.from),
      lte(contentPublications.scheduledFor, input.to),
    ));
    return rows.map((row) => row.scheduledFor);
  }

  async recordDeferred(input: Parameters<ContentAutopilotRepository["recordDeferred"]>[0]): Promise<void> {
    await this.database.transaction(async (tx) => {
      const requestKey = `autopilot:deferred:${input.now.toISOString().slice(0, 10)}:${input.assetId}:${input.code}`.slice(0, 300);
      const inserted = await tx.insert(contentOperationRequests).values({
        workspaceId: input.workspaceId,
        operation: "autopilot.defer",
        requestKey,
        resourceType: "ContentAsset",
        resourceId: input.assetId,
        response: { code: input.code, message: input.message.slice(0, 1_000) },
      }).onConflictDoNothing().returning({ id: contentOperationRequests.id });
      if (!inserted[0]) return;
      await appendEvent(tx, {
        workspaceId: input.workspaceId,
        actorUserId: null,
        aggregateId: input.assetId,
        eventType: "ContentAutopilotAssetDeferred",
        changes: { code: input.code, message: input.message.slice(0, 1_000) },
      });
    });
  }

  private async countIdeas(workspaceId: string): Promise<number> {
    const row = (await this.database.select({ value: count() }).from(contentIdeas).where(and(
      eq(contentIdeas.workspaceId, workspaceId),
      sql`${contentIdeas.status} in ('discovered', 'shortlisted')`,
    )))[0];
    return row?.value ?? 0;
  }

  private async countGenerationRuns(workspaceId: string, statuses: readonly string[]): Promise<number> {
    const row = (await this.database.select({ value: count() }).from(contentGenerationRuns).where(and(
      eq(contentGenerationRuns.workspaceId, workspaceId),
      inArray(contentGenerationRuns.status, [...statuses]),
    )))[0];
    return row?.value ?? 0;
  }

  private async countAssets(workspaceId: string, status: "ready" | "blocked"): Promise<number> {
    const row = (await this.database.select({ value: count() }).from(contentAssets).where(and(eq(contentAssets.workspaceId, workspaceId), eq(contentAssets.status, status))))[0];
    return row?.value ?? 0;
  }

  private async countPublications(workspaceId: string, statuses: readonly string[]): Promise<number> {
    const row = (await this.database.select({ value: count() }).from(contentPublications).where(and(
      eq(contentPublications.workspaceId, workspaceId),
      inArray(contentPublications.status, [...statuses]),
    )))[0];
    return row?.value ?? 0;
  }
}

async function appendEvent(tx: any, input: { workspaceId: string; actorUserId: string | null; aggregateId: string; eventType: string; changes: unknown }) {
  const events = await tx.insert(outboxEvents).values({
    workspaceId: input.workspaceId,
    aggregateType: "ContentAutopilot",
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload: { type: input.eventType, workspaceId: input.workspaceId, ...input.changes as object },
  }).returning({ id: outboxEvents.id });
  if (events[0]) await tx.insert(auditLogs).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: input.eventType,
    subjectType: "ContentAutopilot",
    subjectId: input.aggregateId,
    changes: input.changes,
    sourceEventId: events[0].id,
  });
}
