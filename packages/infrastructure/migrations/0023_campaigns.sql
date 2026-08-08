CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_versions_workspace_id_uq" ON "sequence_versions" USING btree ("workspace_id", "id");--> statement-breakpoint
CREATE TABLE "campaigns" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" varchar(300) NOT NULL,
  "objective" text NOT NULL DEFAULT '',
  "status" "campaign_status" NOT NULL DEFAULT 'draft',
  "offer_version_id" uuid NOT NULL,
  "icp_version_id" uuid NOT NULL,
  "messaging_strategy_version_id" uuid NOT NULL,
  "ai_policy_version_id" uuid NOT NULL,
  "sequence_version_id" uuid NOT NULL,
  "created_by" uuid,
  "activated_by" uuid,
  "activated_at" timestamp with time zone,
  "paused_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaigns_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "campaigns_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "campaigns_activated_by_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "campaigns_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "campaigns_offer_version_fk" FOREIGN KEY ("workspace_id", "offer_version_id") REFERENCES "public"."offer_versions"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "campaigns_icp_version_fk" FOREIGN KEY ("workspace_id", "icp_version_id") REFERENCES "public"."icp_versions"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "campaigns_messaging_version_fk" FOREIGN KEY ("workspace_id", "messaging_strategy_version_id") REFERENCES "public"."messaging_strategy_versions"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "campaigns_ai_policy_version_fk" FOREIGN KEY ("workspace_id", "ai_policy_version_id") REFERENCES "public"."ai_policy_versions"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "campaigns_sequence_version_fk" FOREIGN KEY ("workspace_id", "sequence_version_id") REFERENCES "public"."sequence_versions"("workspace_id", "id") ON DELETE restrict
);--> statement-breakpoint
CREATE INDEX "campaigns_workspace_status_idx" ON "campaigns" USING btree ("workspace_id", "status", "updated_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_campaign_snapshot_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.offer_version_id IS DISTINCT FROM OLD.offer_version_id OR
    NEW.icp_version_id IS DISTINCT FROM OLD.icp_version_id OR
    NEW.messaging_strategy_version_id IS DISTINCT FROM OLD.messaging_strategy_version_id OR
    NEW.ai_policy_version_id IS DISTINCT FROM OLD.ai_policy_version_id OR
    NEW.sequence_version_id IS DISTINCT FROM OLD.sequence_version_id
  ) THEN
    RAISE EXCEPTION 'CAMPAIGN_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "campaign_snapshot_immutable_trg" ON "campaigns";--> statement-breakpoint
CREATE TRIGGER "campaign_snapshot_immutable_trg"
BEFORE UPDATE ON "campaigns"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_campaign_snapshot_mutation"();
