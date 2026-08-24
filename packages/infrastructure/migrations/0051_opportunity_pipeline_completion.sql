ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "probability" integer NOT NULL DEFAULT 0;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "owner_user_id" uuid;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "expected_close_date" timestamp with time zone;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "lost_reason" varchar(120);
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "lost_comment" text;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "offer_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_probability_check" CHECK ("probability" >= 0 AND "probability" <= 100);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_owner_fk" FOREIGN KEY ("workspace_id", "owner_user_id") REFERENCES "public"."workspace_members"("workspace_id", "user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_offer_version_fk" FOREIGN KEY ("workspace_id", "offer_version_id") REFERENCES "public"."offer_versions"("workspace_id", "id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_workspace_owner_idx" ON "opportunities" USING btree ("workspace_id", "owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_workspace_close_date_idx" ON "opportunities" USING btree ("workspace_id", "expected_close_date");
--> statement-breakpoint
CREATE TABLE "workspace_lost_reasons" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "key" varchar(120) NOT NULL,
  "label" varchar(300) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_lost_reasons_workspace_id_uq" UNIQUE("workspace_id", "id"),
  CONSTRAINT "workspace_lost_reasons_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "workspace_lost_reasons_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_lost_reasons_key_uq" ON "workspace_lost_reasons" USING btree ("workspace_id", "key");
--> statement-breakpoint
CREATE INDEX "workspace_lost_reasons_workspace_active_idx" ON "workspace_lost_reasons" USING btree ("workspace_id", "active");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_opportunity_stage_history_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OPPORTUNITY_STAGE_HISTORY_IMMUTABLE';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "opportunity_stage_history_immutable_trg" ON "opportunity_stage_history";
--> statement-breakpoint
CREATE TRIGGER "opportunity_stage_history_immutable_trg"
BEFORE UPDATE OR DELETE ON "opportunity_stage_history"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_opportunity_stage_history_mutation"();
