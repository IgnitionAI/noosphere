ALTER TABLE "embedding_model_revisions"
ADD COLUMN "retire_after" timestamp with time zone;--> statement-breakpoint

ALTER TYPE "knowledge_index_status" ADD VALUE IF NOT EXISTS 'validating' AFTER 'ready';
