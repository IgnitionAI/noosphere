import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  embeddingModelRevisions,
  embeddingReindexRuns,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeChunkSets,
  knowledgeSearchRuntime,
} from "@outbound/infrastructure/database/schema";

const RETENTION_DAYS = 14;

export interface RevisionValidationGates {
  readonly bilingualRetrievalPassed: boolean;
  readonly recallAt10Passed: boolean;
  readonly ndcgAt10Passed: boolean;
  readonly p95Ms: number;
  readonly memoryPercent: number;
  readonly oomCount: number;
  readonly blockedWorkerCount: number;
}

export class PostgresEmbeddingRevisionManager {
  constructor(private readonly db: Database) {}

  async createHnswIndex(revisionId: string): Promise<string> {
    assertUuid(revisionId);
    const [revision] = await this.db.select({
      dimension: embeddingModelRevisions.dimension,
      distanceMetric: embeddingModelRevisions.distanceMetric,
      vectorIndexName: embeddingModelRevisions.vectorIndexName,
    }).from(embeddingModelRevisions).where(eq(embeddingModelRevisions.id, revisionId)).limit(1);
    if (!revision) throw new Error("EMBEDDING_REVISION_NOT_FOUND");
    if (!Number.isSafeInteger(revision.dimension) || revision.dimension < 1 || revision.dimension > 4_096) {
      throw new Error("EMBEDDING_REVISION_DIMENSION_INVALID");
    }
    if (revision.distanceMetric !== "cosine") throw new Error("EMBEDDING_REVISION_METRIC_UNSUPPORTED");
    const indexName = revision.vectorIndexName ?? vectorIndexName(revisionId, revision.dimension);
    assertSqlIdentifier(indexName);
    await this.db.execute(sql.raw(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "${indexName}"
      ON "knowledge_chunk_embeddings"
      USING hnsw (("embedding"::vector(${revision.dimension})) vector_cosine_ops)
      WHERE "model_revision_id" = '${revisionId}'::uuid
    `));
    await this.db.update(embeddingModelRevisions).set({ vectorIndexName: indexName })
      .where(eq(embeddingModelRevisions.id, revisionId));
    return indexName;
  }

  async activate(input: {
    readonly revisionId: string;
    readonly reindexRunId: string;
    readonly gates: RevisionValidationGates;
  }): Promise<void> {
    assertUuid(input.revisionId);
    assertUuid(input.reindexRunId);
    validateRevisionGates(input.gates);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('knowledge-model-activation', 0))`);
      const revisions = await tx.select().from(embeddingModelRevisions)
        .where(eq(embeddingModelRevisions.id, input.revisionId)).limit(1);
      const revision = revisions[0];
      if (!revision || !["backfilling", "validating"].includes(revision.status)) {
        throw new Error("EMBEDDING_REVISION_NOT_VALIDATABLE");
      }
      const runs = await tx.select().from(embeddingReindexRuns)
        .where(and(
          eq(embeddingReindexRuns.id, input.reindexRunId),
          eq(embeddingReindexRuns.modelRevisionId, input.revisionId),
        )).limit(1);
      if (!runs[0] || runs[0].status !== "validating") throw new Error("EMBEDDING_REINDEX_NOT_VALIDATING");

      const [coverage] = await tx.select({
        eligible: sql<number>`count(distinct ${knowledgeChunks.id})::int`,
        embedded: sql<number>`count(distinct ${knowledgeChunkEmbeddings.chunkId}) filter (where ${knowledgeChunkEmbeddings.modelRevisionId} = ${input.revisionId})::int`,
        rows: sql<number>`count(${knowledgeChunkEmbeddings.id}) filter (where ${knowledgeChunkEmbeddings.modelRevisionId} = ${input.revisionId})::int`,
        missingProvenance: sql<number>`count(*) filter (where ${knowledgeChunks.locator} is null or btrim(${knowledgeChunks.locator}) = '')::int`,
      }).from(knowledgeChunks)
        .innerJoin(knowledgeChunkSets, and(
          eq(knowledgeChunkSets.workspaceId, knowledgeChunks.workspaceId),
          eq(knowledgeChunkSets.id, knowledgeChunks.chunkSetId),
          eq(knowledgeChunkSets.status, "active"),
        ))
        .leftJoin(knowledgeChunkEmbeddings, and(
          eq(knowledgeChunkEmbeddings.workspaceId, knowledgeChunks.workspaceId),
          eq(knowledgeChunkEmbeddings.chunkId, knowledgeChunks.id),
          eq(knowledgeChunkEmbeddings.modelRevisionId, input.revisionId),
        ));
      if (!coverage || coverage.eligible === 0 || coverage.embedded !== coverage.eligible || coverage.rows !== coverage.eligible) {
        throw new Error("EMBEDDING_COVERAGE_INCOMPLETE");
      }
      if (coverage.missingProvenance !== 0) throw new Error("EMBEDDING_PROVENANCE_INCOMPLETE");

      const now = new Date();
      const retireAfter = new Date(now.getTime() + RETENTION_DAYS * 86_400_000);
      await tx.update(embeddingModelRevisions).set({
        status: "retired",
        retiredAt: now,
        retireAfter,
      }).where(and(
        eq(embeddingModelRevisions.status, "active"),
        ne(embeddingModelRevisions.id, input.revisionId),
      ));
      await tx.update(embeddingModelRevisions).set({
        status: "active",
        activatedAt: now,
        retiredAt: null,
        retireAfter: null,
      }).where(eq(embeddingModelRevisions.id, input.revisionId));
      await tx.update(knowledgeSearchRuntime).set({ activeModelRevisionId: input.revisionId, updatedAt: now })
        .where(eq(knowledgeSearchRuntime.singleton, true));
      await tx.update(embeddingReindexRuns).set({
        status: "active",
        qualityMetrics: input.gates,
        capacityMetrics: { p95Ms: input.gates.p95Ms, memoryPercent: input.gates.memoryPercent },
        activatedAt: now,
        completedAt: now,
      }).where(eq(embeddingReindexRuns.id, input.reindexRunId));
    });
  }

  async rollback(revisionId: string): Promise<void> {
    assertUuid(revisionId);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('knowledge-model-activation', 0))`);
      const [target] = await tx.select().from(embeddingModelRevisions)
        .where(and(
          eq(embeddingModelRevisions.id, revisionId),
          eq(embeddingModelRevisions.status, "retired"),
          gt(embeddingModelRevisions.retireAfter, new Date()),
        )).limit(1);
      if (!target) throw new Error("EMBEDDING_ROLLBACK_WINDOW_EXPIRED");
      const now = new Date();
      await tx.update(embeddingModelRevisions).set({ status: "retired", retiredAt: now, retireAfter: now })
        .where(eq(embeddingModelRevisions.status, "active"));
      await tx.update(embeddingModelRevisions).set({ status: "active", retiredAt: null, retireAfter: null })
        .where(eq(embeddingModelRevisions.id, revisionId));
      await tx.update(knowledgeSearchRuntime).set({ activeModelRevisionId: revisionId, updatedAt: now })
        .where(eq(knowledgeSearchRuntime.singleton, true));
    });
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const expired = await this.db.select({
      id: embeddingModelRevisions.id,
      vectorIndexName: embeddingModelRevisions.vectorIndexName,
    }).from(embeddingModelRevisions)
      .where(and(
        eq(embeddingModelRevisions.status, "retired"),
        lt(embeddingModelRevisions.retireAfter, now),
      ));
    if (expired.length === 0) return 0;
    for (const revision of expired) {
      await this.db.delete(knowledgeChunkEmbeddings)
        .where(eq(knowledgeChunkEmbeddings.modelRevisionId, revision.id));
      if (revision.vectorIndexName) {
        assertSqlIdentifier(revision.vectorIndexName);
        await this.db.execute(sql.raw(`DROP INDEX CONCURRENTLY IF EXISTS "${revision.vectorIndexName}"`));
      }
      await this.db.update(embeddingModelRevisions).set({ vectorIndexName: null })
        .where(eq(embeddingModelRevisions.id, revision.id));
    }
    return expired.length;
  }
}

export function validateRevisionGates(gates: RevisionValidationGates): void {
  if (!gates.bilingualRetrievalPassed || !gates.recallAt10Passed || !gates.ndcgAt10Passed) {
    throw new Error("EMBEDDING_QUALITY_GATE_FAILED");
  }
  if (!Number.isFinite(gates.p95Ms) || gates.p95Ms > 1_500) throw new Error("EMBEDDING_LATENCY_GATE_FAILED");
  if (!Number.isFinite(gates.memoryPercent) || gates.memoryPercent >= 80) throw new Error("EMBEDDING_MEMORY_GATE_FAILED");
  if (gates.oomCount !== 0 || gates.blockedWorkerCount !== 0) throw new Error("EMBEDDING_STABILITY_GATE_FAILED");
}

function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("EMBEDDING_REVISION_ID_INVALID");
  }
}

function vectorIndexName(revisionId: string, dimension: number): string {
  return `knowledge_embeddings_${revisionId.replaceAll("-", "").slice(0, 12)}_${dimension}_hnsw`;
}

function assertSqlIdentifier(value: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("EMBEDDING_INDEX_NAME_INVALID");
}
