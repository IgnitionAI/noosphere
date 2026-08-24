DO $$ BEGIN
  CREATE TYPE "public"."signal_type" AS ENUM('hiring', 'funding', 'job_change', 'leadership_change', 'geographic_expansion', 'public_activity', 'technology', 'competitor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."signal_collection_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signal_collection_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "company_id" uuid,
  "contact_id" uuid,
  "request_key" varchar(500) NOT NULL,
  "status" "signal_collection_status" DEFAULT 'queued' NOT NULL,
  "source" varchar(200) NOT NULL,
  "error_code" varchar(120),
  "error_message" text,
  "requested_by" uuid,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "signal_collection_runs_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "signal_collection_runs_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade,
  CONSTRAINT "signal_collection_runs_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade,
  CONSTRAINT "signal_collection_runs_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."auth_users"("id") ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signal_collection_runs_workspace_request_uq" ON "signal_collection_runs" USING btree ("workspace_id", "request_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_collection_runs_workspace_status_idx" ON "signal_collection_runs" USING btree ("workspace_id", "status", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signals" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "signal_type" "signal_type" NOT NULL,
  "entity_type" varchar(30) NOT NULL,
  "entity_id" uuid NOT NULL,
  "company_id" uuid,
  "contact_id" uuid,
  "source" varchar(200) NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provider_event_id" varchar(500),
  "evidence_url" text NOT NULL,
  "evidence_snippet" text,
  "observed_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "confidence" varchar(20) NOT NULL,
  "deduplication_key" varchar(700) NOT NULL,
  "legal_basis" varchar(200) NOT NULL,
  "source_authorized" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "signals_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "signals_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade,
  CONSTRAINT "signals_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signals_workspace_dedup_uq" ON "signals" USING btree ("workspace_id", "deduplication_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_workspace_entity_expiry_idx" ON "signals" USING btree ("workspace_id", "entity_type", "entity_id", "expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_workspace_type_expiry_idx" ON "signals" USING btree ("workspace_id", "signal_type", "expires_at");
