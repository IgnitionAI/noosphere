import { and, eq, sql } from "drizzle-orm";
import type { DocumentTextExtraction } from "@outbound/application/documents/document-text-extractor";
import type { EmbeddingGateway, KnowledgeReranker } from "@outbound/application/knowledge/embedding-gateway";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import type { Database, SqlClient } from "@outbound/infrastructure/database/client";
import {
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeChunkSets,
  knowledgeDocuments,
} from "@outbound/infrastructure/database/schema";
import type { InternalDocumentSearch } from "@outbound/infrastructure/ai/research-tools";

export const QWEN_EMBEDDING_REVISION_ID = "00000000-0000-4000-8000-000000001024";
export const KNOWLEDGE_CHUNKER_ID = "structured-sections";
export const KNOWLEDGE_CHUNKER_VERSION = "1";
const CHUNKER_CONFIGURATION = { chunkCharacters: 3_500, stepCharacters: 3_000, overlapCharacters: 300 } as const;
const CHUNKER_CONFIGURATION_HASH = sha256(JSON.stringify(CHUNKER_CONFIGURATION));
const VECTOR_CANDIDATES = 60;
const LEXICAL_CANDIDATES = 60;
const RERANK_CANDIDATES = 30;

export interface PreparedKnowledgeChunk {
  readonly content: string;
  readonly heading: string | null;
  readonly locator: string;
}

export class PostgresVersionedKnowledgeIndexer {
  constructor(
    private readonly db: Database,
    private readonly embeddings: EmbeddingGateway,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelRevisionId = QWEN_EMBEDDING_REVISION_ID,
  ) {}

  async indexResearchDocument(input: {
    readonly workspaceId: string;
    readonly sourceDocumentId: string;
    readonly filename: string;
    readonly contentType: string;
    readonly checksumSha256: string;
    readonly sourceCreatedAt: Date;
    readonly extraction: DocumentTextExtraction;
    readonly chunks: readonly PreparedKnowledgeChunk[];
  }): Promise<void> {
    if (input.extraction.status === "ocr_required") return;
    await this.indexTextDocument({
      workspaceId: input.workspaceId,
      sourceType: "research_document",
      sourceId: input.sourceDocumentId,
      title: input.filename,
      format: input.contentType,
      language: null,
      validationStatus: input.extraction.status === "partial" ? "partial" : "ready",
      contentHash: input.checksumSha256,
      sourceCreatedAt: input.sourceCreatedAt,
      tags: [],
      chunks: input.chunks.map((chunk) => ({
        ...chunk,
        metadata: {
          locator: chunk.locator,
          extractionProvider: input.extraction.provider,
          extractionWarnings: input.extraction.warnings,
        },
      })),
    });
  }

