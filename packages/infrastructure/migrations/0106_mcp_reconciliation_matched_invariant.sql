-- MCP reconciliation matched rows must carry one authoritative candidate and
-- a non-empty, bounded object result. Forward-only repair after 0105.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_effect_reconciliations'::regclass
      AND conname = 'mcp_effect_reconciliations_matched_result_ck'
  ) THEN
    ALTER TABLE "mcp_effect_reconciliations"
      ADD CONSTRAINT "mcp_effect_reconciliations_matched_result_ck"
      CHECK (
        "status" <> 'matched'
        OR (
          "candidate_count" = 1
          AND "result_snapshot" IS NOT NULL
          AND jsonb_typeof("result_snapshot") = 'object'
          AND "result_snapshot" <> '{}'::jsonb
          AND octet_length("result_snapshot"::text) <= 32768
        )
      );
  END IF;
END $$;
