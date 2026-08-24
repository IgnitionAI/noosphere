CREATE TYPE "public"."ai_capability" AS ENUM('icp_research', 'message_generation', 'setter');--> statement-breakpoint
CREATE TYPE "public"."ai_configuration_status" AS ENUM('candidate', 'shadow', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."evaluation_run_status" AS ENUM('queued', 'running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."evaluation_case_result_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "evaluation_datasets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "capability" "ai_capability" NOT NULL,
  "name" varchar(300) NOT NULL,
  "description" text,
  "rubric_version" varchar(120) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "evaluation_datasets_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "evaluation_datasets_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "evaluation_datasets_workspace_id_uq" UNIQUE("workspace_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_datasets_workspace_name_version_uq" ON "evaluation_datasets" ("workspace_id", "name", "version");--> statement-breakpoint
CREATE INDEX "evaluation_datasets_workspace_capability_idx" ON "evaluation_datasets" ("workspace_id", "capability", "created_at");--> statement-breakpoint
CREATE TABLE "evaluation_cases" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "dataset_id" uuid NOT NULL,
  "name" varchar(300) NOT NULL,
  "input" jsonb NOT NULL,
  "expected" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "authorized_knowledge_claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "evaluation_cases_workspace_dataset_fk" FOREIGN KEY ("workspace_id", "dataset_id") REFERENCES "public"."evaluation_datasets"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "evaluation_cases_workspace_id_uq" UNIQUE("workspace_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_cases_dataset_name_uq" ON "evaluation_cases" ("workspace_id", "dataset_id", "name");--> statement-breakpoint
CREATE TABLE "ai_prompt_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "capability" "ai_capability" NOT NULL,
  "version" integer NOT NULL,
  "content" text NOT NULL,
  "previous_version_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_prompt_versions_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "ai_prompt_versions_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "ai_prompt_versions_workspace_id_uq" UNIQUE("workspace_id", "id"),
  CONSTRAINT "ai_prompt_versions_previous_fk" FOREIGN KEY ("workspace_id", "previous_version_id") REFERENCES "public"."ai_prompt_versions"("workspace_id", "id") ON DELETE restrict
);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_versions_workspace_capability_version_uq" ON "ai_prompt_versions" ("workspace_id", "capability", "version");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_ai_prompt_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI_PROMPT_VERSION_IMMUTABLE' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "ai_prompt_versions_immutable_trg" BEFORE UPDATE ON "ai_prompt_versions" FOR EACH ROW EXECUTE FUNCTION prevent_ai_prompt_version_mutation();--> statement-breakpoint
CREATE TABLE "ai_configurations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "capability" "ai_capability" NOT NULL,
  "provider" varchar(120) NOT NULL,
  "model" varchar(200) NOT NULL,
  "prompt_version_id" uuid NOT NULL,
  "status" "ai_configuration_status" DEFAULT 'candidate' NOT NULL,
  "created_by" uuid,
  "promoted_by" uuid,
  "promoted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_configurations_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "ai_configurations_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "ai_configurations_promoted_by_fk" FOREIGN KEY ("promoted_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "ai_configurations_workspace_prompt_fk" FOREIGN KEY ("workspace_id", "prompt_version_id") REFERENCES "public"."ai_prompt_versions"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "ai_configurations_workspace_id_uq" UNIQUE("workspace_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_configurations_active_capability_uq" ON "ai_configurations" ("workspace_id", "capability") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "ai_configurations_workspace_capability_idx" ON "ai_configurations" ("workspace_id", "capability", "status");--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "prompt_version_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "ai_configuration_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "shadow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_workspace_id_uq" UNIQUE("workspace_id", "id");--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_workspace_prompt_version_fk" FOREIGN KEY ("workspace_id", "prompt_version_id") REFERENCES "public"."ai_prompt_versions"("workspace_id", "id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_workspace_configuration_fk" FOREIGN KEY ("workspace_id", "ai_configuration_id") REFERENCES "public"."ai_configurations"("workspace_id", "id") ON DELETE restrict;--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "dataset_id" uuid NOT NULL,
  "configuration_id" uuid NOT NULL,
  "request_key" varchar(300) NOT NULL,
  "status" "evaluation_run_status" DEFAULT 'queued' NOT NULL,
  "total_cases" integer NOT NULL,
  "completed_cases" integer DEFAULT 0 NOT NULL,
  "failed_cases" integer DEFAULT 0 NOT NULL,
  "aggregate_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "total_cost" numeric(19, 6),
  "total_latency_ms" integer,
  "created_by" uuid,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "evaluation_runs_workspace_dataset_fk" FOREIGN KEY ("workspace_id", "dataset_id") REFERENCES "public"."evaluation_datasets"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "evaluation_runs_workspace_configuration_fk" FOREIGN KEY ("workspace_id", "configuration_id") REFERENCES "public"."ai_configurations"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "evaluation_runs_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "evaluation_runs_workspace_id_uq" UNIQUE("workspace_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_runs_workspace_request_uq" ON "evaluation_runs" ("workspace_id", "request_key");--> statement-breakpoint
CREATE INDEX "evaluation_runs_workspace_created_idx" ON "evaluation_runs" ("workspace_id", "created_at");--> statement-breakpoint
CREATE TABLE "evaluation_case_results" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "evaluation_run_id" uuid NOT NULL,
  "evaluation_case_id" uuid NOT NULL,
  "ai_run_id" uuid,
  "status" "evaluation_case_result_status" DEFAULT 'pending' NOT NULL,
  "output" jsonb,
  "scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "cost" numeric(19, 6),
  "latency_ms" integer,
  "error_code" varchar(120),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "evaluation_case_results_workspace_run_fk" FOREIGN KEY ("workspace_id", "evaluation_run_id") REFERENCES "public"."evaluation_runs"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "evaluation_case_results_workspace_case_fk" FOREIGN KEY ("workspace_id", "evaluation_case_id") REFERENCES "public"."evaluation_cases"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "evaluation_case_results_workspace_ai_run_fk" FOREIGN KEY ("workspace_id", "ai_run_id") REFERENCES "public"."ai_runs"("workspace_id", "id") ON DELETE restrict
);--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_case_results_run_case_uq" ON "evaluation_case_results" ("workspace_id", "evaluation_run_id", "evaluation_case_id");--> statement-breakpoint
CREATE TABLE "ai_feedbacks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "ai_run_id" uuid NOT NULL,
  "rating" integer NOT NULL,
  "reason" varchar(1000),
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_feedbacks_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "ai_feedbacks_workspace_ai_run_fk" FOREIGN KEY ("workspace_id", "ai_run_id") REFERENCES "public"."ai_runs"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "ai_feedbacks_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "ai_feedbacks_rating_ck" CHECK ("rating" in (-1, 1))
);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_feedbacks_workspace_run_author_uq" ON "ai_feedbacks" ("workspace_id", "ai_run_id", "created_by");
