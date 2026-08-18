ALTER TABLE "conversations" ADD COLUMN "connected_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "origin" varchar(40) DEFAULT 'outside_campaign' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "automation_mode" varchar(40) DEFAULT 'human' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "subject" varchar(500);
--> statement-breakpoint
UPDATE "conversations"
SET "origin" = CASE WHEN "campaign_id" IS NULL THEN 'outside_campaign' ELSE 'campaign' END,
    "automation_mode" = CASE WHEN "campaign_id" IS NULL THEN 'human' ELSE 'setter' END;
--> statement-breakpoint
UPDATE "conversations" c
SET "connected_account_id" = ca."id"
FROM "connected_accounts" ca
WHERE ca."workspace_id" = c."workspace_id"
  AND ca."provider" = c."provider"
  AND ca."provider_account_id" = c."provider_account_id";
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connected_account_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_origin_check" CHECK ("origin" IN ('campaign', 'outside_campaign'));
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_automation_mode_check" CHECK ("automation_mode" IN ('setter', 'human', 'disabled'));
--> statement-breakpoint
CREATE INDEX "conversations_account_activity_idx" ON "conversations" USING btree ("workspace_id", "connected_account_id", "last_message_at");
--> statement-breakpoint
CREATE TABLE "inbox_sync_states" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "connected_account_id" uuid NOT NULL,
  "provider_account_id" varchar(300) NOT NULL,
  "channel" "prospecting_channel" NOT NULL,
  "resource" varchar(40) NOT NULL,
  "cursor" text,
  "high_watermark" timestamp with time zone,
  "backfill_complete" boolean DEFAULT false NOT NULL,
  "status" varchar(40) DEFAULT 'idle' NOT NULL,
  "last_error_code" varchar(160),
  "last_error_message" text,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inbox_sync_states_resource_check" CHECK ("resource" IN ('messages', 'emails')),
  CONSTRAINT "inbox_sync_states_status_check" CHECK ("status" IN ('idle', 'syncing', 'error'))
);
--> statement-breakpoint
ALTER TABLE "inbox_sync_states" ADD CONSTRAINT "inbox_sync_states_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_sync_states" ADD CONSTRAINT "inbox_sync_states_connected_account_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_sync_states_account_resource_uq" ON "inbox_sync_states" USING btree ("workspace_id", "connected_account_id", "resource");
--> statement-breakpoint
CREATE INDEX "inbox_sync_states_due_idx" ON "inbox_sync_states" USING btree ("status", "updated_at");
