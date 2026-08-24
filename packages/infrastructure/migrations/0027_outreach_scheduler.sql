CREATE TYPE "public"."outreach_action_status" AS ENUM('planned', 'awaiting_approval', 'due', 'sending', 'sent', 'failed', 'cancelled', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."outreach_attempt_status" AS ENUM('sending', 'sent', 'failed', 'rate_limited');--> statement-breakpoint
CREATE TABLE "outreach_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "enrollment_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "sequence_version_id" uuid NOT NULL,
  "approval_item_id" uuid,
  "connected_account_id" uuid,
  "step_position" integer NOT NULL,
  "channel" varchar(40) NOT NULL,
  "recipient" varchar(600) NOT NULL,
  "subject" varchar(300),
  "body" text NOT NULL,
  "idempotency_key" varchar(500) NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "status" "outreach_action_status" DEFAULT 'planned' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "next_attempt_at" timestamp with time zone,
  "last_error_code" varchar(120),
  "last_error_message" text,
  "provider_message_id" varchar(300),
  "sent_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_actions_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "outreach_actions_campaign_fk" FOREIGN KEY ("workspace_id", "campaign_id") REFERENCES "public"."campaigns"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "outreach_actions_enrollment_fk" FOREIGN KEY ("workspace_id", "enrollment_id") REFERENCES "public"."campaign_enrollments"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "outreach_actions_contact_fk" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "outreach_actions_sequence_version_fk" FOREIGN KEY ("workspace_id", "sequence_version_id") REFERENCES "public"."sequence_versions"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "outreach_actions_approval_item_fk" FOREIGN KEY ("approval_item_id") REFERENCES "public"."approval_items"("id") ON DELETE set null,
  CONSTRAINT "outreach_actions_account_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null,
  CONSTRAINT "outreach_actions_workspace_id_uq" UNIQUE ("workspace_id", "id")
);--> statement-breakpoint
CREATE TABLE "outreach_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "attempt" integer NOT NULL,
  "status" "outreach_attempt_status" NOT NULL,
  "provider_message_id" varchar(300),
  "error_code" varchar(120),
  "error_message" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "outreach_attempts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "outreach_attempts_action_fk" FOREIGN KEY ("workspace_id", "action_id") REFERENCES "public"."outreach_actions"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "outreach_attempts_action_attempt_uq" UNIQUE ("workspace_id", "action_id", "attempt")
);--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_actions_idempotency_uq" ON "outreach_actions" USING btree ("workspace_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX "outreach_actions_due_idx" ON "outreach_actions" USING btree ("workspace_id", "status", "scheduled_at");--> statement-breakpoint
CREATE INDEX "outreach_actions_campaign_idx" ON "outreach_actions" USING btree ("workspace_id", "campaign_id", "created_at");
