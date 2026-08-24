DO $$ BEGIN
  CREATE TYPE "public"."enrichment_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."enrichment_observation_status" AS ENUM('found', 'probable', 'verified', 'invalid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."enrichment_phone_kind" AS ENUM('public_company', 'personal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment_jobs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "entity_type" varchar(30) NOT NULL,
  "entity_id" uuid NOT NULL,
  "request_key" varchar(500) NOT NULL,
  "status" "enrichment_job_status" DEFAULT 'queued' NOT NULL,
  "provider" varchar(120) DEFAULT 'crawler' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "correlation_id" varchar(200) NOT NULL,
  "error_code" varchar(120),
  "error_message" text,
  "requested_by" uuid,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enrichment_jobs_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "enrichment_jobs_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."auth_users"("id") ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enrichment_jobs_workspace_request_key_uq" ON "enrichment_jobs" USING btree ("workspace_id", "request_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_jobs_workspace_status_idx" ON "enrichment_jobs" USING btree ("workspace_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_jobs_entity_idx" ON "enrichment_jobs" USING btree ("workspace_id", "entity_type", "entity_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment_observations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "entity_type" varchar(30) NOT NULL,
  "entity_id" uuid NOT NULL,
  "contact_id" uuid,
  "company_id" uuid,
  "field" varchar(160) NOT NULL,
  "value" text NOT NULL,
  "normalized_value" text NOT NULL,
  "status" "enrichment_observation_status" NOT NULL,
  "confidence" varchar(20) DEFAULT 'none' NOT NULL,
  "source" varchar(200) NOT NULL,
  "provider" varchar(120),
  "evidence_url" text,
  "evidence_snippet" text,
  "phone_kind" "enrichment_phone_kind",
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enrichment_observations_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "enrichment_observations_job_fk" FOREIGN KEY ("job_id") REFERENCES "public"."enrichment_jobs"("id") ON DELETE cascade,
  CONSTRAINT "enrichment_observations_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade,
  CONSTRAINT "enrichment_observations_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enrichment_observations_contact_value_uq" ON "enrichment_observations" USING btree ("workspace_id", "contact_id", "field", "normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enrichment_observations_company_value_uq" ON "enrichment_observations" USING btree ("workspace_id", "company_id", "field", "normalized_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_observations_entity_idx" ON "enrichment_observations" USING btree ("workspace_id", "entity_type", "entity_id", "field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_observations_job_idx" ON "enrichment_observations" USING btree ("workspace_id", "job_id");
