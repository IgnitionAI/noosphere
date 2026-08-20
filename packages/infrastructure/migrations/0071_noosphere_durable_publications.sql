CREATE TABLE "content_publications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "asset_id" uuid NOT NULL,
  "asset_version_id" uuid NOT NULL,
  "network" varchar(40) DEFAULT 'linkedin' NOT NULL,
  "provider" varchar(80) DEFAULT 'unipile' NOT NULL,
  "status" varchar(40) DEFAULT 'scheduled' NOT NULL,
  "request_key" varchar(300) NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "content_snapshot" jsonb NOT NULL,
  "policy_snapshot" jsonb NOT NULL,
  "account_snapshot" jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 4 NOT NULL,
  "provider_post_id" text,
  "provider_social_id" text,
  "provider_url" text,
  "last_error_code" varchar(160),
  "last_error_message" text,
  "execution_token" uuid,
  "publish_started_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "unknown_at" timestamp with time zone,
  "created_by" uuid REFERENCES "auth_users" ("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_publications_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "content_publications_workspace_request_uq" UNIQUE ("workspace_id", "request_key"),
  CONSTRAINT "content_publications_workspace_asset_fk" FOREIGN KEY ("workspace_id", "asset_id") REFERENCES "content_assets" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_publications_workspace_asset_version_fk" FOREIGN KEY ("workspace_id", "asset_version_id") REFERENCES "content_asset_versions" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_publications_network_ck" CHECK ("network" in ('linkedin')),
  CONSTRAINT "content_publications_status_ck" CHECK ("status" in ('scheduled', 'retry', 'publishing', 'published', 'unknown', 'failed', 'cancelled')),
  CONSTRAINT "content_publications_attempts_ck" CHECK ("attempts" >= 0 and "max_attempts" > 0 and "attempts" <= "max_attempts")
);

CREATE TABLE "content_publication_attempts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "publication_id" uuid NOT NULL,
  "attempt" integer NOT NULL,
  "execution_token" uuid NOT NULL,
  "status" varchar(40) DEFAULT 'started' NOT NULL,
  "request_snapshot" jsonb NOT NULL,
  "provider_post_id" text,
  "provider_social_id" text,
  "provider_url" text,
  "error_code" varchar(160),
  "error_message" text,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_publication_attempts_workspace_publication_fk" FOREIGN KEY ("workspace_id", "publication_id") REFERENCES "content_publications" ("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "content_publication_attempts_workspace_token_uq" UNIQUE ("workspace_id", "execution_token"),
  CONSTRAINT "content_publication_attempts_workspace_number_uq" UNIQUE ("workspace_id", "publication_id", "attempt"),
  CONSTRAINT "content_publication_attempts_status_ck" CHECK ("status" in ('started', 'published', 'not_sent', 'unknown', 'failed')),
  CONSTRAINT "content_publication_attempts_attempt_ck" CHECK ("attempt" > 0)
);

CREATE OR REPLACE FUNCTION "public"."protect_content_publication_snapshots"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."asset_id" IS DISTINCT FROM OLD."asset_id"
    OR NEW."asset_version_id" IS DISTINCT FROM OLD."asset_version_id"
    OR NEW."network" IS DISTINCT FROM OLD."network"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."request_key" IS DISTINCT FROM OLD."request_key"
    OR NEW."content_snapshot" IS DISTINCT FROM OLD."content_snapshot"
    OR NEW."policy_snapshot" IS DISTINCT FROM OLD."policy_snapshot"
    OR NEW."account_snapshot" IS DISTINCT FROM OLD."account_snapshot"
  THEN
    RAISE EXCEPTION 'CONTENT_PUBLICATION_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "content_publication_snapshots_immutable_trg"
BEFORE UPDATE ON "content_publications"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_content_publication_snapshots"();
