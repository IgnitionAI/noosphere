import { randomUUID } from "node:crypto";
import type { EmbeddingGateway } from "@outbound/application/knowledge/embedding-gateway";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { TeiGrpcEmbeddingGateway, TeiGrpcReranker } from "@outbound/infrastructure/embeddings/tei-grpc-client";
import {
  ParadeDbVersionedKnowledgeSearch,
  QWEN_EMBEDDING_REVISION_ID,
} from "@outbound/infrastructure/knowledge/postgres-versioned-knowledge-index";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const embedding = new TeiGrpcEmbeddingGateway({
  address: process.env.TEI_EMBEDDING_GRPC_ADDRESS ?? "127.0.0.1:8081",
  expectedModelId: process.env.TEI_EMBEDDING_RUNTIME_MODEL_ID ?? "janni-t/qwen3-embedding-0.6b-int8-tei-onnx",
  expectedModelSha: process.env.TEI_EMBEDDING_RUNTIME_MODEL_SHA ?? "8fe0c238c7c48016d28e750413ca492024be3ddf",
  dimension: 1_024,
  maxConcurrency: 1,
  timeoutMs: 30_000,
  queryInstruction: "Given a search query, retrieve relevant passages that answer the query in French or English.",
});
const reranker = new TeiGrpcReranker({
  address: process.env.TEI_RERANKER_GRPC_ADDRESS ?? "127.0.0.1:8082",
  expectedModelId: process.env.TEI_RERANKER_RUNTIME_MODEL_ID ?? "csylabs/bge-reranker-v2-m3-int8-onnx",
  expectedModelSha: process.env.TEI_RERANKER_RUNTIME_MODEL_SHA ?? "eaf5072d7b1a3f1fa584cc7482c7efb8f784dca0",
  dimension: 0,
  timeoutMs: 30_000,
});

const database = createDatabase(databaseUrl);
const workspaceRows = await database.client<{ id: string }[]>`select id from workspaces order by created_at limit 1`;
const workspaceId = workspaceRows[0]?.id;
if (!workspaceId) throw new Error("KNOWLEDGE_BENCHMARK_WORKSPACE_REQUIRED");

const corpus = [
  {
    key: "fr-legal",
    language: "fr",
    locator: "page:1",
    text: "Retrouvez instantanément une clause juridique précise dans les dossiers du cabinet, avec une provenance vérifiable.",
  },
  {
    key: "en-legal",
    language: "en",
    locator: "slide:2",
    text: "Find a precise legal clause instantly across the firm's case files, with verifiable provenance.",
  },
  {
    key: "fr-recipe",
    language: "fr",
    locator: "sheet:Recettes!A1:D4",
    text: "Pour préparer un gâteau aux pommes, mélanger farine, cannelle et fruits avant cuisson.",
  },
  {
    key: "en-weather",
    language: "en",
    locator: "section:weather",
    text: "Tomorrow's weather forecast predicts sunshine and a light western wind.",
  },
] as const;

const documentIds = new Map<string, string>();
const knowledgeDocumentIds: string[] = [];

