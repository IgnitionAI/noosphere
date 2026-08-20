import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type {
  ContentIdeaDiscoveryContext,
  ContentIdeaDiscoveryRunView,
  ContentIdeaEvidence,
  ContentIdeaRepository,
  ContentIdeaView,
} from "@outbound/application/content/content-ideas";
import { CONTENT_IDEA_DISCOVERY_JOB_TYPE } from "@outbound/application/content/content-ideas";
import type { ContentIdeaStatus } from "@outbound/domain/content/content-idea";
import { normalizeIdeaConcept } from "@outbound/domain/content/content-idea";
import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  contentIdeaDiscoveryRuns,
  contentIdeaSources,
  contentIdeas,
  contentOperationRequests,
  conversations,
  editorialStrategies,
  editorialStrategyVersions,
  jobs,
  knowledgeClaims,
  knowledgeClaimSources,
  knowledgeSources,
  messages,
  offerClaims,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

const DEFAULT_QUERY_LIMIT = 6;
const DEFAULT_SOURCE_LIMIT = 40;
const DEFAULT_DURATION_MS = 5 * 60_000;

export class PostgresContentIdeaRepository implements ContentIdeaRepository {
  constructor(private readonly database: Database) {}

  async findRequest(input: { workspaceId: string; requestKey: string }): Promise<ContentIdeaDiscoveryRunView | null> {
    const requests = await this.database.select().from(contentOperationRequests).where(and(
      eq(contentOperationRequests.workspaceId, input.workspaceId),
      eq(contentOperationRequests.operation, "ideas.discover"),
      eq(contentOperationRequests.requestKey, input.requestKey),
    )).limit(1);
    return requests[0] ? this.findRun({ workspaceId: input.workspaceId, runId: requests[0].resourceId }) : null;
  }

