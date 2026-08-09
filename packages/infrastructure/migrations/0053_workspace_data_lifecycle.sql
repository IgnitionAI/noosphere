CREATE TYPE "public"."workspace_export_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "workspace_data_settings" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "timezone" varchar(120) DEFAULT 'Europe/Paris' NOT NULL,
  "active_days" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
  "window_start" varchar(5) DEFAULT '09:00' NOT NULL,
  "window_end" varchar(5) DEFAULT '17:00' NOT NULL,
  "linkedin_daily_limit" integer DEFAULT 20 NOT NULL,
  "email_daily_limit" integer DEFAULT 50 NOT NULL,
  "whatsapp_daily_limit" integer DEFAULT 30 NOT NULL,
  "invitations_retention_days" integer DEFAULT 90 NOT NULL,
  "jobs_retention_days" integer DEFAULT 90 NOT NULL,
  "audit_retention_days" integer DEFAULT 365 NOT NULL,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_data_settings_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "workspace_data_settings_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "workspace_data_settings_linkedin_limit_ck" CHECK ("linkedin_daily_limit" between 1 and 100),
  CONSTRAINT "workspace_data_settings_email_limit_ck" CHECK ("email_daily_limit" between 1 and 500),
  CONSTRAINT "workspace_data_settings_whatsapp_limit_ck" CHECK ("whatsapp_daily_limit" between 1 and 200),
  CONSTRAINT "workspace_data_settings_invitations_retention_ck" CHECK ("invitations_retention_days" between 30 and 3650),
  CONSTRAINT "workspace_data_settings_jobs_retention_ck" CHECK ("jobs_retention_days" between 30 and 365),
  CONSTRAINT "workspace_data_settings_audit_retention_ck" CHECK ("audit_retention_days" between 365 and 3650)
);--> statement-breakpoint
CREATE TABLE "workspace_exports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "request_key" varchar(200) NOT NULL,
  "status" "workspace_export_status" DEFAULT 'pending' NOT NULL,
  "object_key" varchar(800),
  "size_bytes" integer,
  "checksum_sha256" varchar(64),
  "requested_by" uuid,
  "expires_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failure_code" varchar(120),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_exports_workspace_id_uq" UNIQUE("workspace_id", "id"),
  CONSTRAINT "workspace_exports_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "workspace_exports_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."auth_users"("id") ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_exports_request_key_uq" ON "workspace_exports" USING btree ("workspace_id", "request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_exports_active_uq" ON "workspace_exports" USING btree ("workspace_id") WHERE "status" in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "workspace_exports_workspace_created_idx" ON "workspace_exports" USING btree ("workspace_id", "created_at");--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "anonymized_at" timestamp with time zone;
