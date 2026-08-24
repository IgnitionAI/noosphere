ALTER TABLE "jobs" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "prospect_decisions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "campaign_id" uuid,
  "outreach_action_id" uuid,
  "job_id" uuid NOT NULL,
  "kind" varchar(120) NOT NULL,
  "reason" text NOT NULL,
  "observation" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "proposed_action" varchar(40),
  "due_at" timestamp with time zone NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "status" varchar(40) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "idempotency_key" varchar(500) NOT NULL,
  "correlation_id" varchar(200) NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb,
  "policy_decision" jsonb,
  "last_error_code" varchar(160),
  "last_error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "invalidated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prospect_decisions_status_check" CHECK ("status" IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'awaiting_approval')),
  CONSTRAINT "prospect_decisions_action_check" CHECK ("proposed_action" IS NULL OR "proposed_action" IN ('send', 'wait', 'research', 'pause', 'stop', 'handoff')),
  CONSTRAINT "prospect_decisions_reason_check" CHECK (length(trim("reason")) >= 3),
  CONSTRAINT "prospect_decisions_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "prospect_decisions" ADD CONSTRAINT "prospect_decisions_contact_fk" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prospect_decisions" ADD CONSTRAINT "prospect_decisions_campaign_fk" FOREIGN KEY ("workspace_id", "campaign_id") REFERENCES "public"."campaigns"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prospect_decisions" ADD CONSTRAINT "prospect_decisions_outreach_action_fk" FOREIGN KEY ("workspace_id", "outreach_action_id") REFERENCES "public"."outreach_actions"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_uq" UNIQUE("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "prospect_decisions" ADD CONSTRAINT "prospect_decisions_job_fk" FOREIGN KEY ("workspace_id", "job_id") REFERENCES "public"."jobs"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prospect_decisions" ADD CONSTRAINT "prospect_decisions_workspace_id_uq" UNIQUE("workspace_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_decisions_workspace_key_uq" ON "prospect_decisions" USING btree ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_decisions_workspace_job_uq" ON "prospect_decisions" USING btree ("workspace_id", "job_id");
--> statement-breakpoint
CREATE INDEX "prospect_decisions_due_idx" ON "prospect_decisions" USING btree ("workspace_id", "status", "priority" DESC, "due_at");
--> statement-breakpoint
CREATE INDEX "prospect_decisions_contact_idx" ON "prospect_decisions" USING btree ("workspace_id", "contact_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "prospect_decisions_campaign_idx" ON "prospect_decisions" USING btree ("workspace_id", "campaign_id", "created_at" DESC);