  async createDiscovery(input: Parameters<ContentIdeaRepository["createDiscovery"]>[0]): Promise<ContentIdeaDiscoveryRunView> {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:content-ideas`}, 0))`);
      const replay = await tx.select().from(contentOperationRequests).where(and(
        eq(contentOperationRequests.workspaceId, input.workspaceId),
        eq(contentOperationRequests.operation, "ideas.discover"),
        eq(contentOperationRequests.requestKey, input.requestKey),
      )).limit(1);
      if (replay[0]) {
        const retained = await tx.select().from(contentIdeaDiscoveryRuns).where(and(
          eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId),
          eq(contentIdeaDiscoveryRuns.id, replay[0].resourceId),
        )).limit(1);
        if (retained[0]) return toRun(retained[0]);
      }
      const existing = await tx.select().from(contentIdeaDiscoveryRuns).where(and(
        eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId),
        sql`${contentIdeaDiscoveryRuns.status} in ('queued', 'running')`,
      )).orderBy(desc(contentIdeaDiscoveryRuns.createdAt)).limit(1);
      if (existing[0]) {
        await tx.insert(contentOperationRequests).values({
          workspaceId: input.workspaceId,
          operation: "ideas.discover",
          requestKey: input.requestKey,
          resourceType: "ContentIdeaDiscoveryRun",
          resourceId: existing[0].id,
          response: { runId: existing[0].id, replayedActiveRun: true },
        });
        return toRun(existing[0]);
      }
      const strategies = await tx.select({
        id: editorialStrategies.id,
        currentVersion: editorialStrategies.currentVersion,
      }).from(editorialStrategies).where(and(
        eq(editorialStrategies.workspaceId, input.workspaceId),
        eq(editorialStrategies.status, "active"),
        isNull(editorialStrategies.deletedAt),
      )).orderBy(desc(editorialStrategies.updatedAt)).limit(1);
      const strategy = strategies[0];
      if (!strategy || strategy.currentVersion < 1) throw new Error("CONTENT_IDEA_ACTIVE_STRATEGY_REQUIRED");
      const versions = await tx.select().from(editorialStrategyVersions).where(and(
        eq(editorialStrategyVersions.workspaceId, input.workspaceId),
        eq(editorialStrategyVersions.strategyId, strategy.id),
        eq(editorialStrategyVersions.version, strategy.currentVersion),
      )).limit(1);
      const version = versions[0];
      if (!version) throw new Error("CONTENT_IDEA_ACTIVE_STRATEGY_REQUIRED");
      const snapshot = editorialStrategySnapshotSchema.parse(version.snapshot);
      const queryPlan = buildQueryPlan(snapshot).slice(0, DEFAULT_QUERY_LIMIT);
      if (queryPlan.length === 0) throw new Error("CONTENT_IDEA_QUERY_PLAN_EMPTY");
      const runId = crypto.randomUUID();
      const run = (await tx.insert(contentIdeaDiscoveryRuns).values({
        id: runId,
        workspaceId: input.workspaceId,
        strategyVersionId: version.id,
        trigger: input.trigger,
        status: "queued",
        queryPlan,
        queryLimit: queryPlan.length,
        sourceLimit: DEFAULT_SOURCE_LIMIT,
        deadlineAt: new Date(input.now.getTime() + DEFAULT_DURATION_MS),
        createdBy: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      }).returning())[0]!;
      await tx.insert(contentOperationRequests).values({ workspaceId: input.workspaceId, operation: "ideas.discover", requestKey: input.requestKey, resourceType: "ContentIdeaDiscoveryRun", resourceId: runId, response: { runId } });
      await tx.insert(jobs).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        type: CONTENT_IDEA_DISCOVERY_JOB_TYPE,
        payload: { runId },
        idempotencyKey: `ideas:${runId}:v1`,
        correlationId: `content-ideas:${runId}`,
        maxAttempts: 5,
        priority: 10,
        availableAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      });
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: input.userId, runId, eventType: "ContentIdeaDiscoveryScheduled", changes: { trigger: input.trigger, queryCount: queryPlan.length } });
      return toRun(run);
    });
  }

  async list(input: Parameters<ContentIdeaRepository["list"]>[0]) {
    const cursor = decodeCursor(input.cursor);
    const conditions = [eq(contentIdeas.workspaceId, input.workspaceId)];
    if (input.status) conditions.push(eq(contentIdeas.status, input.status));
    if (cursor) conditions.push(or(
      lt(contentIdeas.lastSeenAt, cursor.at),
      and(eq(contentIdeas.lastSeenAt, cursor.at), lt(contentIdeas.id, cursor.id)),
    )!);
    const rows = await this.database.select().from(contentIdeas).where(and(...conditions)).orderBy(desc(contentIdeas.lastSeenAt), desc(contentIdeas.id)).limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const sources = page.length ? await this.database.select().from(contentIdeaSources).where(and(
      eq(contentIdeaSources.workspaceId, input.workspaceId),
      inArray(contentIdeaSources.ideaId, page.map((row) => row.id)),
    )).orderBy(desc(contentIdeaSources.collectedAt)) : [];
    const byIdea = new Map<string, ContentIdeaEvidence[]>();
    for (const source of sources) {
      const current = byIdea.get(source.ideaId) ?? [];
      current.push(toEvidence(source));
      byIdea.set(source.ideaId, current);
    }
    return {
      data: page.map((row) => toIdea(row, byIdea.get(row.id) ?? [])),
      nextCursor: rows.length > input.limit && page.at(-1) ? encodeCursor(page.at(-1)!.lastSeenAt, page.at(-1)!.id) : null,
    };
  }

  async findRun(input: { workspaceId: string; runId: string }): Promise<ContentIdeaDiscoveryRunView | null> {
    const rows = await this.database.select().from(contentIdeaDiscoveryRuns).where(and(
      eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId),
      eq(contentIdeaDiscoveryRuns.id, input.runId),
    )).limit(1);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async loadDiscoveryContext(input: { workspaceId: string; runId: string }): Promise<ContentIdeaDiscoveryContext> {
    const rows = await this.database.select({ run: contentIdeaDiscoveryRuns, snapshot: editorialStrategyVersions.snapshot }).from(contentIdeaDiscoveryRuns)
      .innerJoin(editorialStrategyVersions, and(
        eq(editorialStrategyVersions.workspaceId, contentIdeaDiscoveryRuns.workspaceId),
        eq(editorialStrategyVersions.id, contentIdeaDiscoveryRuns.strategyVersionId),
      )).where(and(eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId), eq(contentIdeaDiscoveryRuns.id, input.runId))).limit(1);
    const current = rows[0];
    if (!current) throw new Error("CONTENT_IDEA_RUN_NOT_FOUND");
    const strategy = editorialStrategySnapshotSchema.parse(current.snapshot);
    const [claimRows, knowledgeRows, conversationRows] = await Promise.all([
      strategy.allowedClaimIds.length ? this.database.select().from(offerClaims).where(and(
        eq(offerClaims.workspaceId, input.workspaceId),
        inArray(offerClaims.id, [...strategy.allowedClaimIds]),
        sql`${offerClaims.validationStatus} in ('sourced', 'validated')`,
      )).limit(50) : Promise.resolve([]),
      this.database.select({ claim: knowledgeClaims, source: knowledgeSources }).from(knowledgeClaims)
        .innerJoin(knowledgeClaimSources, and(eq(knowledgeClaimSources.workspaceId, knowledgeClaims.workspaceId), eq(knowledgeClaimSources.claimId, knowledgeClaims.id)))
        .innerJoin(knowledgeSources, and(eq(knowledgeSources.workspaceId, knowledgeClaimSources.workspaceId), eq(knowledgeSources.id, knowledgeClaimSources.sourceId)))
        .where(and(eq(knowledgeClaims.workspaceId, input.workspaceId), eq(knowledgeClaims.status, "validated"), eq(knowledgeSources.status, "validated")))
        .orderBy(desc(knowledgeSources.publishedAt)).limit(30),
      this.database.select({ message: messages, conversation: conversations }).from(messages)
        .innerJoin(conversations, and(eq(conversations.workspaceId, messages.workspaceId), eq(conversations.id, messages.conversationId)))
        .where(and(eq(messages.workspaceId, input.workspaceId), eq(messages.direction, "inbound")))
        .orderBy(desc(messages.createdAt)).limit(30),
    ]);
    const internalEvidence: ContentIdeaEvidence[] = [
      ...claimRows.map((claim) => ({ key: `offer_claim:${claim.id}`, type: "offer_claim" as const, sourceRef: claim.id, canonicalUrl: claim.evidenceUri, title: "Claim d’offre autorisé", excerpt: claim.claim, contentHash: hash(`offer:${claim.id}:${claim.claim}`), collectedAt: current.run.createdAt })),
      ...knowledgeRows.map(({ claim, source }) => ({ key: `knowledge_claim:${claim.id}`, type: "knowledge_claim" as const, sourceRef: claim.id, canonicalUrl: null, title: source.title, excerpt: claim.claim, contentHash: hash(`knowledge:${claim.id}:${claim.claim}`), collectedAt: source.publishedAt })),
      ...conversationRows.map(({ message, conversation }) => ({ key: `conversation_message:${message.id}`, type: "conversation_message" as const, sourceRef: message.id, canonicalUrl: null, title: `Question ou objection ${conversation.channel}`, excerpt: redactConversationEvidence(message.body).slice(0, 2_000), contentHash: hash(`message:${message.id}:${message.body}`), collectedAt: message.receivedAt ?? message.createdAt })),
    ];
    return {
      run: toRun(current.run),
      strategy,
      queries: zodStringArray(current.run.queryPlan),
      internalEvidence,
    };
  }

  async startRun(input: { workspaceId: string; runId: string; now: Date }): Promise<void> {
    await this.database.update(contentIdeaDiscoveryRuns).set({ status: "running", startedAt: sql`coalesce(${contentIdeaDiscoveryRuns.startedAt}, ${input.now.toISOString()}::timestamptz)`, updatedAt: input.now }).where(and(
      eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId), eq(contentIdeaDiscoveryRuns.id, input.runId), sql`${contentIdeaDiscoveryRuns.status} in ('queued', 'running')`,
    ));
  }

  async saveStep(input: Parameters<ContentIdeaRepository["saveStep"]>[0]): Promise<void> {
    await this.database.transaction(async (tx) => {
      const rows = await tx.select().from(contentIdeaDiscoveryRuns).where(and(eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId), eq(contentIdeaDiscoveryRuns.id, input.runId))).limit(1).for("update");
      const run = rows[0];
      if (!run) throw new Error("CONTENT_IDEA_RUN_NOT_FOUND");
      if (run.cursor >= input.cursor) return;
      let insertedIdeas = 0;
      const evidenceByKey = new Map(input.evidence.map((source) => [source.key, source]));
      for (const candidate of input.candidates) {
        const fingerprint = hash(`${normalizeIdeaConcept(candidate.pillar)}|${normalizeIdeaConcept(candidate.conceptKey)}`);
        const freshnessUntil = new Date(input.now.getTime() + candidate.freshnessDays * 86_400_000);
        const inserted = await tx.insert(contentIdeas).values({
          id: crypto.randomUUID(), workspaceId: input.workspaceId, strategyVersionId: run.strategyVersionId, status: "discovered",
          angle: candidate.angle, rationale: candidate.rationale, audience: candidate.audience, pillar: candidate.pillar,
          priority: candidate.priority, fingerprint, freshnessUntil, firstSeenAt: input.now, lastSeenAt: input.now, createdAt: input.now, updatedAt: input.now,
        }).onConflictDoNothing({ target: [contentIdeas.workspaceId, contentIdeas.fingerprint] }).returning();
        let idea = inserted[0];
        if (idea) insertedIdeas += 1;
        if (!idea) {
          const existing = await tx.select().from(contentIdeas).where(and(eq(contentIdeas.workspaceId, input.workspaceId), eq(contentIdeas.fingerprint, fingerprint))).limit(1);
          idea = existing[0];
          if (!idea) throw new Error("CONTENT_IDEA_DEDUPLICATION_FAILED");
          await tx.update(contentIdeas).set({
            lastSeenAt: input.now,
            priority: sql`greatest(${contentIdeas.priority}, ${candidate.priority})`,
            freshnessUntil: sql`greatest(${contentIdeas.freshnessUntil}, ${freshnessUntil.toISOString()}::timestamptz)`,
            updatedAt: input.now,
          }).where(and(eq(contentIdeas.workspaceId, input.workspaceId), eq(contentIdeas.id, idea.id)));
        }
        for (const sourceKey of candidate.sourceKeys) {
          const source = evidenceByKey.get(sourceKey);
          if (!source) throw new Error("CONTENT_IDEA_UNRESOLVED_SOURCE");
          await tx.insert(contentIdeaSources).values({
            id: crypto.randomUUID(), workspaceId: input.workspaceId, ideaId: idea.id, runId: input.runId,
            type: source.type, sourceRef: source.sourceRef, canonicalUrl: source.canonicalUrl, title: source.title,
            excerpt: source.excerpt, contentHash: source.contentHash, collectedAt: source.collectedAt,
          }).onConflictDoNothing({ target: [contentIdeaSources.workspaceId, contentIdeaSources.ideaId, contentIdeaSources.contentHash] });
        }
      }
      await tx.update(contentIdeaDiscoveryRuns).set({
        cursor: input.cursor,
        queryCount: sql`${contentIdeaDiscoveryRuns.queryCount} + 1`,
        sourceCount: sql`${contentIdeaDiscoveryRuns.sourceCount} + ${input.discoveredSourceCount}`,
        ideaCount: sql`${contentIdeaDiscoveryRuns.ideaCount} + ${insertedIdeas}`,
        updatedAt: input.now,
      }).where(and(eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId), eq(contentIdeaDiscoveryRuns.id, input.runId)));
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: null, runId: input.runId, eventType: "ContentIdeaDiscoveryStepCompleted", changes: { cursor: input.cursor, insertedIdeas, discoveredSources: input.discoveredSourceCount } });
    });
  }

  async completeRun(input: { workspaceId: string; runId: string; partial: boolean; now: Date }): Promise<void> {
    await this.database.transaction(async (tx) => {
      const rows = await tx.update(contentIdeaDiscoveryRuns).set({ status: input.partial ? "partial" : "completed", completedAt: input.now, updatedAt: input.now }).where(and(
        eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId), eq(contentIdeaDiscoveryRuns.id, input.runId), sql`${contentIdeaDiscoveryRuns.status} in ('queued', 'running')`,
      )).returning();
      if (rows[0]) await appendEvent(tx, { workspaceId: input.workspaceId, userId: null, runId: input.runId, eventType: input.partial ? "ContentIdeaDiscoveryPartiallyCompleted" : "ContentIdeaDiscoveryCompleted", changes: { ideaCount: rows[0].ideaCount, sourceCount: rows[0].sourceCount } });
    });
  }

  async failRun(input: { workspaceId: string; runId: string; code: string; message: string; now: Date }): Promise<void> {
    await this.database.update(contentIdeaDiscoveryRuns).set({ status: "failed", lastErrorCode: input.code, lastErrorMessage: input.message.slice(0, 4_000), completedAt: input.now, updatedAt: input.now }).where(and(eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId), eq(contentIdeaDiscoveryRuns.id, input.runId)));
  }
}

