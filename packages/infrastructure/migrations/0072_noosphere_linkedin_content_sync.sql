CREATE TABLE "social_content_sync_states" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "connected_account_id" uuid NOT NULL REFERENCES "connected_accounts" ("id") ON DELETE cascade,
  "provider_account_id" varchar(300) NOT NULL,
  "cursor" text,
  "high_watermark" timestamp with time zone,
  "backfill_complete" boolean DEFAULT false NOT NULL,
  "status" varchar(40) DEFAULT 'idle' NOT NULL,
  "lease_token" uuid,
  "locked_until" timestamp with time zone,
  "next_sync_at" timestamp with time zone NOT NULL,
  "last_error_code" varchar(160),
  "last_error_message" text,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_content_sync_states_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "social_content_sync_states_status_ck" CHECK ("status" in ('idle', 'syncing', 'error'))
);

CREATE UNIQUE INDEX "social_content_sync_states_account_uq" ON "social_content_sync_states" ("workspace_id", "connected_account_id");

CREATE TABLE "social_content_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "connected_account_id" uuid NOT NULL REFERENCES "connected_accounts" ("id") ON DELETE cascade,
  "provider_account_id" varchar(300) NOT NULL,
  "publication_id" uuid,
  "network" varchar(40) DEFAULT 'linkedin' NOT NULL,
  "provider" varchar(80) DEFAULT 'unipile' NOT NULL,
  "origin" varchar(40) NOT NULL,
  "provider_post_id" text NOT NULL,
  "social_id" text,
  "author_provider_id" text,
  "text" text NOT NULL,
  "url" text,
  "status" varchar(40) DEFAULT 'observed' NOT NULL,
  "published_at" timestamp with time zone,
  "impressions" integer,
  "reactions" integer,
  "comments" integer,
  "reposts" integer,
  "metrics_observed_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_content_items_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "social_content_items_workspace_publication_fk" FOREIGN KEY ("workspace_id", "publication_id") REFERENCES "content_publications" ("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "social_content_items_network_ck" CHECK ("network" in ('linkedin')),
  CONSTRAINT "social_content_items_origin_ck" CHECK ("origin" in ('internal', 'external')),
  CONSTRAINT "social_content_items_status_ck" CHECK ("status" in ('observed', 'unavailable')),
  CONSTRAINT "social_content_items_metrics_ck" CHECK (("impressions" is null or "impressions" >= 0) and ("reactions" is null or "reactions" >= 0) and ("comments" is null or "comments" >= 0) and ("reposts" is null or "reposts" >= 0))
);

CREATE UNIQUE INDEX "social_content_items_account_post_uq" ON "social_content_items" ("workspace_id", "connected_account_id", "provider_post_id");

CREATE TABLE "content_metric_snapshots" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "social_content_id" uuid NOT NULL,
  "provider_post_id" text NOT NULL,
  "impressions" integer,
  "reactions" integer,
  "comments" integer,
  "reposts" integer,
  "observed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_metric_snapshots_workspace_content_fk" FOREIGN KEY ("workspace_id", "social_content_id") REFERENCES "social_content_items" ("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "content_metric_snapshots_metrics_ck" CHECK (("impressions" is null or "impressions" >= 0) and ("reactions" is null or "reactions" >= 0) and ("comments" is null or "comments" >= 0) and ("reposts" is null or "reposts" >= 0))
);

CREATE UNIQUE INDEX "content_metric_snapshots_content_observed_uq" ON "content_metric_snapshots" ("workspace_id", "social_content_id", "observed_at");