try {
  await Promise.all([embedding.info(), reranker.info()]);
  const vectors = await embedding.embedDocuments(corpus.map((entry) => entry.text));

  for (const [index, entry] of corpus.entries()) {
    const sourceId = randomUUID();
    const documentId = randomUUID();
    const chunkSetId = randomUUID();
    const chunkId = randomUUID();
    documentIds.set(entry.key, sourceId);
    knowledgeDocumentIds.push(documentId);
    await database.client.begin(async (sql) => {
      await sql`
        insert into knowledge_documents (
          id, workspace_id, source_type, source_id, title, format, language,
          validation_status, content_hash, tags, source_created_at
        ) values (
          ${documentId}, ${workspaceId}, 'research_document', ${sourceId}, ${`Benchmark ${entry.key}`},
          'text/plain', ${entry.language}, 'ready', ${hash(entry.text)}, '[]'::jsonb, now()
        )
      `;
      await sql`
        insert into knowledge_chunk_sets (
          id, workspace_id, document_id, chunker_id, chunker_version,
          configuration, configuration_hash, source_content_hash, status,
          chunk_count, activated_at
        ) values (
          ${chunkSetId}, ${workspaceId}, ${documentId}, 'benchmark', '1', '{}'::jsonb,
          ${hash("benchmark-v1")}, ${hash(entry.text)}, 'active', 1, now()
        )
      `;
      await sql`
        insert into knowledge_chunks (
          id, workspace_id, document_id, chunk_set_id, ordinal, locator, title,
          content, content_hash, token_count, language, source_type, format,
          validation_status, tags, metadata
        ) values (
          ${chunkId}, ${workspaceId}, ${documentId}, ${chunkSetId}, 0, ${entry.locator}, ${entry.key},
          ${entry.text}, ${hash(entry.text)}, ${Math.ceil(entry.text.length / 4)}, ${entry.language},
          'research_document', 'text/plain', 'ready', '[]'::jsonb,
          ${JSON.stringify({ benchmark: true, locator: entry.locator })}::jsonb
        )
      `;
      await sql.unsafe(
        `insert into knowledge_chunk_embeddings
          (id, workspace_id, chunk_id, model_revision_id, embedding, dimension, input_hash)
         values ($1, $2, $3, $4, $5::vector, 1024, $6)`,
        [randomUUID(), workspaceId, chunkId, QWEN_EMBEDDING_REVISION_ID, vectorLiteral(vectors[index]!), hash(entry.text)],
      );
    });
  }

  const search = new ParadeDbVersionedKnowledgeSearch(database.client, embedding, reranker);
  const noiseIds = [requiredId(documentIds, "fr-recipe"), requiredId(documentIds, "en-weather")];
  const cases = [
    { name: "FR-FR", query: "retrouver une clause juridique dans un dossier", expected: "fr-legal", ids: [requiredId(documentIds, "fr-legal"), ...noiseIds] },
    { name: "EN-EN", query: "find a legal clause in case files", expected: "en-legal", ids: [requiredId(documentIds, "en-legal"), ...noiseIds] },
    { name: "FR-EN", query: "retrouver une clause juridique dans un dossier", expected: "en-legal", ids: [requiredId(documentIds, "en-legal"), ...noiseIds] },
    { name: "EN-FR", query: "find a legal clause in case files", expected: "fr-legal", ids: [requiredId(documentIds, "fr-legal"), ...noiseIds] },
  ] as const;
  const latencies: number[] = [];
  const results = [];
  for (const testCase of cases) {
    const started = performance.now();
    const matches = await search.search({ workspaceId, documentIds: testCase.ids, query: testCase.query, limit: 10 });
    latencies.push(performance.now() - started);
    const expectedDocumentId = requiredId(documentIds, testCase.expected);
    const rank = matches.findIndex((match) => match.documentId === expectedDocumentId) + 1;
    results.push({
      name: testCase.name,
      rank,
      recallAt10: rank > 0 ? 1 : 0,
      ndcgAt10: rank > 0 ? 1 / Math.log2(rank + 1) : 0,
      mode: matches[0]?.searchMode ?? null,
      locator: matches[0]?.locator ?? null,
    });
  }

  const unavailableEmbedding: EmbeddingGateway = {
    info: () => Promise.reject(new Error("TEI_UNAVAILABLE")),
    embedDocuments: () => Promise.reject(new Error("TEI_UNAVAILABLE")),
    embedQuery: () => Promise.reject(new Error("TEI_UNAVAILABLE")),
  };
  const degradedSearch = new ParadeDbVersionedKnowledgeSearch(database.client, unavailableEmbedding);
  const degraded = await degradedSearch.search({
    workspaceId,
    documentIds: [requiredId(documentIds, "fr-recipe"), requiredId(documentIds, "fr-legal")],
    query: "gâteau pommes cannelle",
    limit: 10,
  });
  const isolated = await search.search({
    workspaceId: randomUUID(),
    documentIds: [...documentIds.values()],
    query: "legal clause",
    limit: 10,
  });
  await database.client`set enable_seqscan = off`;
  const explain = await database.client.unsafe<Record<string, string>[]>(`
    explain select id from knowledge_chunk_embeddings
    where model_revision_id = '${QWEN_EMBEDDING_REVISION_ID}'::uuid
    order by embedding::vector(1024) <=> '${vectorLiteral(vectors[0]!)}'::vector(1024)
    limit 10
  `);
  const explainLines = explain.map((row) => Object.values(row)[0] ?? "");
  const conciseExplain = explainLines.filter((line) => !line.includes("Order By:"));
  const output = {
    model: await embedding.info(),
    cases: results,
    recallAt10: average(results.map((result) => result.recallAt10)),
    ndcgAt10: average(results.map((result) => result.ndcgAt10)),
    p95Ms: percentile(latencies, 0.95),
    degradedMode: degraded[0]?.searchMode ?? null,
    degradedTopLocator: degraded[0]?.locator ?? null,
    isolatedWorkspaceResultCount: isolated.length,
    hnswSelected: explainLines.some((line) => line.includes("knowledge_chunk_embeddings_qwen_1024_hnsw_idx")),
    explain: conciseExplain,
  };
  console.log(JSON.stringify(output, null, 2));
  if (output.recallAt10 !== 1 || output.ndcgAt10 !== 1) throw new Error("KNOWLEDGE_BENCHMARK_RELEVANCE_FAILED");
  if (results.some((result) => result.mode !== "hybrid_reranked")) throw new Error("KNOWLEDGE_BENCHMARK_RERANKER_FAILED");
  if (output.degradedMode !== "lexical_degraded") throw new Error("KNOWLEDGE_BENCHMARK_DEGRADED_MODE_FAILED");
  if (output.isolatedWorkspaceResultCount !== 0) throw new Error("KNOWLEDGE_BENCHMARK_WORKSPACE_ISOLATION_FAILED");
  if (!output.hnswSelected) throw new Error("KNOWLEDGE_BENCHMARK_HNSW_NOT_SELECTED");
  if (output.p95Ms > 1_500) throw new Error("KNOWLEDGE_BENCHMARK_LATENCY_FAILED");
} finally {
  if (knowledgeDocumentIds.length > 0) {
    await database.client`delete from knowledge_documents where workspace_id = ${workspaceId} and id = any(${`{${knowledgeDocumentIds.join(",")}}`}::uuid[])`;
  }
  await database.close();
}

function requiredId(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`KNOWLEDGE_BENCHMARK_ID_MISSING:${key}`);
  return value;
}

function hash(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? Number.POSITIVE_INFINITY;
}
