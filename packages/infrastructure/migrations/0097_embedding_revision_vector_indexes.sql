ALTER TABLE "embedding_model_revisions"
ADD COLUMN "vector_index_name" varchar(63);--> statement-breakpoint

UPDATE "embedding_model_revisions"
SET "vector_index_name" = 'knowledge_chunk_embeddings_qwen_1024_hnsw_idx'
WHERE "id" = '00000000-0000-4000-8000-000000001024';
