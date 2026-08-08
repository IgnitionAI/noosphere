CREATE TYPE "public"."campaign_prospect_status" AS ENUM('candidate', 'selected', 'excluded', 'enrolled');--> statement-breakpoint
CREATE TYPE "public"."campaign_enrollment_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "campaign_prospects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "status" "campaign_prospect_status" DEFAULT 'candidate' NOT NULL,
  "score" numeric(7, 4) DEFAULT '0' NOT NULL,
  "explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "exclusion_reason" text,
  "selected_at" timestamp with time zone,
  "excluded_at" timestamp with time zone,
  "enrolled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_prospects_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "campaign_prospects_campaign_fk" FOREIGN KEY ("workspace_id", "campaign_id") REFERENCES "public"."campaigns"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "campaign_prospects_contact_fk" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "campaign_prospects_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "campaign_prospects_campaign_contact_uq" UNIQUE ("workspace_id", "campaign_id", "contact_id")
);--> statement-breakpoint
CREATE INDEX "campaign_prospects_campaign_status_idx" ON "campaign_prospects" USING btree ("workspace_id", "campaign_id", "status", "score");--> statement-breakpoint
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
  CONSTRAINT "campaign_enrollments_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "campaign_enrollments_campaign_fk" FOREIGN KEY ("workspace_id", "campaign_id") REFERENCES "public"."campaigns"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "campaign_enrollments_contact_fk" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "campaign_enrollments_sequence_version_fk" FOREIGN KEY ("workspace_id", "sequence_version_id") REFERENCES "public"."sequence_versions"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "campaign_enrollments_enrolled_by_fk" FOREIGN KEY ("enrolled_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "campaign_enrollments_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "campaign_enrollments_campaign_contact_uq" UNIQUE ("workspace_id", "campaign_id", "contact_id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_enrollments_active_contact_uq" ON "campaign_enrollments" USING btree ("workspace_id", "contact_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "campaign_enrollments_campaign_idx" ON "campaign_enrollments" USING btree ("workspace_id", "campaign_id", "created_at");
