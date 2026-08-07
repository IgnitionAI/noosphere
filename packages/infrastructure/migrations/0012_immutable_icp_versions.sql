CREATE TABLE IF NOT EXISTS "icps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "icps_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
	CONSTRAINT "icps_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "icp_versions" ADD COLUMN IF NOT EXISTS "icp_id" uuid;
--> statement-breakpoint
INSERT INTO "icps" ("id", "workspace_id", "name", "current_version")
SELECT "id", "workspace_id", "name", "version" FROM "icp_versions"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "icp_versions" SET "icp_id" = "id" WHERE "icp_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "icp_versions" ALTER COLUMN "icp_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "icp_versions" ALTER COLUMN "run_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "icp_versions" ALTER COLUMN "proposal_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "icp_versions" DROP CONSTRAINT IF EXISTS "icp_versions_workspace_run_fk";
--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_workspace_icp_fk" FOREIGN KEY ("workspace_id","icp_id") REFERENCES "public"."icps"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
DROP INDEX IF EXISTS "icp_versions_workspace_version_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "icp_versions_icp_version_uq" ON "icp_versions" USING btree ("workspace_id","icp_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "icp_versions_workspace_id_uq" ON "icp_versions" USING btree ("workspace_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "icp_versions_proposal_uq" ON "icp_versions" USING btree ("workspace_id","proposal_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "icp_criterion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"icp_version_id" uuid NOT NULL,
	"dimension" varchar(200) NOT NULL,
	"operator" varchar(60) NOT NULL,
	"expected_value" jsonb NOT NULL,
	"weight" numeric(5, 4),
	"required" boolean DEFAULT false NOT NULL,
	"exclusion" boolean DEFAULT false NOT NULL,
	CONSTRAINT "icp_criterion_workspace_version_fk" FOREIGN KEY ("workspace_id","icp_version_id") REFERENCES "public"."icp_versions"("workspace_id","id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "icp_criterion_workspace_version_idx" ON "icp_criterion" USING btree ("workspace_id","icp_version_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_icp_version_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ICP_VERSION_IMMUTABLE';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "icp_versions_immutable_trg" ON "icp_versions";
--> statement-breakpoint
CREATE TRIGGER "icp_versions_immutable_trg"
BEFORE UPDATE OR DELETE ON "icp_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_icp_version_mutation"();
