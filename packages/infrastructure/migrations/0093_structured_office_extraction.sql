ALTER TYPE "public"."research_document_status" ADD VALUE IF NOT EXISTS 'partial';
--> statement-breakpoint
ALTER TYPE "public"."research_document_status" ADD VALUE IF NOT EXISTS 'ocr_required';
--> statement-breakpoint
ALTER TABLE "research_documents"
  ADD COLUMN IF NOT EXISTS "extraction_provider" varchar(40),
  ADD COLUMN IF NOT EXISTS "extraction_duration_ms" integer,
  ADD COLUMN IF NOT EXISTS "extraction_metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "extraction_warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "extracted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "research_document_chunks"
  ADD COLUMN IF NOT EXISTS "locator" varchar(500);
--> statement-breakpoint
INSERT INTO "jobs" (
  id, workspace_id, type, payload, idempotency_key, correlation_id,
  status, attempts, max_attempts, priority, available_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), d.workspace_id, 'research.document.process',
  jsonb_build_object('workspaceId', d.workspace_id, 'documentId', d.id),
  d.id::text || ':process', 'document-migration:' || d.id::text,
  'pending', 0, 3, 0, now(), now(), now()
FROM "research_documents" d
WHERE d.status = 'failed'
  AND d.content_type IN (
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
  AND d.failure_code IN (
    'DOCUMENT_FORMAT_UNSUPPORTED_BY_LIGHTWEIGHT_EXTRACTOR',
    'RESEARCH_DOCUMENT_PROCESSING_FAILED',
    'DOCUMENT_PDF_EXTRACTION_FAILED'
  )
ON CONFLICT (workspace_id, type, idempotency_key) DO NOTHING;
--> statement-breakpoint
UPDATE "jobs" AS j
SET
  status = 'pending',
  attempts = 0,
  available_at = now(),
  locked_at = NULL,
  locked_until = NULL,
  locked_by = NULL,
  completed_at = NULL,
  last_error_code = NULL,
  last_error_message = NULL,
  updated_at = now()
FROM "research_documents" AS d
WHERE d.workspace_id = j.workspace_id
  AND j.type = 'research.document.process'
  AND j.idempotency_key = d.id::text || ':process'
  AND d.status = 'failed'
  AND d.content_type IN (
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
  AND d.failure_code IN (
    'DOCUMENT_FORMAT_UNSUPPORTED_BY_LIGHTWEIGHT_EXTRACTOR',
    'RESEARCH_DOCUMENT_PROCESSING_FAILED',
    'DOCUMENT_PDF_EXTRACTION_FAILED'
  );
--> statement-breakpoint
UPDATE "research_documents"
SET status = 'uploaded', failure_code = NULL, updated_at = now()
WHERE status = 'failed'
  AND content_type IN (
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
  AND failure_code IN (
    'DOCUMENT_FORMAT_UNSUPPORTED_BY_LIGHTWEIGHT_EXTRACTOR',
    'RESEARCH_DOCUMENT_PROCESSING_FAILED',
    'DOCUMENT_PDF_EXTRACTION_FAILED'
  )
  AND EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.workspace_id = research_documents.workspace_id
      AND j.type = 'research.document.process'
      AND j.idempotency_key = research_documents.id::text || ':process'
      AND j.status = 'pending'
  );