  async indexTextDocument(input: {
    readonly workspaceId: string;
    readonly sourceType: "research_document" | "knowledge_source" | "offer" | "proof";
    readonly sourceId: string;
    readonly title: string;
    readonly format: string;
    readonly language: string | null;
    readonly validationStatus: string;
    readonly contentHash: string;
    readonly sourceCreatedAt: Date;
    readonly offerId?: string | null;
    readonly icpId?: string | null;
    readonly runId?: string | null;
    readonly tags: readonly string[];
    readonly chunks: readonly (PreparedKnowledgeChunk & { readonly metadata?: Readonly<Record<string, unknown>> })[];
  }): Promise<boolean> {
    if (await this.#hasCurrentProjection(input)) return false;
    const model = await this.embeddings.info();
    if (!model.healthy || model.dimension !== 1_024) throw new Error("TEI_MODEL_NOT_READY");
    const vectors = await this.embeddings.embedDocuments(input.chunks.map((chunk) => chunk.content));
    if (vectors.length !== input.chunks.length) throw new Error("TEI_EMBEDDING_COUNT_MISMATCH");

    const documentId = stableUuid(`knowledge-document:${input.workspaceId}:${input.sourceType}:${input.sourceId}`);
    const chunkSetId = stableUuid(`knowledge-chunk-set:${documentId}:${KNOWLEDGE_CHUNKER_VERSION}:${CHUNKER_CONFIGURATION_HASH}:${input.contentHash}`);
    const now = this.clock.now();

    await this.db.transaction(async (tx) => {
      await tx.insert(knowledgeDocuments).values({
        id: documentId,
        workspaceId: input.workspaceId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        title: input.title,
        format: input.format,
        language: input.language,
        validationStatus: input.validationStatus,
        contentHash: input.contentHash,
        offerId: input.offerId ?? null,
        icpId: input.icpId ?? null,
        runId: input.runId ?? null,
        tags: [...input.tags],
        sourceCreatedAt: input.sourceCreatedAt,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [knowledgeDocuments.workspaceId, knowledgeDocuments.sourceType, knowledgeDocuments.sourceId],
        set: {
          title: input.title,
          format: input.format,
          language: input.language,
          validationStatus: input.validationStatus,
          contentHash: input.contentHash,
          offerId: input.offerId ?? null,
          icpId: input.icpId ?? null,
          runId: input.runId ?? null,
          tags: [...input.tags],
          updatedAt: now,
        },
      });

      await tx.update(knowledgeChunkSets).set({ status: "retired", retiredAt: now })
        .where(and(
          eq(knowledgeChunkSets.workspaceId, input.workspaceId),
          eq(knowledgeChunkSets.documentId, documentId),
          eq(knowledgeChunkSets.status, "active"),
        ));
      await tx.insert(knowledgeChunkSets).values({
        id: chunkSetId,
        workspaceId: input.workspaceId,
        documentId,
        chunkerId: KNOWLEDGE_CHUNKER_ID,
        chunkerVersion: KNOWLEDGE_CHUNKER_VERSION,
        configuration: CHUNKER_CONFIGURATION,
        configurationHash: CHUNKER_CONFIGURATION_HASH,
        sourceContentHash: input.contentHash,
        status: "building",
        chunkCount: input.chunks.length,
      }).onConflictDoUpdate({
        target: [
          knowledgeChunkSets.workspaceId,
          knowledgeChunkSets.documentId,
          knowledgeChunkSets.chunkerId,
          knowledgeChunkSets.chunkerVersion,
          knowledgeChunkSets.configurationHash,
          knowledgeChunkSets.sourceContentHash,
        ],
        set: { status: "building", chunkCount: input.chunks.length, retiredAt: null },
      });
      await tx.delete(knowledgeChunks).where(and(
        eq(knowledgeChunks.workspaceId, input.workspaceId),
        eq(knowledgeChunks.chunkSetId, chunkSetId),
      ));

      if (input.chunks.length > 0) {
        const rows = input.chunks.map((chunk, ordinal) => {
          const chunkId = stableUuid(`knowledge-chunk:${chunkSetId}:${ordinal}:${sha256(chunk.content)}`);
          return {
            chunkId,
            vector: vectors[ordinal]!,
            chunk,
            ordinal,
          };
        });
        await tx.insert(knowledgeChunks).values(rows.map(({ chunkId, chunk, ordinal }) => ({
          id: chunkId,
          workspaceId: input.workspaceId,
          documentId,
          chunkSetId,
          ordinal,
          locator: chunk.locator,
          title: chunk.heading,
          content: chunk.content,
          contentHash: sha256(chunk.content),
          tokenCount: Math.ceil(chunk.content.length / 4),
          language: input.language,
          sourceType: input.sourceType,
          format: input.format,
          validationStatus: input.validationStatus,
          offerId: input.offerId ?? null,
          icpId: input.icpId ?? null,
          runId: input.runId ?? null,
          tags: [...input.tags],
          metadata: chunk.metadata ?? { locator: chunk.locator },
        })));
        await tx.insert(knowledgeChunkEmbeddings).values(rows.map(({ chunkId, vector, chunk }) => ({
          id: this.ids.generate(),
          workspaceId: input.workspaceId,
          chunkId,
          modelRevisionId: this.modelRevisionId,
          embedding: [...vector],
          dimension: 1_024,
          inputHash: sha256(chunk.content),
        })));
      }
      await tx.update(knowledgeChunkSets).set({ status: "active", activatedAt: now, retiredAt: null })
        .where(and(eq(knowledgeChunkSets.workspaceId, input.workspaceId), eq(knowledgeChunkSets.id, chunkSetId)));
    });
    return true;
  }

  async #hasCurrentProjection(input: {
    readonly workspaceId: string;
    readonly sourceType: "research_document" | "knowledge_source" | "offer" | "proof";
    readonly sourceId: string;
    readonly contentHash: string;
  }): Promise<boolean> {
    const rows = await this.db.execute<{ chunkCount: number; embeddingCount: number }>(sql`
      select count(distinct kc.id)::int as "chunkCount",
             count(distinct kce.chunk_id)::int as "embeddingCount"
      from knowledge_documents kd
      join knowledge_chunk_sets kcs
        on kcs.workspace_id = kd.workspace_id
       and kcs.document_id = kd.id
       and kcs.status = 'active'
       and kcs.source_content_hash = ${input.contentHash}
      join knowledge_chunks kc
        on kc.workspace_id = kcs.workspace_id
       and kc.chunk_set_id = kcs.id
      left join knowledge_chunk_embeddings kce
        on kce.workspace_id = kc.workspace_id
       and kce.chunk_id = kc.id
       and kce.model_revision_id = ${this.modelRevisionId}
      where kd.workspace_id = ${input.workspaceId}
        and kd.source_type = ${input.sourceType}
        and kd.source_id = ${input.sourceId}
      group by kd.id
    `);
    const row = rows[0];
    return Boolean(row && row.chunkCount > 0 && row.embeddingCount === row.chunkCount);
  }
}

