ALTER TABLE "contacts" ADD COLUMN "privacy_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE TABLE "workspace_prospect_memory_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"capture_enabled" boolean DEFAULT false NOT NULL,
	"shadow_enabled" boolean DEFAULT false NOT NULL,
	"setter_enabled" boolean DEFAULT false NOT NULL,
	"enabled_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"processing_profiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_daily_semantic_refreshes" integer DEFAULT 1000 NOT NULL,
	"max_daily_cost_usd" numeric(12, 4) DEFAULT '10' NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_prospect_memory_refresh_budget_ck" CHECK ("workspace_prospect_memory_settings"."max_daily_semantic_refreshes" >= 0),
	CONSTRAINT "workspace_prospect_memory_cost_budget_ck" CHECK ("workspace_prospect_memory_settings"."max_daily_cost_usd" >= 0)
);--> statement-breakpoint

CREATE TABLE "prospect_memory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" bigserial NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_contact_id" uuid NOT NULL,
	"canonical_contact_id" uuid NOT NULL,
	"source_kind" varchar(80) NOT NULL,
	"source_id" varchar(300) NOT NULL,
	"source_version" bigint DEFAULT 1 NOT NULL,
	"kind" varchar(80) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"supersedes_event_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_memory_events_sequence_id_unique" UNIQUE("sequence_id"),
	CONSTRAINT "prospect_memory_events_source_version_ck" CHECK ("prospect_memory_events"."source_version" > 0),
	CONSTRAINT "prospect_memory_events_schema_version_ck" CHECK ("prospect_memory_events"."schema_version" > 0),
	CONSTRAINT "prospect_memory_events_validity_ck" CHECK ("prospect_memory_events"."valid_to" is null or "prospect_memory_events"."valid_to" > "prospect_memory_events"."valid_from"),
	CONSTRAINT "prospect_memory_events_kind_ck" CHECK ("prospect_memory_events"."kind" in ('message_received','message_sent','call_recorded','social_interaction','contact_updated','employment_updated','campaign_changed','decision_changed','identity_linked','identity_unlinked','contact_anonymized'))
);--> statement-breakpoint

CREATE TABLE "prospect_memory_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"watermark" bigint NOT NULL,
	"first_sequence_id" bigint NOT NULL,
	"privacy_epoch" integer NOT NULL,
	"status" varchar(40) NOT NULL,
	"current_state" jsonb NOT NULL,
	"commercial_state" jsonb NOT NULL,
	"assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relationship_summary" text DEFAULT '' NOT NULL,
	"recommended_tone" varchar(300),
	"contradictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_provider" varchar(120),
	"model" varchar(200),
	"prompt_version" varchar(120) NOT NULL,
	"policy_version" varchar(120) NOT NULL,
	"schema_version" integer NOT NULL,
	"renderer_version" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_memory_snapshots_workspace_id_uq" UNIQUE("workspace_id", "id"),
	CONSTRAINT "prospect_memory_snapshots_version_ck" CHECK ("prospect_memory_snapshots"."version" > 0),
	CONSTRAINT "prospect_memory_snapshots_watermark_ck" CHECK ("prospect_memory_snapshots"."watermark" >= "prospect_memory_snapshots"."first_sequence_id"),
	CONSTRAINT "prospect_memory_snapshots_privacy_epoch_ck" CHECK ("prospect_memory_snapshots"."privacy_epoch" >= 0),
	CONSTRAINT "prospect_memory_snapshots_status_ck" CHECK ("prospect_memory_snapshots"."status" in ('fresh','refreshing','stale','budget_blocked','failed','anonymized'))
);--> statement-breakpoint

CREATE TABLE "prospect_memory_context_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"request_key" varchar(300) NOT NULL,
	"capability" varchar(80) NOT NULL,
	"snapshot_id" uuid,
	"snapshot_version" integer,
	"watermark" bigint NOT NULL,
	"privacy_epoch" integer NOT NULL,
	"renderer_version" integer NOT NULL,
	"source_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_source_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"normalized_retrieval_queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_input_tokens" integer NOT NULL,
	"context_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_memory_context_receipts_tokens_ck" CHECK ("prospect_memory_context_receipts"."estimated_input_tokens" >= 0),
	CONSTRAINT "prospect_memory_context_receipts_capability_ck" CHECK ("prospect_memory_context_receipts"."capability" in ('setter_campaign','draft_improvement','scoring','outbound_drafting','call_preparation','inbound_aggregate'))
);--> statement-breakpoint

ALTER TABLE "workspace_prospect_memory_settings" ADD CONSTRAINT "workspace_prospect_memory_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_prospect_memory_settings" ADD CONSTRAINT "workspace_prospect_memory_settings_updated_by_auth_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_memory_events" ADD CONSTRAINT "prospect_memory_events_source_contact_fk" FOREIGN KEY ("workspace_id", "source_contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_memory_events" ADD CONSTRAINT "prospect_memory_events_canonical_contact_fk" FOREIGN KEY ("workspace_id", "canonical_contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_memory_events" ADD CONSTRAINT "prospect_memory_events_supersedes_fk" FOREIGN KEY ("supersedes_event_id") REFERENCES "public"."prospect_memory_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_memory_snapshots" ADD CONSTRAINT "prospect_memory_snapshots_contact_fk" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_memory_context_receipts" ADD CONSTRAINT "prospect_memory_context_receipts_contact_fk" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_memory_context_receipts" ADD CONSTRAINT "prospect_memory_context_receipts_snapshot_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."prospect_memory_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "prospect_memory_events_source_uq" ON "prospect_memory_events" USING btree ("workspace_id", "source_kind", "source_id", "source_version");--> statement-breakpoint
CREATE INDEX "prospect_memory_events_contact_sequence_idx" ON "prospect_memory_events" USING btree ("workspace_id", "canonical_contact_id", "sequence_id");--> statement-breakpoint
CREATE INDEX "prospect_memory_events_source_contact_sequence_idx" ON "prospect_memory_events" USING btree ("workspace_id", "source_contact_id", "sequence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_memory_snapshots_version_uq" ON "prospect_memory_snapshots" USING btree ("workspace_id", "contact_id", "version");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_memory_snapshots_current_uq" ON "prospect_memory_snapshots" USING btree ("workspace_id", "contact_id") WHERE "superseded_at" is null and "invalidated_at" is null;--> statement-breakpoint
CREATE INDEX "prospect_memory_snapshots_contact_generated_idx" ON "prospect_memory_snapshots" USING btree ("workspace_id", "contact_id", "generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_memory_context_receipts_request_uq" ON "prospect_memory_context_receipts" USING btree ("workspace_id", "request_key");--> statement-breakpoint
CREATE INDEX "prospect_memory_context_receipts_contact_created_idx" ON "prospect_memory_context_receipts" USING btree ("workspace_id", "contact_id", "created_at");
