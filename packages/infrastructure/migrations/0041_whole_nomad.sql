CREATE TYPE "public"."approval_item_status" AS ENUM('pending', 'approved', 'rejected', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."campaign_enrollment_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."campaign_prospect_status" AS ENUM('candidate', 'selected', 'excluded', 'enrolled');--> statement-breakpoint
CREATE TYPE "public"."connected_account_status" AS ENUM('pending', 'connected', 'degraded', 'disconnected', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."offer_claim_validation_status" AS ENUM('hypothesis', 'sourced', 'validated', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'archived');--> statement-breakpoint
CREATE TYPE "public"."outreach_attempt_status" AS ENUM('sending', 'executing', 'sent', 'failed', 'rate_limited', 'retry', 'unknown');--> statement-breakpoint
CREATE TABLE "ai_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"draft_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_policies_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_policy_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_policy_versions_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "approval_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"contact_id" uuid,
	"enrollment_id" uuid,
	"item_type" varchar(100) NOT NULL,
	"channel" varchar(40) NOT NULL,
	"step_position" integer,
	"content_original" jsonb NOT NULL,
	"content_edited" jsonb,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"status" "approval_item_status" DEFAULT 'pending' NOT NULL,
	"decision_by" uuid,
	"decided_at" timestamp with time zone,
	"rejection_justification" text,
	"invalidation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_items_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(160) NOT NULL,
	"subject_type" varchar(120) NOT NULL,
	"subject_id" uuid NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" varchar(200),
	"source_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"sequence_version_id" uuid NOT NULL,
	"status" "campaign_enrollment_status" DEFAULT 'active' NOT NULL,
	"enrolled_by" uuid,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_enrollments_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "connected_account_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(80) NOT NULL,
	"event_id" varchar(300) NOT NULL,
	"workspace_id" uuid,
	"connected_account_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connected_account_webhooks_provider_event_uq" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" varchar(80) NOT NULL,
	"provider_account_id" varchar(300) NOT NULL,
	"display_name" varchar(300),
	"status" "connected_account_status" DEFAULT 'pending' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quotas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_secret" text NOT NULL,
	"last_error_code" varchar(120),
	"last_error_message" varchar(500),
	"last_checked_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connected_accounts_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "contact_merges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"survivor_contact_id" uuid NOT NULL,
	"merged_contact_id" uuid NOT NULL,
	"candidate_id" uuid,
	"snapshot" jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"merged_by" uuid,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_by" uuid,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "icp_criterion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"icp_version_id" uuid NOT NULL,
	"dimension" varchar(200) NOT NULL,
	"operator" varchar(60) NOT NULL,
	"expected_value" jsonb NOT NULL,
	"weight" numeric(5, 4),
	"required" boolean DEFAULT false NOT NULL,
	"exclusion" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "icps_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"filename" varchar(500) NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_content" text NOT NULL,
	"raw_expires_at" timestamp with time zone NOT NULL,
	"status" varchar(40) DEFAULT 'uploaded' NOT NULL,
	"previewed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_fingerprint" varchar(64) NOT NULL,
	"status" varchar(40) DEFAULT 'pending' NOT NULL,
	"reason" varchar(500),
	"company_id" uuid,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_rows_workspace_line_uq" UNIQUE("workspace_id","batch_id","line_number")
);
--> statement-breakpoint
CREATE TABLE "merge_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"primary_contact_id" uuid NOT NULL,
	"secondary_contact_id" uuid NOT NULL,
	"pair_key" varchar(80) NOT NULL,
	"match_type" varchar(30) NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"decision_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merge_candidates_workspace_pair_uq" UNIQUE("workspace_id","pair_key")
);
--> statement-breakpoint
CREATE TABLE "messaging_strategies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"draft_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_strategies_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "messaging_strategy_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_strategy_versions_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "offer_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"offer_version_id" uuid NOT NULL,
	"claim" text NOT NULL,
	"validation_status" "offer_claim_validation_status" NOT NULL,
	"evidence_uri" text
);
--> statement-breakpoint
CREATE TABLE "offer_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(500) NOT NULL,
	"category" varchar(80) NOT NULL,
	"value_proposition" text NOT NULL,
	"target_audience" text NOT NULL,
	"pricing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"commercial_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_versions_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"category" varchar(80) DEFAULT 'autre' NOT NULL,
	"value_proposition" text DEFAULT '' NOT NULL,
	"target_audience" text DEFAULT '' NOT NULL,
	"pricing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"commercial_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "campaign_prospects" DROP CONSTRAINT "campaign_prospects_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "campaign_prospects" DROP CONSTRAINT "campaign_prospects_candidate_id_prospect_discovery_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "campaign_prospects" DROP CONSTRAINT "campaign_prospects_contact_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_icp_version_id_icp_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_plan_id_prospecting_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_assessment_id_channel_assessments_id_fk";