interface SearchRow extends Record<string, unknown> {
  id: string;
  documentId: string;
  ordinal: number;
  locator: string | null;
  content: string;
  metadata: Record<string, unknown>;
  lexicalRank: number | null;
  semanticRank: number | null;
  rrfScore: number;
  modelRevisionId: string | null;
}

export class ParadeDbVersionedKnowledgeSearch implements InternalDocumentSearch {
  constructor(
    private readonly sqlClient: SqlClient,
    private readonly embeddings: EmbeddingGateway,
    private readonly reranker?: KnowledgeReranker,
  ) {}

  async search(input: {
    workspaceId: string;
    documentIds: readonly string[];
    query: string;
    limit: number;
  }): Promise<readonly Record<string, unknown>[]> {
    if (!input.documentIds.length) return [];
    const limit = Math.max(1, Math.min(20, input.limit));
    const runtime = await this.#activeRuntime();
    let embedding: readonly number[] | null = null;
    try {
      embedding = await this.embeddings.embedQuery(input.query);
    } catch {
      embedding = null;
    }
    const rows = embedding
      ? await this.#hybridCandidates(input, runtime, embedding)
      : await this.#lexicalCandidates(input);
    if (!embedding) return rows.slice(0, limit).map((row) => serializeSearchRow(row, "lexical_degraded"));

    const candidates = rows.slice(0, RERANK_CANDIDATES);
    if (!this.reranker || candidates.length === 0) {
      return rows.slice(0, limit).map((row) => serializeSearchRow(row, "hybrid"));
    }
    try {
      const ranks = await this.reranker.rerank({ query: input.query, texts: candidates.map((row) => row.content) });
      const reranked = ranks.map((rank) => candidates[rank.index]).filter((row): row is SearchRow => Boolean(row));
      return reranked.slice(0, limit).map((row, index) => ({
        ...serializeSearchRow(row, "hybrid_reranked"),
        rerankRank: index + 1,
        rerankScore: ranks[index]?.score ?? null,
      }));
    } catch {
      return rows.slice(0, limit).map((row) => serializeSearchRow(row, "hybrid"));
    }
  }

