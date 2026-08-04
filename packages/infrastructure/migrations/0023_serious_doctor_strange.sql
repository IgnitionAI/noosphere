CREATE TYPE "public"."channel_assessment_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."channel_recommendation" AS ENUM('recommended', 'optional', 'unsuitable');--> statement-breakpoint
CREATE TYPE "public"."prospecting_channel" AS ENUM('linkedin', 'email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."prospecting_plan_status" AS ENUM('assessing', 'ready', 'archived');--> statement-breakpoint
CREATE TABLE "channel_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"channel" "prospecting_channel" NOT NULL,
	"status" "channel_assessment_status" DEFAULT 'pending' NOT NULL,
	"recommendation" "channel_recommendation",
	"score" integer,
	"strategy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(120),
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_assessments_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "prospecting_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"icp_version_id" uuid NOT NULL,
	"name" varchar(300) NOT NULL,
	"status" "prospecting_plan_status" DEFAULT 'assessing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospecting_plans_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
DROP INDEX "campaigns_icp_version_uq";--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "discovery_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "assessment_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "channel" "prospecting_channel";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "legacy_reason" varchar(120);--> statement-breakpoint
ALTER TABLE "channel_assessments" ADD CONSTRAINT "channel_assessments_plan_id_prospecting_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prospecting_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_assessments" ADD CONSTRAINT "channel_assessments_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_plans" ADD CONSTRAINT "prospecting_plans_icp_version_id_icp_versions_id_fk" FOREIGN KEY ("icp_version_id") REFERENCES "public"."icp_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_plans" ADD CONSTRAINT "prospecting_plans_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_assessments_plan_channel_uq" ON "channel_assessments" USING btree ("workspace_id","plan_id","channel");--> statement-breakpoint
CREATE INDEX "channel_assessments_workspace_status_idx" ON "channel_assessments" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prospecting_plans_icp_version_uq" ON "prospecting_plans" USING btree ("workspace_id","icp_version_id");--> statement-breakpoint
CREATE INDEX "prospecting_plans_workspace_status_idx" ON "prospecting_plans" USING btree ("workspace_id","status");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_plan_id_prospecting_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prospecting_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_assessment_id_channel_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."channel_assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_plan_channel_uq" ON "campaigns" USING btree ("workspace_id","plan_id","channel") WHERE "campaigns"."plan_id" is not null and "campaigns"."channel" is not null;--> statement-breakpoint

-- The previous model mixed LinkedIn, email and WhatsApp in one campaign. Keep
-- its audit trail, but make it impossible to activate or retry.
UPDATE prospect_discovery_runs d
SET status = 'failed',
	error_code = 'LEGACY_MULTICHANNEL_MODEL_ARCHIVED',
	error_message = 'The legacy multichannel campaign was archived before channel-specific rebuilding.',
	completed_at = now()
FROM campaigns c
WHERE c.discovery_run_id = d.id AND d.status = 'running';--> statement-breakpoint

UPDATE jobs j
SET status = 'dead_lettered',
	last_error_code = 'LEGACY_MULTICHANNEL_MODEL_ARCHIVED',
	last_error_message = 'The legacy multichannel campaign was archived before channel-specific rebuilding.',
	locked_at = NULL,
	locked_until = NULL,
	locked_by = NULL,
	updated_at = now()
FROM campaigns c
WHERE j.type = 'prospect.discovery.execute'
	AND j.payload->>'runId' = c.discovery_run_id::text
	AND j.status IN ('pending', 'retry', 'running');--> statement-breakpoint

UPDATE campaigns
SET status = 'archived',
	legacy_reason = 'legacy_multichannel_model',
	updated_at = now()
WHERE plan_id IS NULL;--> statement-breakpoint

INSERT INTO prospecting_plans (id, workspace_id, icp_version_id, name, status, created_at, updated_at)
SELECT
	gen_random_uuid(),
	v.workspace_id,
	v.id,
	left('Plan — ' || v.name, 300),
	'assessing',
	now(),
	now()
FROM icp_versions v
LEFT JOIN prospecting_plans p
	ON p.workspace_id = v.workspace_id AND p.icp_version_id = v.id
WHERE p.id IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO channel_assessments (
	id, workspace_id, plan_id, channel, status, strategy, metrics, evidence,
	sample_size, created_at, updated_at
)
SELECT
	gen_random_uuid(),
	p.workspace_id,
	p.id,
	channel.value::prospecting_channel,
	'pending',
	'{}'::jsonb,
	'{}'::jsonb,
	'[]'::jsonb,
	0,
	now(),
	now()
FROM prospecting_plans p
CROSS JOIN (VALUES ('linkedin'), ('email'), ('whatsapp')) AS channel(value)
LEFT JOIN channel_assessments a
	ON a.workspace_id = p.workspace_id
	AND a.plan_id = p.id
	AND a.channel = channel.value::prospecting_channel
WHERE a.id IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO jobs (
	id, workspace_id, type, payload, idempotency_key, correlation_id,
	status, attempts, max_attempts, available_at, created_at, updated_at
)
SELECT
	gen_random_uuid(),
	a.workspace_id,
	'prospecting.channel.assess',
	jsonb_build_object('workspaceId', a.workspace_id, 'assessmentId', a.id),
	a.id::text || ':initial',
	'prospecting-plan:' || a.plan_id::text,
	'pending',
	0,
	3,
	now(),
	now(),
	now()
FROM channel_assessments a
WHERE a.status = 'pending'
ON CONFLICT DO NOTHING;
