WITH recovered AS (
  UPDATE "product_research_runs" AS run
  SET
    "status" = 'partial',
    "active_stage" = NULL,
    "updated_at" = now()
  WHERE
    run."status" = 'interrupted'
    AND run."brief" ->> 'researchVersion' = '3'
    AND (
      SELECT stage."error_code"
      FROM "research_stage_runs" AS stage
      WHERE
        stage."workspace_id" = run."workspace_id"
        AND stage."run_id" = run."id"
      ORDER BY stage."started_at" DESC
      LIMIT 1
    ) IN ('RESEARCH_BUDGET_EXHAUSTED', 'RESEARCH_GLOBAL_DEADLINE_EXHAUSTED')
  RETURNING run."workspace_id", run."id"
)
INSERT INTO "outbox_events" (
  "workspace_id",
  "aggregate_type",
  "aggregate_id",
  "event_type",
  "payload",
  "created_at"
)
SELECT
  recovered."workspace_id",
  'product_research_run',
  recovered."id",
  'ProductResearchCompleted',
  jsonb_build_object(
    'type', 'ProductResearchCompleted',
    'runId', recovered."id",
    'workspaceId', recovered."workspace_id",
    'outcome', 'partial',
    'reason', 'budget_exhausted_recovery'
  ),
  now()
FROM recovered;
