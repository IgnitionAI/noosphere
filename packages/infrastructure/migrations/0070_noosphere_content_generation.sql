ALTER TABLE "ai_runs" ADD COLUMN "content_generation_run_id" uuid;

CREATE TABLE "content_assets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "idea_id" uuid NOT NULL,
  "type" varchar(40) DEFAULT 'linkedin_text' NOT NULL,
  "status" varchar(40) DEFAULT 'draft' NOT NULL,
  "latest_version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_assets_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "content_assets_workspace_idea_fk" FOREIGN KEY ("workspace_id", "idea_id") REFERENCES "content_ideas" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_assets_type_ck" CHECK ("type" in ('linkedin_text')),
  CONSTRAINT "content_assets_status_ck" CHECK ("status" in ('draft', 'ready', 'blocked'))
);

CREATE UNIQUE INDEX "content_assets_workspace_idea_type_uq" ON "content_assets" ("workspace_id", "idea_id", "type");

CREATE TABLE "content_generation_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "idea_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "strategy_version_id" uuid NOT NULL,
  "asset_version_id" uuid,
  "status" varchar(40) DEFAULT 'queued' NOT NULL,
  "stage" varchar(40) DEFAULT 'brief' NOT NULL,
  "instruction" text,
  "brief_snapshot" jsonb,
  "draft_snapshot" jsonb,
  "audit_snapshot" jsonb,
  "critique_snapshot" jsonb,
  "last_error_code" varchar(160),
  "last_error_message" text,
  "created_by" uuid REFERENCES "auth_users" ("id") ON DELETE set null,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_generation_runs_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "content_generation_runs_workspace_idea_fk" FOREIGN KEY ("workspace_id", "idea_id") REFERENCES "content_ideas" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_generation_runs_workspace_asset_fk" FOREIGN KEY ("workspace_id", "asset_id") REFERENCES "content_assets" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_generation_runs_workspace_strategy_fk" FOREIGN KEY ("workspace_id", "strategy_version_id") REFERENCES "editorial_strategy_versions" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_generation_runs_status_ck" CHECK ("status" in ('queued', 'running', 'ready', 'blocked', 'failed')),
  CONSTRAINT "content_generation_runs_stage_ck" CHECK ("stage" in ('brief', 'writer', 'audit', 'critic', 'completed'))
);

CREATE TABLE "content_briefs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "run_id" uuid NOT NULL,
  "idea_id" uuid NOT NULL,
  "strategy_version_id" uuid NOT NULL,
  "snapshot" jsonb NOT NULL,
  "evidence_snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_briefs_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "content_briefs_workspace_run_fk" FOREIGN KEY ("workspace_id", "run_id") REFERENCES "content_generation_runs" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_briefs_workspace_idea_fk" FOREIGN KEY ("workspace_id", "idea_id") REFERENCES "content_ideas" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_briefs_workspace_strategy_fk" FOREIGN KEY ("workspace_id", "strategy_version_id") REFERENCES "editorial_strategy_versions" ("workspace_id", "id") ON DELETE restrict
);

CREATE UNIQUE INDEX "content_briefs_workspace_run_uq" ON "content_briefs" ("workspace_id", "run_id");

CREATE TABLE "content_asset_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "asset_id" uuid NOT NULL,
  "brief_id" uuid NOT NULL,
  "generation_run_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "body" text NOT NULL,
  "draft" jsonb NOT NULL,
  "audit" jsonb NOT NULL,
  "critique" jsonb NOT NULL,
  "readiness" jsonb NOT NULL,
  "ready" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_asset_versions_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "content_asset_versions_workspace_asset_fk" FOREIGN KEY ("workspace_id", "asset_id") REFERENCES "content_assets" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_asset_versions_workspace_brief_fk" FOREIGN KEY ("workspace_id", "brief_id") REFERENCES "content_briefs" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_asset_versions_workspace_run_fk" FOREIGN KEY ("workspace_id", "generation_run_id") REFERENCES "content_generation_runs" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_asset_versions_version_ck" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "content_asset_versions_workspace_asset_version_uq" ON "content_asset_versions" ("workspace_id", "asset_id", "version");
CREATE UNIQUE INDEX "content_asset_versions_workspace_run_uq" ON "content_asset_versions" ("workspace_id", "generation_run_id");

CREATE OR REPLACE FUNCTION "public"."reject_content_snapshot_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CONTENT_SNAPSHOT_IMMUTABLE';
END;
$$;

CREATE TRIGGER "content_briefs_immutable_trg"
BEFORE UPDATE OR DELETE ON "content_briefs"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_content_snapshot_mutation"();

CREATE TRIGGER "content_asset_versions_immutable_trg"
BEFORE UPDATE OR DELETE ON "content_asset_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_content_snapshot_mutation"();
