CREATE TYPE "public"."connection_onboarding_status" AS ENUM('initiated', 'awaiting_callback', 'verifying', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."connection_onboarding_step" AS ENUM('initiation', 'callback', 'verification');--> statement-breakpoint
CREATE TYPE "public"."account_health_alert_status" AS ENUM('active', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TABLE "connection_onboardings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider" varchar(80) DEFAULT 'unipile' NOT NULL,
  "channel" varchar(40) NOT NULL,
  "step" "connection_onboarding_step" DEFAULT 'initiation' NOT NULL,
  "status" "connection_onboarding_status" DEFAULT 'initiated' NOT NULL,
  "hosted_url" text,
  "provider_account_id" varchar(300),
  "result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_code" varchar(120),
  "error_message" varchar(500),
  "expires_at" timestamp with time zone NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "connection_onboardings_workspace_id_uq" UNIQUE("workspace_id", "id"),
  CONSTRAINT "connection_onboardings_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "connection_onboardings_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX "connection_onboardings_active_channel_uq" ON "connection_onboardings" USING btree ("workspace_id", "channel") WHERE "status" in ('initiated', 'awaiting_callback', 'verifying');--> statement-breakpoint
CREATE INDEX "connection_onboardings_workspace_status_idx" ON "connection_onboardings" USING btree ("workspace_id", "status", "updated_at");--> statement-breakpoint
CREATE TABLE "account_health_alerts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "connected_account_id" uuid NOT NULL,
  "episode_key" varchar(200) NOT NULL,
  "status" "account_health_alert_status" DEFAULT 'active' NOT NULL,
  "reason_code" varchar(120),
  "reason_message" varchar(500),
  "acknowledged_by" uuid,
  "acknowledged_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "account_health_alerts_workspace_id_uq" UNIQUE("workspace_id", "id"),
  CONSTRAINT "account_health_alerts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "account_health_alerts_account_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade,
  CONSTRAINT "account_health_alerts_acknowledged_by_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."auth_users"("id") ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX "account_health_alerts_account_episode_uq" ON "account_health_alerts" USING btree ("connected_account_id", "episode_key");--> statement-breakpoint
CREATE INDEX "account_health_alerts_workspace_status_idx" ON "account_health_alerts" USING btree ("workspace_id", "status", "created_at");