function buildQueryPlan(snapshot: ReturnType<typeof editorialStrategySnapshotSchema.parse>): readonly string[] {
  return [...new Set(snapshot.pillars.map((pillar) => `${snapshot.audience.name} ${pillar.name} ${pillar.promise}`.replace(/\s+/g, " ").trim()))];
}

function zodStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error("CONTENT_IDEA_QUERY_PLAN_INVALID");
  return value as string[];
}

function hash(value: string): string { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }

function redactConversationEvidence(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/(?:\+|00)?\d(?:[\s().-]*\d){7,}/g, "[telephone]");
}

function toRun(row: typeof contentIdeaDiscoveryRuns.$inferSelect): ContentIdeaDiscoveryRunView {
  return {
    id: row.id, workspaceId: row.workspaceId, strategyVersionId: row.strategyVersionId,
    status: row.status as ContentIdeaDiscoveryRunView["status"], trigger: row.trigger as ContentIdeaDiscoveryRunView["trigger"],
    cursor: row.cursor, queryCount: row.queryCount, sourceCount: row.sourceCount, ideaCount: row.ideaCount,
    queryLimit: row.queryLimit, sourceLimit: row.sourceLimit, deadlineAt: row.deadlineAt,
    lastErrorCode: row.lastErrorCode, lastErrorMessage: row.lastErrorMessage, createdAt: row.createdAt, completedAt: row.completedAt,
  };
}

