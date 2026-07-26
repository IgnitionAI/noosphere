CREATE TYPE "public"."discovery_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "prospect_discovery_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"full_name" varchar(300) NOT NULL,
	"headline" text,
	"linkedin_url" varchar(600),
	"linkedin_normalized" varchar(600),
	"location" varchar(300),
	"company_name" varchar(300),
	"provider_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icp_fit" jsonb DEFAULT '{"matches":[],"gaps":[]}'::jsonb NOT NULL,
	"imported_contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_discovery_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"icp_version_id" uuid NOT NULL,
	"provider" varchar(80) DEFAULT 'unipile' NOT NULL,
	"filters" jsonb NOT NULL,
	"status" "discovery_run_status" DEFAULT 'running' NOT NULL,
	"error_code" varchar(120),
	"error_message" text,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "prospect_discovery_candidates" ADD CONSTRAINT "prospect_discovery_candidates_run_id_prospect_discovery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prospect_discovery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_discovery_candidates" ADD CONSTRAINT "prospect_discovery_candidates_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD CONSTRAINT "prospect_discovery_runs_icp_version_id_icp_versions_id_fk" FOREIGN KEY ("icp_version_id") REFERENCES "public"."icp_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD CONSTRAINT "prospect_discovery_runs_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD CONSTRAINT "prospect_discovery_runs_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_discovery_candidates_run_linkedin_uq" ON "prospect_discovery_candidates" USING btree ("workspace_id","run_id","linkedin_normalized") WHERE "prospect_discovery_candidates"."linkedin_normalized" is not null;--> statement-breakpoint
CREATE INDEX "prospect_discovery_runs_version_idx" ON "prospect_discovery_runs" USING btree ("workspace_id","icp_version_id");