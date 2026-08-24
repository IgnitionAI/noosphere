CREATE TYPE "public"."approval_item_status" AS ENUM('pending', 'approved', 'rejected', 'invalidated');--> statement-breakpoint
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
  CONSTRAINT "approval_items_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "approval_items_campaign_fk" FOREIGN KEY ("workspace_id", "campaign_id") REFERENCES "public"."campaigns"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "approval_items_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null,
  CONSTRAINT "approval_items_enrollment_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."campaign_enrollments"("id") ON DELETE set null,
  CONSTRAINT "approval_items_decision_by_fk" FOREIGN KEY ("decision_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "approval_items_workspace_id_uq" UNIQUE ("workspace_id", "id")
);--> statement-breakpoint
CREATE INDEX "approval_items_workspace_status_idx" ON "approval_items" USING btree ("workspace_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX "approval_items_campaign_status_idx" ON "approval_items" USING btree ("workspace_id", "campaign_id", "status", "created_at");