  async read(input: {
    workspaceId: string;
    documentIds: readonly string[];
    chunkId: string;
    contextWindow: number;
  }): Promise<Readonly<Record<string, unknown>> | null> {
    if (!input.documentIds.length) return null;
    const rows = await this.sqlClient<{ documentId: string; ordinal: number; chunkSetId: string }[]>`
      select kd.source_id as "documentId", kc.ordinal, kc.chunk_set_id as "chunkSetId"
      from knowledge_chunks kc
      join knowledge_chunk_sets kcs on kcs.workspace_id = kc.workspace_id and kcs.id = kc.chunk_set_id and kcs.status = 'active'
      join knowledge_documents kd on kd.workspace_id = kc.workspace_id and kd.id = kc.document_id
      where kc.workspace_id = ${input.workspaceId}
        and kc.id = ${input.chunkId}
        and kd.source_type = 'research_document'
        and kd.source_id = any(${uuidArray(input.documentIds)}::uuid[])
      limit 1
    `;
    const match = rows[0];
    if (!match) return null;
    const chunks = await this.sqlClient`
      select id, ordinal, locator, title, content, metadata
      from knowledge_chunks
      where workspace_id = ${input.workspaceId}
        and chunk_set_id = ${match.chunkSetId}
        and ordinal between ${match.ordinal - input.contextWindow} and ${match.ordinal + input.contextWindow}
      order by ordinal
    `;
    return { documentId: match.documentId, chunks };
  }

