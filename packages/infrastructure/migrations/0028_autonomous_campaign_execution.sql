CREATE TYPE "public"."outreach_action_status" AS ENUM('scheduled', 'executing', 'sent', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sequence_enrollment_status" AS ENUM('active', 'suspended', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "outreach_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_account_id" varchar(300) NOT NULL,
	"channel" "prospecting_channel" NOT NULL,
	"step_position" integer NOT NULL,
	"step_kind" "sequence_step_kind" NOT NULL,
	"status" "outreach_action_status" DEFAULT 'scheduled' NOT NULL,
	"idempotency_key" varchar(500) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"content_snapshot" jsonb NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"locked_by" varchar(160),
	"provider_request_id" varchar(300),
	"sent_at" timestamp with time zone,
	"last_error_code" varchar(160),
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"outreach_action_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider_request_id" varchar(300),
	"status" varchar(40) NOT NULL,
	"error_code" varchar(160),
	"error_message" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"sequence_version_id" uuid NOT NULL,
	"status" "sequence_enrollment_status" DEFAULT 'active' NOT NULL,
	"current_position" integer DEFAULT 1 NOT NULL,
	"suspension_reason" varchar(160),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "personalized_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "sequence_version_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_enrollment_id_sequence_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."sequence_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_candidate_id_prospect_discovery_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."prospect_discovery_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_actions" ADD CONSTRAINT "outreach_actions_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_outreach_action_id_outreach_actions_id_fk" FOREIGN KEY ("outreach_action_id") REFERENCES "public"."outreach_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_candidate_id_prospect_discovery_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."prospect_discovery_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_version_id_sequence_versions_id_fk" FOREIGN KEY ("sequence_version_id") REFERENCES "public"."sequence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_actions_idempotency_uq" ON "outreach_actions" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outreach_actions_due_idx" ON "outreach_actions" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_attempts_number_uq" ON "outreach_attempts" USING btree ("workspace_id","outreach_action_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_enrollments_campaign_contact_uq" ON "sequence_enrollments" USING btree ("workspace_id","campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "sequence_enrollments_active_idx" ON "sequence_enrollments" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sequence_version_id_sequence_versions_id_fk" FOREIGN KEY ("sequence_version_id") REFERENCES "public"."sequence_versions"("id") ON DELETE no action ON UPDATE no action;