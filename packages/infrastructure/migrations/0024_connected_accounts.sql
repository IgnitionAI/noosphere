CREATE TYPE "public"."connected_account_status" AS ENUM('pending', 'connected', 'degraded', 'disconnected', 'unknown');--> statement-breakpoint
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
  CONSTRAINT "connected_accounts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "connected_accounts_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "connected_accounts_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "connected_accounts_provider_account_uq" UNIQUE ("workspace_id", "provider", "provider_account_id")
);--> statement-breakpoint
CREATE INDEX "connected_accounts_workspace_status_idx" ON "connected_accounts" USING btree ("workspace_id", "status");--> statement-breakpoint
CREATE TABLE "connected_account_webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" varchar(80) NOT NULL,
  "event_id" varchar(300) NOT NULL,
  "workspace_id" uuid,
  "connected_account_id" uuid,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "connected_account_webhooks_provider_event_uq" UNIQUE ("provider", "event_id"),
  CONSTRAINT "connected_account_webhooks_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null,
  CONSTRAINT "connected_account_webhooks_account_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null
);--> statement-breakpoint
CREATE INDEX "connected_account_webhooks_account_idx" ON "connected_account_webhooks" USING btree ("connected_account_id", "created_at");