  async #activeRuntime(): Promise<{ modelRevisionId: string; dimension: number }> {
    const rows = await this.sqlClient<{ modelRevisionId: string; dimension: number }[]>`
      select ksr.active_model_revision_id as "modelRevisionId", emr.dimension
      from knowledge_search_runtime ksr
      join embedding_model_revisions emr on emr.id = ksr.active_model_revision_id
      where ksr.singleton = true and emr.status = 'active'
      limit 1
    `;
    const runtime = rows[0];
    if (!runtime) throw new Error("KNOWLEDGE_ACTIVE_MODEL_MISSING");
    if (!Number.isSafeInteger(runtime.dimension) || runtime.dimension < 1 || runtime.dimension > 4_096) {
      throw new Error("KNOWLEDGE_ACTIVE_MODEL_DIMENSION_INVALID");
    }
    return runtime;
  }

  async #hybridCandidates(
    input: { workspaceId: string; documentIds: readonly string[]; query: string },
    runtime: { modelRevisionId: string; dimension: number },
    embedding: readonly number[],
  ): Promise<SearchRow[]> {
    if (embedding.length !== runtime.dimension) throw new Error("KNOWLEDGE_QUERY_DIMENSION_MISMATCH");
    const query = `
      with lexical as materialized (
        select kc.id, row_number() over (order by paradedb.score(kc.id) desc) as rank
        from knowledge_chunks kc
        join knowledge_chunk_sets kcs on kcs.workspace_id = kc.workspace_id and kcs.id = kc.chunk_set_id and kcs.status = 'active'
        join knowledge_documents kd on kd.workspace_id = kc.workspace_id and kd.id = kc.document_id
        where kc.workspace_id = $1
          and kc.validation_status in ('ready', 'partial', 'validated')
          and kd.source_type = 'research_document'
          and kd.source_id = any($2::uuid[])
          and kc.content @@@ $3
        order by paradedb.score(kc.id) desc
        limit ${LEXICAL_CANDIDATES}
      ), semantic as materialized (
        select kc.id, row_number() over (order by kce.embedding::vector(${runtime.dimension}) <=> $4::vector(${runtime.dimension})) as rank
        from knowledge_chunk_embeddings kce
        join knowledge_chunks kc on kc.workspace_id = kce.workspace_id and kc.id = kce.chunk_id
        join knowledge_chunk_sets kcs on kcs.workspace_id = kc.workspace_id and kcs.id = kc.chunk_set_id and kcs.status = 'active'
        join knowledge_documents kd on kd.workspace_id = kc.workspace_id and kd.id = kc.document_id
        where kce.workspace_id = $1
          and kce.model_revision_id = $5
          and kc.validation_status in ('ready', 'partial', 'validated')
          and kd.source_type = 'research_document'
          and kd.source_id = any($2::uuid[])
        order by kce.embedding::vector(${runtime.dimension}) <=> $4::vector(${runtime.dimension})
        limit ${VECTOR_CANDIDATES}
      ), fused as (
        select coalesce(l.id, s.id) as id,
          l.rank as lexical_rank,
          s.rank as semantic_rank,
          coalesce(1.0 / (60 + l.rank), 0) + coalesce(1.0 / (60 + s.rank), 0) as rrf_score
        from lexical l full join semantic s on s.id = l.id
      )
      select kc.id, kd.source_id as "documentId", kc.ordinal, kc.locator, kc.content, kc.metadata,
        f.lexical_rank as "lexicalRank", f.semantic_rank as "semanticRank", f.rrf_score as "rrfScore",
        $5::uuid as "modelRevisionId"
      from fused f
      join knowledge_chunks kc on kc.workspace_id = $1 and kc.id = f.id
      join knowledge_documents kd on kd.workspace_id = kc.workspace_id and kd.id = kc.document_id
      order by f.rrf_score desc, kc.id
      limit ${Math.max(LEXICAL_CANDIDATES, VECTOR_CANDIDATES)}
    `;
    return this.sqlClient.unsafe<SearchRow[]>(query, [
      input.workspaceId,
      uuidArray(input.documentIds),
      input.query,
      vectorLiteral(embedding),
      runtime.modelRevisionId,
    ]);
  }

  async #lexicalCandidates(input: { workspaceId: string; documentIds: readonly string[]; query: string }): Promise<SearchRow[]> {
    return this.sqlClient<SearchRow[]>`
      select kc.id, kd.source_id as "documentId", kc.ordinal, kc.locator, kc.content, kc.metadata,
        row_number() over (order by paradedb.score(kc.id) desc) as "lexicalRank",
        null::bigint as "semanticRank", paradedb.score(kc.id) as "rrfScore", null::uuid as "modelRevisionId"
      from knowledge_chunks kc
      join knowledge_chunk_sets kcs on kcs.workspace_id = kc.workspace_id and kcs.id = kc.chunk_set_id and kcs.status = 'active'
      join knowledge_documents kd on kd.workspace_id = kc.workspace_id and kd.id = kc.document_id
      where kc.workspace_id = ${input.workspaceId}
        and kc.validation_status in ('ready', 'partial', 'validated')
        and kd.source_type = 'research_document'
        and kd.source_id = any(${uuidArray(input.documentIds)}::uuid[])
        and kc.content @@@ ${input.query}
      order by paradedb.score(kc.id) desc, kc.id
      limit ${LEXICAL_CANDIDATES}
    `;
  }
}

function serializeSearchRow(row: SearchRow, searchMode: "hybrid_reranked" | "hybrid" | "lexical_degraded") {
  return {
    id: row.id,
    documentId: row.documentId,
    ordinal: row.ordinal,
    locator: row.locator,
    content: row.content,
    metadata: row.metadata,
    lexicalRank: row.lexicalRank === null ? null : Number(row.lexicalRank),
    semanticRank: row.semanticRank === null ? null : Number(row.semanticRank),
    rrfScore: Number(row.rrfScore),
    modelRevisionId: row.modelRevisionId,
    searchMode,
  };
}

function vectorLiteral(values: readonly number[]): string {
  if (values.some((value) => !Number.isFinite(value))) throw new Error("KNOWLEDGE_VECTOR_INVALID");
  return `[${values.join(",")}]`;
}

function uuidArray(values: readonly string[]): string {
  if (values.some((value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) {
    throw new Error("KNOWLEDGE_DOCUMENT_ID_INVALID");
  }
  return `{${values.join(",")}}`;
}

function stableUuid(value: string): string {
  const hex = sha256(value).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}
