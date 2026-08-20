CREATE TABLE "content_idea_discovery_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "strategy_version_id" uuid NOT NULL,
  "trigger" varchar(20) NOT NULL,
  "status" varchar(40) DEFAULT 'queued' NOT NULL,
  "query_plan" jsonb NOT NULL,
  "cursor" integer DEFAULT 0 NOT NULL,
  "query_count" integer DEFAULT 0 NOT NULL,
  "source_count" integer DEFAULT 0 NOT NULL,
  "idea_count" integer DEFAULT 0 NOT NULL,
  "query_limit" integer NOT NULL,
  "source_limit" integer NOT NULL,
  "deadline_at" timestamp with time zone NOT NULL,
  "last_error_code" varchar(160),
  "last_error_message" text,
  "created_by" uuid REFERENCES "auth_users" ("id") ON DELETE set null,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_idea_runs_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "content_idea_runs_workspace_strategy_version_fk" FOREIGN KEY ("workspace_id", "strategy_version_id") REFERENCES "editorial_strategy_versions" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_idea_runs_trigger_ck" CHECK ("trigger" in ('manual', 'daily')),
  CONSTRAINT "content_idea_runs_status_ck" CHECK ("status" in ('queued', 'running', 'completed', 'partial', 'failed')),
  CONSTRAINT "content_idea_runs_budget_ck" CHECK ("query_limit" > 0 and "source_limit" > 0)
);

CREATE TABLE "content_ideas" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "strategy_version_id" uuid NOT NULL,
  "status" varchar(40) DEFAULT 'discovered' NOT NULL,
  "angle" varchar(500) NOT NULL,
  "rationale" text NOT NULL,
  "audience" varchar(500) NOT NULL,
  "pillar" varchar(300) NOT NULL,
  "priority" integer NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "freshness_until" timestamp with time zone NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_ideas_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "content_ideas_workspace_strategy_version_fk" FOREIGN KEY ("workspace_id", "strategy_version_id") REFERENCES "editorial_strategy_versions" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_ideas_status_ck" CHECK ("status" in ('discovered', 'shortlisted', 'briefed', 'discarded', 'expired')),
  CONSTRAINT "content_ideas_priority_ck" CHECK ("priority" between 0 and 100)
);

CREATE UNIQUE INDEX "content_ideas_workspace_fingerprint_uq" ON "content_ideas" ("workspace_id", "fingerprint");

CREATE TABLE "content_idea_sources" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "idea_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "type" varchar(40) NOT NULL,
  "source_ref" varchar(500) NOT NULL,
  "canonical_url" text,
  "title" varchar(500) NOT NULL,
  "excerpt" text NOT NULL,
  "content_hash" varchar(128) NOT NULL,
  "collected_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_idea_sources_workspace_idea_fk" FOREIGN KEY ("workspace_id", "idea_id") REFERENCES "content_ideas" ("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "content_idea_sources_workspace_run_fk" FOREIGN KEY ("workspace_id", "run_id") REFERENCES "content_idea_discovery_runs" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "content_idea_sources_type_ck" CHECK ("type" in ('offer_claim', 'knowledge_claim', 'conversation_message', 'public_web'))
);

CREATE UNIQUE INDEX "content_idea_sources_idea_hash_uq" ON "content_idea_sources" ("workspace_id", "idea_id", "content_hash");

CREATE TABLE "content_idea_schedules" (
  "workspace_id" uuid PRIMARY KEY REFERENCES "workspaces" ("id") ON DELETE cascade,
  "enabled" boolean DEFAULT true NOT NULL,
  "local_time" varchar(5) DEFAULT '06:00' NOT NULL,
  "timezone" varchar(120) DEFAULT 'Europe/Paris' NOT NULL,
  "last_run_at" timestamp with time zone,
  "next_run_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_idea_schedules_local_time_ck" CHECK ("local_time" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
);
