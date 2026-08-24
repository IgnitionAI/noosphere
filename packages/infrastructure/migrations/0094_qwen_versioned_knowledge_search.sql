CREATE TYPE "public"."embedding_model_status" AS ENUM('registered', 'backfilling', 'validating', 'active', 'retired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_document_source_type" AS ENUM('research_document', 'knowledge_source', 'offer', 'proof');--> statement-breakpoint
CREATE TYPE "public"."knowledge_index_status" AS ENUM('building', 'ready', 'active', 'failed', 'retired');--> statement-breakpoint

-- Development contains test vectors only. OpenAI's vector space is deliberately
-- removed instead of copied into the Qwen index.
DROP TABLE IF EXISTS "research_document_chunks" CASCADE;--> statement-breakpoint

CREATE TABLE "embedding_model_revisions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "provider" varchar(40) NOT NULL,
  "model_id" varchar(300) NOT NULL,
  "model_sha" varchar(64) NOT NULL,
  "dimension" integer NOT NULL,
  "distance_metric" varchar(40) DEFAULT 'cosine' NOT NULL,
  "normalized" boolean DEFAULT true NOT NULL,
  "query_instruction" text NOT NULL,
  "configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "configuration_hash" varchar(64) NOT NULL,
  "status" "embedding_model_status" DEFAULT 'registered' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "activated_at" timestamp with time zone,
  "retired_at" timestamp with time zone,
  CONSTRAINT "embedding_model_revisions_dimension_ck" CHECK ("dimension" between 1 and 4096),
  CONSTRAINT "embedding_model_revisions_metric_ck" CHECK ("distance_metric" = 'cosine')
);--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_model_revisions_identity_uq" ON "embedding_model_revisions" ("provider", "model_id", "model_sha", "configuration_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_model_revisions_one_active_uq" ON "embedding_model_revisions" ((true)) WHERE "status" = 'active';--> statement-breakpoint

CREATE TABLE "knowledge_search_runtime" (
  "singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
  "active_model_revision_id" uuid NOT NULL,
  "reranker_model_id" varchar(300) NOT NULL,
  "reranker_model_sha" varchar(64) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_search_runtime_singleton_ck" CHECK ("singleton" = true),
  CONSTRAINT "knowledge_search_runtime_active_model_fk" FOREIGN KEY ("active_model_revision_id") REFERENCES "embedding_model_revisions"("id") ON DELETE restrict
);--> statement-breakpoint

