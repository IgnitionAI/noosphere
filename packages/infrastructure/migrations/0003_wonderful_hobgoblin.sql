CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_search;--> statement-breakpoint
CREATE TYPE "public"."research_document_status" AS ENUM('uploading', 'uploaded', 'processing', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TABLE "ai_tool_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_research_run_id" uuid,
	"research_stage_run_id" uuid,
	"correlation_id" varchar(200) NOT NULL,
	"tool_name" varchar(120) NOT NULL,
	"status" varchar(40) NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latency_ms" integer NOT NULL,
	"error_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_research_run_documents" (
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_research_run_documents_workspace_id_run_id_document_id_pk" PRIMARY KEY("workspace_id","run_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "research_document_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"token_count" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_document_chunks_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "research_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"filename" varchar(500) NOT NULL,
	"content_type" varchar(200) NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"object_key" text NOT NULL,
	"status" "research_document_status" DEFAULT 'uploading' NOT NULL,
	"extracted_markdown" text,
	"failure_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "research_documents_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_tool_runs" ADD CONSTRAINT "ai_tool_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_run_documents" ADD CONSTRAINT "product_research_run_documents_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_run_documents" ADD CONSTRAINT "product_research_run_documents_workspace_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."research_documents"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_document_chunks" ADD CONSTRAINT "research_document_chunks_workspace_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."research_documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_documents" ADD CONSTRAINT "research_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_tool_runs_workspace_run_idx" ON "ai_tool_runs" USING btree ("workspace_id","product_research_run_id");--> statement-breakpoint
CREATE INDEX "ai_tool_runs_stage_idx" ON "ai_tool_runs" USING btree ("workspace_id","research_stage_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_document_chunks_ordinal_uq" ON "research_document_chunks" USING btree ("workspace_id","document_id","ordinal");--> statement-breakpoint
CREATE INDEX "research_document_chunks_workspace_document_idx" ON "research_document_chunks" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE INDEX "research_document_chunks_bm25_idx" ON "research_document_chunks"
USING bm25 ("id", "content", "workspace_id", "document_id")
WITH (key_field = 'id');--> statement-breakpoint
CREATE INDEX "research_document_chunks_embedding_hnsw_idx" ON "research_document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "research_documents_workspace_checksum_uq" ON "research_documents" USING btree ("workspace_id","checksum_sha256");--> statement-breakpoint
CREATE INDEX "research_documents_workspace_status_idx" ON "research_documents" USING btree ("workspace_id","status");