--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_sequence_id_sequences_id_fk";
--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_sequence_version_id_sequence_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_discovery_run_id_prospect_discovery_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "icp_versions" DROP CONSTRAINT "icp_versions_workspace_run_fk";
--> statement-breakpoint
ALTER TABLE "outreach_actions" DROP CONSTRAINT "outreach_actions_enrollment_id_sequence_enrollments_id_fk";
--> statement-breakpoint
ALTER TABLE "outreach_actions" DROP CONSTRAINT "outreach_actions_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "outreach_actions" DROP CONSTRAINT "outreach_actions_candidate_id_prospect_discovery_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "outreach_actions" DROP CONSTRAINT "outreach_actions_contact_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "outreach_attempts" DROP CONSTRAINT "outreach_attempts_outreach_action_id_outreach_actions_id_fk";
--> statement-breakpoint
ALTER TABLE "sequence_versions" DROP CONSTRAINT "sequence_versions_sequence_id_sequences_id_fk";
--> statement-breakpoint
DROP INDEX "campaign_prospects_campaign_state_idx";--> statement-breakpoint
DROP INDEX "campaigns_plan_channel_uq";--> statement-breakpoint
DROP INDEX "campaigns_sequence_uq";--> statement-breakpoint
DROP INDEX "campaigns_discovery_run_uq";--> statement-breakpoint
DROP INDEX "icp_versions_workspace_version_uq";--> statement-breakpoint
DROP INDEX "outreach_attempts_number_uq";--> statement-breakpoint
DROP INDEX "contact_suppressions_fingerprint_uq";--> statement-breakpoint
DROP INDEX "outreach_actions_due_idx";--> statement-breakpoint
ALTER TABLE "campaign_prospects" DROP CONSTRAINT "campaign_prospects_workspace_id_campaign_id_candidate_id_pk";--> statement-breakpoint
ALTER TABLE "campaign_prospects" ALTER COLUMN "candidate_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "campaign_prospects" ALTER COLUMN "score" SET DATA TYPE numeric(7, 4);--> statement-breakpoint
ALTER TABLE "campaign_prospects" ALTER COLUMN "exclusion_reason" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "autopilot_policy" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "icp_versions" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "icp_versions" ALTER COLUMN "proposal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "candidate_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "provider" SET DEFAULT 'unipile';--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "provider_account_id" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "step_kind" SET DEFAULT 'email';--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "status" SET DEFAULT 'planned';--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "due_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "content_snapshot" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "last_error_code" SET DATA TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "outreach_attempts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "outreach_attempts" ALTER COLUMN "outreach_action_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ALTER COLUMN "attempt_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ALTER COLUMN "status" SET DATA TYPE "public"."outreach_attempt_status" USING "status"::"public"."outreach_attempt_status";--> statement-breakpoint
ALTER TABLE "outreach_attempts" ALTER COLUMN "error_code" SET DATA TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "status" "campaign_prospect_status" DEFAULT 'candidate' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "explanation" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "selected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "enrolled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "objective" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "offer_version_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "messaging_strategy_version_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "ai_policy_version_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "activated_by" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD COLUMN "lifted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD COLUMN "lifted_by" uuid;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD COLUMN "lift_justification" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "icp_versions" ADD COLUMN "icp_id" uuid;--> statement-breakpoint
INSERT INTO "icps" ("id", "workspace_id", "name", "current_version", "created_at", "updated_at")
SELECT "id", "workspace_id", "name", "version", "created_at", "created_at"
FROM "icp_versions"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "icp_versions" SET "icp_id" = "id" WHERE "icp_id" IS NULL;--> statement-breakpoint
ALTER TABLE "icp_versions" ALTER COLUMN "icp_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "sequence_version_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "approval_item_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "connected_account_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "recipient" varchar(600) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "subject" varchar(300);--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "body" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "provider_message_id" varchar(300);--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "response_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD COLUMN "action_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD COLUMN "attempt" integer;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD COLUMN "provider_message_id" varchar(300);--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_policy_versions" ADD CONSTRAINT "ai_policy_versions_published_by_auth_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_policy_versions" ADD CONSTRAINT "ai_policy_versions_workspace_policy_fk" FOREIGN KEY ("workspace_id","policy_id") REFERENCES "public"."ai_policies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_decision_by_auth_users_id_fk" FOREIGN KEY ("decision_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_enrollment_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."campaign_enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_auth_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_enrolled_by_auth_users_id_fk" FOREIGN KEY ("enrolled_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_versions" ADD CONSTRAINT "sequence_versions_workspace_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_sequence_version_fk" FOREIGN KEY ("workspace_id","sequence_version_id") REFERENCES "public"."sequence_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_account_webhooks" ADD CONSTRAINT "connected_account_webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_account_webhooks" ADD CONSTRAINT "connected_account_webhooks_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_candidate_id_merge_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."merge_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_merged_by_auth_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_undone_by_auth_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_survivor_fk" FOREIGN KEY ("workspace_id","survivor_contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_merged_fk" FOREIGN KEY ("workspace_id","merged_contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_workspace_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "icp_criterion" ADD CONSTRAINT "icp_criterion_workspace_version_fk" FOREIGN KEY ("workspace_id","icp_version_id") REFERENCES "public"."icp_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icps" ADD CONSTRAINT "icps_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_fk" FOREIGN KEY ("workspace_id","batch_id") REFERENCES "public"."import_batches"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_decided_by_auth_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_primary_fk" FOREIGN KEY ("workspace_id","primary_contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_secondary_fk" FOREIGN KEY ("workspace_id","secondary_contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_strategies" ADD CONSTRAINT "messaging_strategies_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_strategies" ADD CONSTRAINT "messaging_strategies_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_strategy_versions" ADD CONSTRAINT "messaging_strategy_versions_published_by_auth_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_strategy_versions" ADD CONSTRAINT "messaging_strategy_versions_workspace_strategy_fk" FOREIGN KEY ("workspace_id","strategy_id") REFERENCES "public"."messaging_strategies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_claims" ADD CONSTRAINT "offer_claims_workspace_version_fk" FOREIGN KEY ("workspace_id","offer_version_id") REFERENCES "public"."offer_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_published_by_auth_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_workspace_offer_fk" FOREIGN KEY ("workspace_id","offer_id") REFERENCES "public"."offers"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_policies_workspace_name_uq" ON "ai_policies" USING btree ("workspace_id",lower("name")) WHERE "ai_policies"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_policy_versions_policy_version_uq" ON "ai_policy_versions" USING btree ("workspace_id","policy_id","version");--> statement-breakpoint
CREATE INDEX "ai_policy_versions_workspace_idx" ON "ai_policy_versions" USING btree ("workspace_id","published_at");--> statement-breakpoint
CREATE INDEX "approval_items_workspace_status_idx" ON "approval_items" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "approval_items_campaign_status_idx" ON "approval_items" USING btree ("workspace_id","campaign_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_logs_source_event_uq" ON "audit_logs" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_created_idx" ON "audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_subject_idx" ON "audit_logs" USING btree ("workspace_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_enrollments_campaign_contact_uq" ON "campaign_enrollments" USING btree ("workspace_id","campaign_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_enrollments_active_contact_uq" ON "campaign_enrollments" USING btree ("workspace_id","contact_id") WHERE "campaign_enrollments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "campaign_enrollments_campaign_idx" ON "campaign_enrollments" USING btree ("workspace_id","campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "connected_account_webhooks_account_idx" ON "connected_account_webhooks" USING btree ("connected_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_provider_account_uq" ON "connected_accounts" USING btree ("workspace_id","provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "connected_accounts_workspace_status_idx" ON "connected_accounts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "contact_merges_workspace_history_idx" ON "contact_merges" USING btree ("workspace_id","merged_at");--> statement-breakpoint
CREATE INDEX "icp_criterion_workspace_version_idx" ON "icp_criterion" USING btree ("workspace_id","icp_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_workspace_key_uq" ON "import_batches" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "import_batches_workspace_created_idx" ON "import_batches" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "import_rows_batch_status_idx" ON "import_rows" USING btree ("workspace_id","batch_id","status");--> statement-breakpoint
CREATE INDEX "merge_candidates_workspace_status_idx" ON "merge_candidates" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_strategies_workspace_name_uq" ON "messaging_strategies" USING btree ("workspace_id",lower("name")) WHERE "messaging_strategies"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_strategy_versions_strategy_version_uq" ON "messaging_strategy_versions" USING btree ("workspace_id","strategy_id","version");--> statement-breakpoint
CREATE INDEX "messaging_strategy_versions_workspace_idx" ON "messaging_strategy_versions" USING btree ("workspace_id","published_at");--> statement-breakpoint
CREATE INDEX "offer_claims_workspace_version_idx" ON "offer_claims" USING btree ("workspace_id","offer_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_versions_offer_version_uq" ON "offer_versions" USING btree ("workspace_id","offer_id","version");--> statement-breakpoint
CREATE INDEX "offer_versions_workspace_idx" ON "offer_versions" USING btree ("workspace_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_workspace_name_uq" ON "offers" USING btree ("workspace_id","name");--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_activated_by_auth_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_offer_version_fk" FOREIGN KEY ("workspace_id","offer_version_id") REFERENCES "public"."offer_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_icp_version_fk" FOREIGN KEY ("workspace_id","icp_version_id") REFERENCES "public"."icp_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_messaging_version_fk" FOREIGN KEY ("workspace_id","messaging_strategy_version_id") REFERENCES "public"."messaging_strategy_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ai_policy_version_fk" FOREIGN KEY ("workspace_id","ai_policy_version_id") REFERENCES "public"."ai_policy_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sequence_version_fk" FOREIGN KEY ("workspace_id","sequence_version_id") REFERENCES "public"."sequence_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_lifted_by_auth_users_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_merged_into_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_workspace_icp_fk" FOREIGN KEY ("workspace_id","icp_id") REFERENCES "public"."icps"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_enrollment_fk" FOREIGN KEY ("workspace_id","enrollment_id") REFERENCES "public"."campaign_enrollments"("workspace_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_sequence_version_fk" FOREIGN KEY ("workspace_id","sequence_version_id") REFERENCES "public"."sequence_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_approval_item_fk" FOREIGN KEY ("approval_item_id") REFERENCES "public"."approval_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_account_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_workspace_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_action_fk" FOREIGN KEY ("workspace_id","action_id") REFERENCES "public"."outreach_actions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_versions" ADD CONSTRAINT "sequence_versions_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_prospects_campaign_contact_uq" ON "campaign_prospects" USING btree ("workspace_id","campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_prospects_campaign_status_idx" ON "campaign_prospects" USING btree ("workspace_id","campaign_id","status","score");--> statement-breakpoint
CREATE UNIQUE INDEX "icp_versions_icp_version_uq" ON "icp_versions" USING btree ("workspace_id","icp_id","version");--> statement-breakpoint
CREATE INDEX "outreach_actions_campaign_idx" ON "outreach_actions" USING btree ("workspace_id","campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_suppressions_fingerprint_uq" ON "contact_suppressions" USING btree ("workspace_id","identity_type","normalized_value","channel") WHERE "contact_suppressions"."normalized_value" is not null;--> statement-breakpoint
CREATE INDEX "outreach_actions_due_idx" ON "outreach_actions" USING btree ("workspace_id","status","scheduled_at");--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_workspace_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_action_attempt_uq" UNIQUE("workspace_id","action_id","attempt");