CREATE TABLE "knowledge_documents" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source_type" "knowledge_document_source_type" NOT NULL,
  "source_id" uuid NOT NULL,
  "title" varchar(500) NOT NULL,
  "format" varchar(100) NOT NULL,
  "language" varchar(20),
  "validation_status" varchar(40) NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "offer_id" uuid,
  "icp_id" uuid,
  "run_id" uuid,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_created_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_documents_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "knowledge_documents_workspace_id_uq" UNIQUE("workspace_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_source_uq" ON "knowledge_documents" ("workspace_id", "source_type", "source_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_filters_idx" ON "knowledge_documents" ("workspace_id", "validation_status", "source_type", "format");--> statement-breakpoint
CREATE INDEX "knowledge_documents_offer_icp_run_idx" ON "knowledge_documents" ("workspace_id", "offer_id", "icp_id", "run_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_tags_gin_idx" ON "knowledge_documents" USING gin ("tags");--> statement-breakpoint

CREATE TABLE "knowledge_chunk_sets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "chunker_id" varchar(100) NOT NULL,
  "chunker_version" varchar(40) NOT NULL,
  "configuration" jsonb NOT NULL,
  "configuration_hash" varchar(64) NOT NULL,
  "source_content_hash" varchar(64) NOT NULL,
  "status" "knowledge_index_status" DEFAULT 'building' NOT NULL,
  "chunk_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "activated_at" timestamp with time zone,
  "retired_at" timestamp with time zone,
  CONSTRAINT "knowledge_chunk_sets_workspace_document_fk" FOREIGN KEY ("workspace_id", "document_id") REFERENCES "knowledge_documents"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "knowledge_chunk_sets_workspace_id_uq" UNIQUE("workspace_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunk_sets_revision_uq" ON "knowledge_chunk_sets" ("workspace_id", "document_id", "chunker_id", "chunker_version", "configuration_hash", "source_content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunk_sets_one_active_uq" ON "knowledge_chunk_sets" ("workspace_id", "document_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "knowledge_chunk_sets_active_idx" ON "knowledge_chunk_sets" ("workspace_id", "document_id", "status");--> statement-breakpoint

CREATE TABLE "knowledge_chunks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "chunk_set_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "locator" varchar(500),
  "title" varchar(500),
  "content" text NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "token_count" integer NOT NULL,
  "language" varchar(20),
  "source_type" "knowledge_document_source_type" NOT NULL,
  "format" varchar(100) NOT NULL,
  "validation_status" varchar(40) NOT NULL,
  "offer_id" uuid,
  "icp_id" uuid,
  "run_id" uuid,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_chunks_workspace_document_fk" FOREIGN KEY ("workspace_id", "document_id") REFERENCES "knowledge_documents"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "knowledge_chunks_workspace_set_fk" FOREIGN KEY ("workspace_id", "chunk_set_id") REFERENCES "knowledge_chunk_sets"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "knowledge_chunks_workspace_id_uq" UNIQUE("workspace_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_ordinal_uq" ON "knowledge_chunks" ("workspace_id", "chunk_set_id", "ordinal");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_filters_idx" ON "knowledge_chunks" ("workspace_id", "validation_status", "source_type", "format");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_document_idx" ON "knowledge_chunks" ("workspace_id", "document_id", "chunk_set_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tags_gin_idx" ON "knowledge_chunks" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_bm25_idx" ON "knowledge_chunks"
USING bm25 ("id", "content", "workspace_id", "document_id", "source_type", "format", "validation_status")
WITH (key_field = 'id');--> statement-breakpoint

CREATE TABLE "knowledge_chunk_embeddings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL,
  "model_revision_id" uuid NOT NULL,
  "embedding" vector NOT NULL,
  "dimension" integer NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_chunk_embeddings_workspace_chunk_fk" FOREIGN KEY ("workspace_id", "chunk_id") REFERENCES "knowledge_chunks"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "knowledge_chunk_embeddings_model_fk" FOREIGN KEY ("model_revision_id") REFERENCES "embedding_model_revisions"("id") ON DELETE cascade,
  CONSTRAINT "knowledge_chunk_embeddings_dimension_ck" CHECK (vector_dims("embedding") = "dimension")
);--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunk_embeddings_revision_uq" ON "knowledge_chunk_embeddings" ("workspace_id", "chunk_id", "model_revision_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embeddings_workspace_revision_idx" ON "knowledge_chunk_embeddings" ("workspace_id", "model_revision_id");--> statement-breakpoint

CREATE TABLE "embedding_reindex_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "model_revision_id" uuid NOT NULL,
  "status" "knowledge_index_status" DEFAULT 'building' NOT NULL,
  "eligible_chunks" integer DEFAULT 0 NOT NULL,
  "embedded_chunks" integer DEFAULT 0 NOT NULL,
  "failed_chunks" integer DEFAULT 0 NOT NULL,
  "checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "quality_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "capacity_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "correlation_id" varchar(200) NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  CONSTRAINT "embedding_reindex_runs_model_fk" FOREIGN KEY ("model_revision_id") REFERENCES "embedding_model_revisions"("id") ON DELETE restrict
);--> statement-breakpoint

INSERT INTO "embedding_model_revisions" (
  "id", "provider", "model_id", "model_sha", "dimension", "distance_metric",
  "normalized", "query_instruction", "configuration", "configuration_hash", "status", "activated_at"
) VALUES (
  '00000000-0000-4000-8000-000000001024',
  'tei',
  'Qwen/Qwen3-Embedding-0.6B',
  '97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3',
  1024,
  'cosine',
  true,
  'Given a search query, retrieve relevant passages that answer the query in French or English.',
  '{"dimensions":1024,"normalize":true,"queryInstruction":"Given a search query, retrieve relevant passages that answer the query in French or English."}'::jsonb,
  '11c34683e8d1dc9352a9a225f94142893cd078f86c01d819113f3be6c4247b05',
  'active',
  now()
);--> statement-breakpoint

INSERT INTO "knowledge_search_runtime" (
  "singleton", "active_model_revision_id", "reranker_model_id", "reranker_model_sha"
) VALUES (
  true,
  '00000000-0000-4000-8000-000000001024',
  'BAAI/bge-reranker-v2-m3',
  '953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e'
);--> statement-breakpoint

CREATE INDEX "knowledge_chunk_embeddings_qwen_1024_hnsw_idx"
ON "knowledge_chunk_embeddings"
USING hnsw (("embedding"::vector(1024)) vector_cosine_ops)
WHERE "model_revision_id" = '00000000-0000-4000-8000-000000001024';
--> statement-breakpoint

-- Every eligible development document is rebuilt into the Qwen vector space.
-- Reusing the existing durable job keeps the operation restartable and the
-- document worker itself verifies whether an active chunk set already exists.
UPDATE "jobs" AS j
SET status = 'pending', attempts = 0, available_at = now(), locked_at = NULL,
    locked_until = NULL, locked_by = NULL, completed_at = NULL,
    last_error_code = NULL, last_error_message = NULL, updated_at = now()
FROM "research_documents" AS d
WHERE d.workspace_id = j.workspace_id
  AND j.type = 'research.document.process'
  AND j.idempotency_key = d.id::text || ':process'
  AND d.status = 'ready'
  AND d.deleted_at IS NULL;
--> statement-breakpoint

INSERT INTO "jobs" (
  id, workspace_id, type, payload, idempotency_key, correlation_id,
  status, attempts, max_attempts, priority, available_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), d.workspace_id, 'research.document.process',
  jsonb_build_object('workspaceId', d.workspace_id, 'documentId', d.id),
  d.id::text || ':process', 'qwen-reindex:' || d.id::text,
  'pending', 0, 3, 0, now(), now(), now()
FROM "research_documents" d
WHERE d.status = 'ready'
  AND d.deleted_at IS NULL
ON CONFLICT (workspace_id, type, idempotency_key) DO NOTHING;
