ALTER TABLE "embedding_model_revisions"
ADD COLUMN "runtime_artifact_model_id" varchar(300),
ADD COLUMN "runtime_artifact_sha" varchar(64);--> statement-breakpoint

ALTER TABLE "knowledge_search_runtime"
ADD COLUMN "reranker_runtime_artifact_model_id" varchar(300),
ADD COLUMN "reranker_runtime_artifact_sha" varchar(64);--> statement-breakpoint

UPDATE "embedding_model_revisions"
SET
  "runtime_artifact_model_id" = 'janni-t/qwen3-embedding-0.6b-int8-tei-onnx',
  "runtime_artifact_sha" = '8fe0c238c7c48016d28e750413ca492024be3ddf',
  "configuration" = jsonb_build_object(
    'dimensions', 1024,
    'normalize', true,
    'queryInstruction', "query_instruction",
    'runtimeArtifactModelId', 'janni-t/qwen3-embedding-0.6b-int8-tei-onnx',
    'runtimeArtifactSha', '8fe0c238c7c48016d28e750413ca492024be3ddf',
    'quantization', 'int8'
  ),
  "configuration_hash" = '974b2b21e8277627f233712c1ba9c615fb3a3aabf4bff3845226dd991af7ff17'
WHERE "id" = '00000000-0000-4000-8000-000000001024';--> statement-breakpoint

UPDATE "knowledge_search_runtime"
SET
  "reranker_runtime_artifact_model_id" = 'csylabs/bge-reranker-v2-m3-int8-onnx',
  "reranker_runtime_artifact_sha" = 'eaf5072d7b1a3f1fa584cc7482c7efb8f784dca0',
  "updated_at" = now()
WHERE "singleton" = true;--> statement-breakpoint

ALTER TABLE "embedding_model_revisions"
ALTER COLUMN "runtime_artifact_model_id" SET NOT NULL,
ALTER COLUMN "runtime_artifact_sha" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "knowledge_search_runtime"
ALTER COLUMN "reranker_runtime_artifact_model_id" SET NOT NULL,
ALTER COLUMN "reranker_runtime_artifact_sha" SET NOT NULL;
