DO $$ BEGIN
  CREATE TYPE "public"."offer_status" AS ENUM('draft', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."offer_claim_validation_status" AS ENUM('hypothesis', 'sourced', 'validated', 'invalidated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offers" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" varchar(500) NOT NULL,
  "status" "offer_status" DEFAULT 'draft' NOT NULL,
  "current_version" integer DEFAULT 0 NOT NULL,
  "category" varchar(80) DEFAULT 'autre' NOT NULL,
  "value_proposition" text DEFAULT '' NOT NULL,
  "target_audience" text DEFAULT '' NOT NULL,
  "pricing" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "commercial_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "offers_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "offers_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action,
  CONSTRAINT "offers_workspace_id_uq" UNIQUE("workspace_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offers_workspace_name_uq" ON "offers" USING btree ("workspace_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "offer_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "name" varchar(500) NOT NULL,
  "category" varchar(80) NOT NULL,
  "value_proposition" text NOT NULL,
  "target_audience" text NOT NULL,
  "pricing" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "commercial_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "published_by" uuid,
  "published_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "offer_versions_workspace_offer_fk" FOREIGN KEY ("workspace_id", "offer_id") REFERENCES "public"."offers"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "offer_versions_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."auth_users"("id") ON DELETE no action,
  CONSTRAINT "offer_versions_workspace_id_uq" UNIQUE("workspace_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offer_versions_offer_version_uq" ON "offer_versions" USING btree ("workspace_id", "offer_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_versions_workspace_idx" ON "offer_versions" USING btree ("workspace_id", "published_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer_claims" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "offer_version_id" uuid NOT NULL,
  "claim" text NOT NULL,
  "validation_status" "offer_claim_validation_status" NOT NULL,
  "evidence_uri" text,
  CONSTRAINT "offer_claims_workspace_version_fk" FOREIGN KEY ("workspace_id", "offer_version_id") REFERENCES "public"."offer_versions"("workspace_id", "id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_claims_workspace_version_idx" ON "offer_claims" USING btree ("workspace_id", "offer_version_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_offer_version_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OFFER_VERSION_IMMUTABLE';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "offer_versions_immutable_trg" ON "offer_versions";
--> statement-breakpoint
CREATE TRIGGER "offer_versions_immutable_trg"
BEFORE UPDATE OR DELETE ON "offer_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_offer_version_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_offer_claim_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OFFER_CLAIM_IMMUTABLE';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "offer_claims_immutable_trg" ON "offer_claims";
--> statement-breakpoint
CREATE TRIGGER "offer_claims_immutable_trg"
BEFORE UPDATE OR DELETE ON "offer_claims"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_offer_claim_mutation"();
