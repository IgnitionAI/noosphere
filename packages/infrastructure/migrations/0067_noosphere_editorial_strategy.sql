CREATE TYPE "editorial_strategy_status" AS ENUM ('draft', 'active', 'archived');

CREATE TABLE "editorial_strategies" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" varchar(500) NOT NULL,
  "offer_id" uuid NOT NULL,
  "offer_version_id" uuid NOT NULL,
  "icp_id" uuid NOT NULL,
  "icp_version_id" uuid NOT NULL,
  "status" "editorial_strategy_status" DEFAULT 'draft' NOT NULL,
  "current_version" integer DEFAULT 0 NOT NULL,
  "draft" jsonb NOT NULL,
  "provider" varchar(120) NOT NULL,
  "model" varchar(200) NOT NULL,
  "prompt_version" varchar(120) NOT NULL,
  "ai_run_id" uuid,
  "created_by" uuid,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "editorial_strategies_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "editorial_strategies_workspace_offer_fk" FOREIGN KEY ("workspace_id", "offer_id") REFERENCES "offers" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "editorial_strategies_workspace_offer_version_fk" FOREIGN KEY ("workspace_id", "offer_version_id") REFERENCES "offer_versions" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "editorial_strategies_workspace_icp_fk" FOREIGN KEY ("workspace_id", "icp_id") REFERENCES "icps" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "editorial_strategies_workspace_icp_version_fk" FOREIGN KEY ("workspace_id", "icp_version_id") REFERENCES "icp_versions" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "editorial_strategies_workspace_ai_run_fk" FOREIGN KEY ("workspace_id", "ai_run_id") REFERENCES "ai_runs" ("workspace_id", "id") ON DELETE set null,
  CONSTRAINT "editorial_strategies_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "auth_users" ("id") ON DELETE set null
);

CREATE UNIQUE INDEX "editorial_strategies_workspace_grounding_uq"
  ON "editorial_strategies" ("workspace_id", "offer_id", "icp_id")
  WHERE "deleted_at" IS NULL;

CREATE TABLE "editorial_strategy_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "strategy_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "offer_version_id" uuid NOT NULL,
  "icp_version_id" uuid NOT NULL,
  "snapshot" jsonb NOT NULL,
  "provider" varchar(120) NOT NULL,
  "model" varchar(200) NOT NULL,
  "prompt_version" varchar(120) NOT NULL,
  "ai_run_id" uuid,
  "published_by" uuid,
  "published_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "editorial_strategy_versions_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "editorial_strategy_versions_workspace_strategy_fk" FOREIGN KEY ("workspace_id", "strategy_id") REFERENCES "editorial_strategies" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "editorial_strategy_versions_workspace_offer_fk" FOREIGN KEY ("workspace_id", "offer_version_id") REFERENCES "offer_versions" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "editorial_strategy_versions_workspace_icp_fk" FOREIGN KEY ("workspace_id", "icp_version_id") REFERENCES "icp_versions" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "editorial_strategy_versions_workspace_ai_run_fk" FOREIGN KEY ("workspace_id", "ai_run_id") REFERENCES "ai_runs" ("workspace_id", "id") ON DELETE set null,
  CONSTRAINT "editorial_strategy_versions_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "auth_users" ("id") ON DELETE set null
);

CREATE UNIQUE INDEX "editorial_strategy_versions_strategy_version_uq"
  ON "editorial_strategy_versions" ("workspace_id", "strategy_id", "version");

CREATE TABLE "content_operation_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "operation" varchar(120) NOT NULL,
  "request_key" varchar(300) NOT NULL,
  "resource_type" varchar(120) NOT NULL,
  "resource_id" uuid NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "content_operation_requests_workspace_key_uq"
  ON "content_operation_requests" ("workspace_id", "operation", "request_key");
