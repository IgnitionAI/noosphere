-- MCP reconciliation evidence and bounded recovery.
-- Forward-only and additive: existing 0103/0104 migrations are immutable.

ALTER TABLE "mcp_effect_reconciliations"
  ADD COLUMN IF NOT EXISTS "result_snapshot" jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_effect_reconciliations'::regclass
      AND conname = 'mcp_effect_reconciliations_result_snapshot_ck'
  ) THEN
    ALTER TABLE "mcp_effect_reconciliations"
      ADD CONSTRAINT "mcp_effect_reconciliations_result_snapshot_ck"
      CHECK ("result_snapshot" IS NULL OR (jsonb_typeof("result_snapshot") = 'object' AND octet_length("result_snapshot"::text) <= 32768));
  END IF;
END $$;
