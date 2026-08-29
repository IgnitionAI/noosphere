-- Repair for the first 0103 rollout.
--
-- This migration is intentionally additive and forward-only.  Some databases
-- have already recorded 0103, so every constraint addition is guarded by its
-- relation and constraint name.  Existing rows, tables, and volumes are not
-- removed or rewritten.

ALTER TABLE "mcp_effect_proposals"
  ADD COLUMN IF NOT EXISTS "policy_preview" jsonb,
  ADD COLUMN IF NOT EXISTS "policy_final" jsonb;

-- The first 0103 used this name for a weaker predicate.  Replace that
-- constraint in place so an already-recorded migration receives the strict
-- started-state lease invariant as well.  Dropping a constraint does not
-- remove rows or data, and both statements are safe to repeat.
ALTER TABLE "mcp_effect_intentions"
  DROP CONSTRAINT IF EXISTS "mcp_effect_intentions_lease_ck";
ALTER TABLE "mcp_effect_intentions"
  ADD CONSTRAINT "mcp_effect_intentions_lease_ck"
  CHECK (("state" = 'started' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" <> 'started' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_effect_proposals'::regclass
      AND conname = 'mcp_effect_proposals_policy_preview_ck'
  ) THEN
    ALTER TABLE "mcp_effect_proposals"
      ADD CONSTRAINT "mcp_effect_proposals_policy_preview_ck"
      CHECK ("policy_preview" IS NULL OR (jsonb_typeof("policy_preview") = 'object' AND octet_length("policy_preview"::text) <= 32768));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_effect_proposals'::regclass
      AND conname = 'mcp_effect_proposals_policy_final_ck'
  ) THEN
    ALTER TABLE "mcp_effect_proposals"
      ADD CONSTRAINT "mcp_effect_proposals_policy_final_ck"
      CHECK ("policy_final" IS NULL OR (jsonb_typeof("policy_final") = 'object' AND octet_length("policy_final"::text) <= 32768));
  END IF;

END $$;

ALTER TABLE "approval_items"
  ADD COLUMN IF NOT EXISTS "proposal_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'approval_items'::regclass
      AND conname = 'approval_items_proposal_fk'
  ) THEN
    ALTER TABLE "approval_items"
      ADD CONSTRAINT "approval_items_proposal_fk"
      FOREIGN KEY ("workspace_id", "proposal_id")
      REFERENCES "mcp_effect_proposals" ("workspace_id", "id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'approval_items'::regclass
      AND conname = 'approval_items_workspace_proposal_uq'
  ) THEN
    ALTER TABLE "approval_items"
      ADD CONSTRAINT "approval_items_workspace_proposal_uq"
      UNIQUE ("workspace_id", "proposal_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_operations'::regclass
      AND conname = 'mcp_operations_workspace_id_uq'
  ) THEN
    ALTER TABLE "mcp_operations"
      ADD CONSTRAINT "mcp_operations_workspace_id_uq"
      UNIQUE ("workspace_id", "operation_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_effect_proposals'::regclass
      AND conname = 'mcp_effect_proposals_approval_item_fk'
  ) THEN
    ALTER TABLE "mcp_effect_proposals"
      ADD CONSTRAINT "mcp_effect_proposals_approval_item_fk"
      FOREIGN KEY ("workspace_id", "approval_item_id")
      REFERENCES "approval_items" ("workspace_id", "id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_effect_proposals'::regclass
      AND conname = 'mcp_effect_proposals_operation_fk'
  ) THEN
    ALTER TABLE "mcp_effect_proposals"
      ADD CONSTRAINT "mcp_effect_proposals_operation_fk"
      FOREIGN KEY ("workspace_id", "operation_id")
      REFERENCES "mcp_operations" ("workspace_id", "operation_id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_effect_proposals'::regclass
      AND conname = 'mcp_effect_proposals_job_fk'
  ) THEN
    ALTER TABLE "mcp_effect_proposals"
      ADD CONSTRAINT "mcp_effect_proposals_job_fk"
      FOREIGN KEY ("workspace_id", "job_id")
      REFERENCES "jobs" ("workspace_id", "id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_effect_proposals'::regclass
      AND conname = 'mcp_effect_proposals_reconciliation_fk'
  ) THEN
    ALTER TABLE "mcp_effect_proposals"
      ADD CONSTRAINT "mcp_effect_proposals_reconciliation_fk"
      FOREIGN KEY ("workspace_id", "reconciliation_id")
      REFERENCES "mcp_effect_reconciliations" ("workspace_id", "id") ON DELETE RESTRICT;
  END IF;
END $$;
