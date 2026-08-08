ALTER TABLE "prospect_discovery_runs" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;