function toIdea(row: typeof contentIdeas.$inferSelect, sources: readonly ContentIdeaEvidence[]): ContentIdeaView {
  return { id: row.id, workspaceId: row.workspaceId, strategyVersionId: row.strategyVersionId, status: row.status as ContentIdeaStatus, angle: row.angle, rationale: row.rationale, audience: row.audience, pillar: row.pillar, priority: row.priority, freshnessUntil: row.freshnessUntil, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, sources };
}

function toEvidence(row: typeof contentIdeaSources.$inferSelect): ContentIdeaEvidence {
  return { key: `${row.type}:${row.sourceRef}`, type: row.type as ContentIdeaEvidence["type"], sourceRef: row.sourceRef, canonicalUrl: row.canonicalUrl, title: row.title, excerpt: row.excerpt, contentHash: row.contentHash, collectedAt: row.collectedAt };
}

function encodeCursor(at: Date, id: string): string { return Buffer.from(JSON.stringify([at.toISOString(), id])).toString("base64url"); }
function decodeCursor(value?: string): { at: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") return null;
    const at = new Date(parsed[0]);
    return Number.isNaN(at.getTime()) ? null : { at, id: parsed[1] };
  } catch { return null; }
}

async function appendEvent(tx: any, input: { workspaceId: string; userId: string | null; runId: string; eventType: string; changes: unknown }) {
  const events = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: "ContentIdeaDiscoveryRun", aggregateId: input.runId, eventType: input.eventType, payload: { type: input.eventType, runId: input.runId, workspaceId: input.workspaceId, ...input.changes as object } }).returning({ id: outboxEvents.id });
  if (events[0]) await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: input.eventType, subjectType: "ContentIdeaDiscoveryRun", subjectId: input.runId, changes: input.changes, sourceEventId: events[0].id });
}
