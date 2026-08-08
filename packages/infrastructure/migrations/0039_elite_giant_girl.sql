CREATE TYPE "public"."daily_sourcing_cycle_status" AS ENUM('scheduled', 'running', 'completed', 'partial', 'failed', 'action_required');--> statement-breakpoint
CREATE TYPE "public"."phone_attribution_status" AS ENUM('strong', 'weak', 'conflict', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."phone_endpoint_kind" AS ENUM('person', 'company');--> statement-breakpoint
CREATE TYPE "public"."sourcing_frontier_status" AS ENUM('active', 'saturated', 'paused');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_reachability_status" AS ENUM('verified', 'not_registered', 'unknown');--> statement-breakpoint
CREATE TABLE "contact_channel_assignments" (
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "prospecting_channel" NOT NULL,
	"campaign_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"score_version" varchar(80) NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_channel_assignments_workspace_id_contact_id_channel_pk" PRIMARY KEY("workspace_id","contact_id","channel")
);
--> statement-breakpoint
CREATE TABLE "daily_sourcing_cycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"local_date" varchar(10) NOT NULL,
	"timezone" varchar(120) DEFAULT 'Europe/Paris' NOT NULL,
	"status" "daily_sourcing_cycle_status" DEFAULT 'scheduled' NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"page_limit" integer DEFAULT 150 NOT NULL,
	"page_attempts" integer DEFAULT 0 NOT NULL,
	"verification_limit" integer DEFAULT 60 NOT NULL,
	"verification_attempts" integer DEFAULT 0 NOT NULL,
	"max_pages_per_company" integer DEFAULT 4 NOT NULL,
	"max_concurrent_per_domain" integer DEFAULT 2 NOT NULL,
	"active_icp_count" integer DEFAULT 0 NOT NULL,
	"scheduled_run_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" varchar(120),
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sourcing_cycle_id" uuid,
	"sourcing_frontier_id" uuid,
	"logical_fingerprint" varchar(128) NOT NULL,
	"e164" varchar(32),
	"raw_value" varchar(120),
	"endpoint_kind" "phone_endpoint_kind" NOT NULL,
	"company_name" varchar(300) NOT NULL,
	"company_domain" varchar(300),
	"company_fingerprint" varchar(128) NOT NULL,
	"person_name" varchar(300),
	"person_role" varchar(300),
	"attribution_status" "phone_attribution_status" NOT NULL,
	"attribution_reason" text NOT NULL,
	"source_kind" varchar(80) NOT NULL,
	"source_url" varchar(1200) NOT NULL,
	"evidence_snippet" text NOT NULL,
	"content_hash" varchar(128),
	"reachability_status" "whatsapp_reachability_status" DEFAULT 'unknown' NOT NULL,
	"provider_account_id" text,
	"reachability_checked_at" timestamp with time zone,
	"reachability_expires_at" timestamp with time zone,
	"rejection_reason" varchar(160),
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"contradicted_at" timestamp with time zone,
	"raw_retain_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_frontiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"icp_version_id" uuid NOT NULL,
	"channel" varchar(40) DEFAULT 'whatsapp' NOT NULL,
	"source_kind" varchar(80) DEFAULT 'web' NOT NULL,
	"region_key" varchar(120) DEFAULT 'fr-metropolitan' NOT NULL,
	"query_seed" text NOT NULL,
	"query_fingerprint" varchar(128) NOT NULL,
	"status" "sourcing_frontier_status" DEFAULT 'active' NOT NULL,
	"rotation_ordinal" integer DEFAULT 0 NOT NULL,
	"consecutive_empty_runs" integer DEFAULT 0 NOT NULL,
	"page_attempts" integer DEFAULT 0 NOT NULL,
	"verified_found" integer DEFAULT 0 NOT NULL,
	"yield_ema" numeric(10, 6) DEFAULT '0' NOT NULL,
	"next_eligible_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_yield_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_reachability_checks" (
	"workspace_id" uuid NOT NULL,
	"provider_account_id" text NOT NULL,
	"e164" varchar(32) NOT NULL,
	"status" "whatsapp_reachability_status" NOT NULL,
	"source" varchar(120) DEFAULT 'unipile' NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_error_code" varchar(120),
	"response_hash" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_reachability_checks_workspace_id_provider_account_id_e164_pk" PRIMARY KEY("workspace_id","provider_account_id","e164")
);
--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD COLUMN "identity_fingerprint" varchar(128);--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD COLUMN "sourcing_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD COLUMN "sourcing_frontier_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_channel_assignments" ADD CONSTRAINT "contact_channel_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channel_assignments" ADD CONSTRAINT "contact_channel_assignments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channel_assignments" ADD CONSTRAINT "contact_channel_assignments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channel_assignments" ADD CONSTRAINT "contact_channel_assignments_candidate_id_prospect_discovery_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."prospect_discovery_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sourcing_cycles" ADD CONSTRAINT "daily_sourcing_cycles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_observations" ADD CONSTRAINT "phone_observations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_observations" ADD CONSTRAINT "phone_observations_run_id_prospect_discovery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prospect_discovery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_observations" ADD CONSTRAINT "phone_observations_sourcing_cycle_id_daily_sourcing_cycles_id_fk" FOREIGN KEY ("sourcing_cycle_id") REFERENCES "public"."daily_sourcing_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_observations" ADD CONSTRAINT "phone_observations_sourcing_frontier_id_sourcing_frontiers_id_fk" FOREIGN KEY ("sourcing_frontier_id") REFERENCES "public"."sourcing_frontiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_frontiers" ADD CONSTRAINT "sourcing_frontiers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_frontiers" ADD CONSTRAINT "sourcing_frontiers_icp_version_id_icp_versions_id_fk" FOREIGN KEY ("icp_version_id") REFERENCES "public"."icp_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_reachability_checks" ADD CONSTRAINT "whatsapp_reachability_checks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_channel_assignments_campaign_idx" ON "contact_channel_assignments" USING btree ("workspace_id","campaign_id","assigned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_sourcing_cycles_workspace_date_uq" ON "daily_sourcing_cycles" USING btree ("workspace_id","local_date");--> statement-breakpoint
CREATE INDEX "daily_sourcing_cycles_workspace_status_idx" ON "daily_sourcing_cycles" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_observations_logical_uq" ON "phone_observations" USING btree ("workspace_id","logical_fingerprint");--> statement-breakpoint
CREATE INDEX "phone_observations_e164_idx" ON "phone_observations" USING btree ("workspace_id","e164","attribution_status");--> statement-breakpoint
CREATE INDEX "phone_observations_cycle_idx" ON "phone_observations" USING btree ("workspace_id","sourcing_cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_frontiers_logical_uq" ON "sourcing_frontiers" USING btree ("workspace_id","icp_version_id","channel","source_kind","region_key","query_fingerprint");--> statement-breakpoint
CREATE INDEX "sourcing_frontiers_due_idx" ON "sourcing_frontiers" USING btree ("workspace_id","channel","status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "whatsapp_reachability_expiry_idx" ON "whatsapp_reachability_checks" USING btree ("workspace_id","expires_at");--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD CONSTRAINT "prospect_discovery_runs_sourcing_cycle_id_daily_sourcing_cycles_id_fk" FOREIGN KEY ("sourcing_cycle_id") REFERENCES "public"."daily_sourcing_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD CONSTRAINT "prospect_discovery_runs_sourcing_frontier_id_sourcing_frontiers_id_fk" FOREIGN KEY ("sourcing_frontier_id") REFERENCES "public"."sourcing_frontiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_suppressions_hmac_uq" ON "contact_suppressions" USING btree ("workspace_id","identity_type","identity_fingerprint") WHERE "contact_suppressions"."identity_fingerprint" is not null;--> statement-breakpoint
CREATE INDEX "prospect_discovery_runs_cycle_idx" ON "prospect_discovery_runs" USING btree ("workspace_id","sourcing_cycle_id");