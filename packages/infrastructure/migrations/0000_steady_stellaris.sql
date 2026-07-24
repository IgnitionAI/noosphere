CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'retry', 'completed', 'dead_lettered');--> statement-breakpoint
CREATE TYPE "public"."product_research_status" AS ENUM('draft', 'queued', 'running', 'paused', 'ready_for_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."research_checkpoint_review" AS ENUM('machine', 'human_reviewed');--> statement-breakpoint
CREATE TYPE "public"."research_stage" AS ENUM('product_analysis', 'competitor_discovery', 'competitor_analysis', 'segment_synthesis', 'icp_synthesis', 'evidence_review');--> statement-breakpoint
CREATE TYPE "public"."research_stage_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_research_run_id" uuid,
	"research_stage_run_id" uuid,
	"purpose" varchar(120) NOT NULL,
	"provider" varchar(120) NOT NULL,
	"model" varchar(200) NOT NULL,
	"prompt_version" varchar(120) NOT NULL,
	"input_hash" varchar(128) NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"status" varchar(50) NOT NULL,
	"cost" numeric(19, 6),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"name" varchar(300) NOT NULL,
	"url" text,
	"relation" varchar(40) NOT NULL,
	"rationale" text NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"qualification_status" varchar(40) DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icp_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"rank" integer NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"criteria" jsonb NOT NULL,
	"buying_committee" jsonb NOT NULL,
	"problems" jsonb NOT NULL,
	"signals" jsonb NOT NULL,
	"exclusions" jsonb NOT NULL,
	"unknowns" jsonb NOT NULL,
	"human_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" varchar(160) NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" varchar(500) NOT NULL,
	"correlation_id" varchar(200) NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"locked_by" varchar(200),
	"completed_at" timestamp with time zone,
	"last_error_code" varchar(120),
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"content_hash" varchar(128) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_evidence_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"aggregate_type" varchar(120) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(160) NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_research_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brief" jsonb NOT NULL,
	"status" "product_research_status" DEFAULT 'draft' NOT NULL,
	"active_stage" "research_stage",
	"completed_stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_research_runs_workspace_id_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "research_finding_evidence" (
	"workspace_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "research_finding_evidence_pk" PRIMARY KEY("workspace_id","finding_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "research_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" "research_stage" NOT NULL,
	"finding_path" varchar(500) NOT NULL,
	"statement" text NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"hypothesis" boolean NOT NULL,
	"review_status" varchar(40) DEFAULT 'unreviewed' NOT NULL,
	"human_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_findings_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "research_stage_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" "research_stage" NOT NULL,
	"attempt" integer NOT NULL,
	"status" "research_stage_status" NOT NULL,
	"review" "research_checkpoint_review" DEFAULT 'machine' NOT NULL,
	"input_hash" varchar(128) NOT NULL,
	"output_hash" varchar(128),
	"output" jsonb,
	"error_code" varchar(120),
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "research_stage_runs_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_workspace_research_run_fk" FOREIGN KEY ("workspace_id","product_research_run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_workspace_stage_run_fk" FOREIGN KEY ("workspace_id","research_stage_run_id") REFERENCES "public"."research_stage_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_candidates" ADD CONSTRAINT "competitor_candidates_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_proposals" ADD CONSTRAINT "icp_proposals_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_evidence" ADD CONSTRAINT "market_evidence_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_runs" ADD CONSTRAINT "product_research_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_finding_evidence" ADD CONSTRAINT "research_finding_evidence_workspace_finding_fk" FOREIGN KEY ("workspace_id","finding_id") REFERENCES "public"."research_findings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_finding_evidence" ADD CONSTRAINT "research_finding_evidence_workspace_evidence_fk" FOREIGN KEY ("workspace_id","evidence_id") REFERENCES "public"."market_evidence"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_stage_runs" ADD CONSTRAINT "research_stage_runs_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_workspace_research_idx" ON "ai_runs" USING btree ("workspace_id","product_research_run_id");--> statement-breakpoint
CREATE INDEX "competitor_candidates_workspace_run_idx" ON "competitor_candidates" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "icp_proposals_rank_uq" ON "icp_proposals" USING btree ("workspace_id","run_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_workspace_type_idempotency_uq" ON "jobs" USING btree ("workspace_id","type","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("status","available_at","locked_until");--> statement-breakpoint
CREATE INDEX "jobs_workspace_status_idx" ON "jobs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "market_evidence_run_hash_uq" ON "market_evidence" USING btree ("workspace_id","run_id","content_hash");--> statement-breakpoint
CREATE INDEX "outbox_events_publish_idx" ON "outbox_events" USING btree ("published_at","available_at");--> statement-breakpoint
CREATE INDEX "outbox_events_workspace_idx" ON "outbox_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "product_research_runs_workspace_status_idx" ON "product_research_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "research_finding_evidence_workspace_idx" ON "research_finding_evidence" USING btree ("workspace_id","finding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_findings_path_uq" ON "research_findings" USING btree ("workspace_id","run_id","finding_path");--> statement-breakpoint
CREATE UNIQUE INDEX "research_stage_runs_attempt_uq" ON "research_stage_runs" USING btree ("workspace_id","run_id","stage","attempt");--> statement-breakpoint
CREATE INDEX "research_stage_runs_completed_idx" ON "research_stage_runs" USING btree ("workspace_id","run_id","stage","status");