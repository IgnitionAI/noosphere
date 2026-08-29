-- MCP governed external effects persistence.
-- Additive and forward-only: no existing rows, tables, or volumes are removed.

ALTER TABLE "meeting_proposals" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE "meeting_proposals" ADD COLUMN IF NOT EXISTS "source_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "meeting_proposals" ADD CONSTRAINT "meeting_proposals_revision_ck" CHECK ("revision" > 0);
ALTER TABLE "meeting_proposals" ADD CONSTRAINT "meeting_proposals_source_version_ck" CHECK ("source_version" > 0);

CREATE TABLE IF NOT EXISTS "mcp_effect_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "client_id" varchar(180) NOT NULL,
  "kind" varchar(40) NOT NULL,
  "request_key" uuid NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "intent_snapshot" jsonb NOT NULL,
  "source_snapshot" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "source_version" integer NOT NULL DEFAULT 1,
  "policy_preview" jsonb,
  "policy_final" jsonb,
  "status" varchar(32) NOT NULL DEFAULT 'approval_required',
  "version" integer NOT NULL DEFAULT 1,
  "approval_item_id" uuid,
  "operation_id" uuid,
  "job_id" uuid,
  "reconciliation_id" uuid,
  "correlation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_effect_proposals_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "mcp_effect_proposals_idempotency_uq" UNIQUE ("workspace_id", "client_id", "kind", "request_key"),
  CONSTRAINT "mcp_effect_proposals_kind_ck" CHECK ("kind" IN ('conversation_reply', 'content_publication', 'meeting_proposal', 'campaign_activation')),
  CONSTRAINT "mcp_effect_proposals_status_ck" CHECK ("status" IN ('approval_required', 'policy_denied', 'queued', 'accepted', 'unknown', 'reconciling', 'delivered', 'failed', 'rejected', 'invalidated')),
  CONSTRAINT "mcp_effect_proposals_input_hash_ck" CHECK (length("input_hash") = 64),
  CONSTRAINT "mcp_effect_proposals_snapshot_ck" CHECK (jsonb_typeof("intent_snapshot") = 'object' AND jsonb_typeof("source_snapshot") = 'object' AND octet_length("intent_snapshot"::text) <= 32768 AND octet_length("source_snapshot"::text) <= 32768),
  CONSTRAINT "mcp_effect_proposals_policy_preview_ck" CHECK ("policy_preview" IS NULL OR (jsonb_typeof("policy_preview") = 'object' AND octet_length("policy_preview"::text) <= 32768)),
  CONSTRAINT "mcp_effect_proposals_policy_final_ck" CHECK ("policy_final" IS NULL OR (jsonb_typeof("policy_final") = 'object' AND octet_length("policy_final"::text) <= 32768)),
  CONSTRAINT "mcp_effect_proposals_versions_ck" CHECK ("revision" > 0 AND "source_version" > 0 AND "version" > 0)
);
CREATE INDEX IF NOT EXISTS "mcp_effect_proposals_workspace_status_idx" ON "mcp_effect_proposals" ("workspace_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "mcp_effect_proposals_aggregate_idx" ON "mcp_effect_proposals" ("workspace_id", "kind", "aggregate_id");
CREATE INDEX IF NOT EXISTS "mcp_effect_proposals_correlation_idx" ON "mcp_effect_proposals" ("workspace_id", "correlation_id");

CREATE TABLE IF NOT EXISTS "mcp_effect_intentions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "proposal_id" uuid NOT NULL,
  "kind" varchar(40) NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "state" varchar(16) NOT NULL DEFAULT 'queued',
  "idempotency_key" varchar(500) NOT NULL,
  "job_id" uuid NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamptz,
  "correlation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_effect_intentions_proposal_fk" FOREIGN KEY ("workspace_id", "proposal_id") REFERENCES "mcp_effect_proposals"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "mcp_effect_intentions_job_fk" FOREIGN KEY ("workspace_id", "job_id") REFERENCES "jobs"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "mcp_effect_intentions_workspace_proposal_uq" UNIQUE ("workspace_id", "proposal_id"),
  CONSTRAINT "mcp_effect_intentions_workspace_identity_uq" UNIQUE ("workspace_id", "kind", "aggregate_id", "idempotency_key"),
  CONSTRAINT "mcp_effect_intentions_kind_ck" CHECK ("kind" IN ('conversation_reply', 'content_publication', 'meeting_proposal', 'campaign_activation')),
  CONSTRAINT "mcp_effect_intentions_state_ck" CHECK ("state" IN ('queued', 'started', 'unknown', 'completed')),
  CONSTRAINT "mcp_effect_intentions_idempotency_ck" CHECK (length("idempotency_key") BETWEEN 1 AND 500),
  CONSTRAINT "mcp_effect_intentions_lease_ck" CHECK (("state" = 'started' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" <> 'started' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL))
);
CREATE INDEX IF NOT EXISTS "mcp_effect_intentions_expiration_idx" ON "mcp_effect_intentions" ("workspace_id", "state", "lease_expires_at");
CREATE INDEX IF NOT EXISTS "mcp_effect_intentions_job_idx" ON "mcp_effect_intentions" ("workspace_id", "job_id");

CREATE TABLE IF NOT EXISTS "mcp_effect_traces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "proposal_id" uuid NOT NULL,
  "stage" varchar(24) NOT NULL,
  "sequence" integer NOT NULL,
  "source_event_id" uuid NOT NULL,
  "idempotency_key" varchar(500) NOT NULL,
  "event_type" varchar(160) NOT NULL,
  "redacted_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor" varchar(120),
  "correlation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_effect_traces_proposal_fk" FOREIGN KEY ("workspace_id", "proposal_id") REFERENCES "mcp_effect_proposals"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "mcp_effect_traces_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "mcp_effect_traces_stage_sequence_uq" UNIQUE ("workspace_id", "proposal_id", "stage", "sequence"),
  CONSTRAINT "mcp_effect_traces_source_event_uq" UNIQUE ("workspace_id", "source_event_id"),
  CONSTRAINT "mcp_effect_traces_idempotency_uq" UNIQUE ("workspace_id", "proposal_id", "idempotency_key"),
  CONSTRAINT "mcp_effect_traces_stage_ck" CHECK ("stage" IN ('proposal', 'approval', 'policy', 'outbox', 'attempt', 'result')),
  CONSTRAINT "mcp_effect_traces_sequence_ck" CHECK ("sequence" > 0),
  CONSTRAINT "mcp_effect_traces_payload_ck" CHECK (jsonb_typeof("redacted_payload") = 'object' AND octet_length("redacted_payload"::text) <= 32768)
);
CREATE INDEX IF NOT EXISTS "mcp_effect_traces_proposal_sequence_idx" ON "mcp_effect_traces" ("workspace_id", "proposal_id", "sequence");
CREATE INDEX IF NOT EXISTS "mcp_effect_traces_correlation_idx" ON "mcp_effect_traces" ("workspace_id", "correlation_id");
CREATE INDEX IF NOT EXISTS "mcp_effect_traces_stage_idx" ON "mcp_effect_traces" ("workspace_id", "stage", "created_at");

CREATE TABLE IF NOT EXISTS "mcp_effect_reconciliations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "proposal_id" uuid NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "criteria_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "lease_token" uuid,
  "lease_expires_at" timestamptz,
  "next_attempt_at" timestamptz,
  "completed_at" timestamptz,
  "candidate_count" integer NOT NULL DEFAULT 0,
  "error_code" varchar(120),
  "error_message" varchar(500),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_effect_reconciliations_proposal_fk" FOREIGN KEY ("workspace_id", "proposal_id") REFERENCES "mcp_effect_proposals"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "mcp_effect_reconciliations_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "mcp_effect_reconciliations_proposal_uq" UNIQUE ("workspace_id", "proposal_id"),
  CONSTRAINT "mcp_effect_reconciliations_status_ck" CHECK ("status" IN ('pending', 'searching', 'matched', 'not_found', 'ambiguous', 'error')),
  CONSTRAINT "mcp_effect_reconciliations_attempts_ck" CHECK ("attempts" >= 0 AND "max_attempts" > 0 AND "attempts" <= "max_attempts"),
  CONSTRAINT "mcp_effect_reconciliations_candidates_ck" CHECK ("candidate_count" >= 0),
  CONSTRAINT "mcp_effect_reconciliations_snapshot_ck" CHECK (jsonb_typeof("criteria_snapshot") = 'object' AND octet_length("criteria_snapshot"::text) <= 32768),
  CONSTRAINT "mcp_effect_reconciliations_terminal_ck" CHECK ("completed_at" IS NULL OR "status" IN ('matched', 'not_found', 'ambiguous', 'error'))
);
CREATE INDEX IF NOT EXISTS "mcp_effect_reconciliations_due_idx" ON "mcp_effect_reconciliations" ("workspace_id", "status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "mcp_effect_reconciliations_expiration_idx" ON "mcp_effect_reconciliations" ("workspace_id", "status", "lease_expires_at");

ALTER TABLE "approval_items" ADD COLUMN IF NOT EXISTS "proposal_id" uuid;
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_proposal_fk" FOREIGN KEY ("workspace_id", "proposal_id") REFERENCES "mcp_effect_proposals"("workspace_id", "id") ON DELETE CASCADE;
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_workspace_proposal_uq" UNIQUE ("workspace_id", "proposal_id");

-- Back-references are nullable, but every populated value must resolve within
-- the proposal workspace. RESTRICT avoids orphaning a proposal pointer while
-- retaining the NOT NULL workspace identity on the referencing row.
ALTER TABLE "mcp_operations" ADD CONSTRAINT "mcp_operations_workspace_id_uq" UNIQUE ("workspace_id", "operation_id");
ALTER TABLE "mcp_effect_proposals" ADD CONSTRAINT "mcp_effect_proposals_approval_item_fk"
  FOREIGN KEY ("workspace_id", "approval_item_id") REFERENCES "approval_items"("workspace_id", "id") ON DELETE RESTRICT;
ALTER TABLE "mcp_effect_proposals" ADD CONSTRAINT "mcp_effect_proposals_operation_fk"
  FOREIGN KEY ("workspace_id", "operation_id") REFERENCES "mcp_operations"("workspace_id", "operation_id") ON DELETE RESTRICT;
ALTER TABLE "mcp_effect_proposals" ADD CONSTRAINT "mcp_effect_proposals_job_fk"
  FOREIGN KEY ("workspace_id", "job_id") REFERENCES "jobs"("workspace_id", "id") ON DELETE RESTRICT;
ALTER TABLE "mcp_effect_proposals" ADD CONSTRAINT "mcp_effect_proposals_reconciliation_fk"
  FOREIGN KEY ("workspace_id", "reconciliation_id") REFERENCES "mcp_effect_reconciliations"("workspace_id", "id") ON DELETE RESTRICT;
