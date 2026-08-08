CREATE TABLE "daily_prospecting_schedules" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"local_time" varchar(5) DEFAULT '06:00' NOT NULL,
	"timezone" varchar(120) DEFAULT 'Europe/Paris' NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_scheduled_date" varchar(10),
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD COLUMN "campaign_id" uuid;
--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD COLUMN "trigger" varchar(40) DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "ai_assessment" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE "conversation_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"requested_by" uuid,
	"mode" varchar(20) NOT NULL,
	"requested_body" text,
	"generated_body" text,
	"status" varchar(40) DEFAULT 'scheduled' NOT NULL,
	"idempotency_key" varchar(500) NOT NULL,
	"provider_request_id" varchar(500),
	"error_code" varchar(160),
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_prospecting_schedules" ADD CONSTRAINT "daily_prospecting_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prospect_discovery_runs" ADD CONSTRAINT "prospect_discovery_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_commands" ADD CONSTRAINT "conversation_commands_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_commands" ADD CONSTRAINT "conversation_commands_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_commands" ADD CONSTRAINT "conversation_commands_requested_by_auth_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "daily_prospecting_schedules_due_idx" ON "daily_prospecting_schedules" USING btree ("enabled", "next_run_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_commands_idempotency_uq" ON "conversation_commands" USING btree ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "conversation_commands_conversation_idx" ON "conversation_commands" USING btree ("workspace_id", "conversation_id", "created_at");
