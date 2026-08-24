WITH stage_order(stage, ordinal) AS (
  VALUES
    ('product_truth', 1),
    ('problem_mapping', 2),
    ('organization_discovery', 3),
    ('market_investigation', 4),
    ('buying_context', 5),
    ('sourcing_validation', 6),
    ('icp_composition', 7),
    ('adversarial_review', 8),
    ('objective_ranking', 9)
), recoverable AS MATERIALIZED (
  SELECT
    run.id,
    run.workspace_id,
    run.version,
    next_stage.stage
  FROM product_research_runs run
  CROSS JOIN LATERAL (
    SELECT stage_order.stage
    FROM stage_order
    WHERE NOT (run.completed_stages ? stage_order.stage)
    ORDER BY stage_order.ordinal
    LIMIT 1
  ) next_stage
  WHERE run.status = 'partial'
    AND run.brief ->> 'researchVersion' = '3'
    AND EXISTS (
      SELECT 1
      FROM research_stage_runs stage_run
      WHERE stage_run.workspace_id = run.workspace_id
        AND stage_run.run_id = run.id
        AND stage_run.error_code = 'RESEARCH_BUDGET_EXHAUSTED'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM product_research_runs active_run
      WHERE active_run.workspace_id = run.workspace_id
        AND active_run.id <> run.id
        AND active_run.status IN ('queued', 'running', 'paused')
    )
), resumed AS (
  UPDATE product_research_runs run
  SET status = 'queued',
      active_stage = NULL,
      deadline_at = now() + CASE run.brief ->> 'depth'
        WHEN 'quick' THEN interval '30 minutes'
        WHEN 'deep' THEN interval '90 minutes'
        ELSE interval '60 minutes'
      END,
      version = run.version + 1,
      updated_at = now()
  FROM recoverable
  WHERE run.workspace_id = recoverable.workspace_id
    AND run.id = recoverable.id
    AND run.status = 'partial'
  RETURNING
    run.id,
    run.workspace_id,
    run.version,
    recoverable.stage
), enqueued AS (
  INSERT INTO jobs (
    id,
    workspace_id,
    type,
    payload,
    idempotency_key,
    correlation_id,
    status,
    attempts,
    max_attempts,
    priority,
    available_at,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    resumed.workspace_id,
    'research.stage.execute',
    jsonb_build_object(
      'workspaceId', resumed.workspace_id,
      'runId', resumed.id,
      'stage', resumed.stage,
      'workItemKey', 'main',
      'hypothesisId', NULL,
      'fanoutSize', NULL,
      'finalizeFanout', false
    ),
    resumed.id || ':' || resumed.stage || ':automatic-budget-recovery:v' || resumed.version,
    'research-budget-recovery:' || resumed.id,
    'pending',
    0,
    5,
    0,
    now(),
    now(),
    now()
  FROM resumed
  ON CONFLICT (workspace_id, type, idempotency_key) DO NOTHING
  RETURNING id, workspace_id, payload
)
INSERT INTO outbox_events (
  id,
  workspace_id,
  aggregate_type,
  aggregate_id,
  event_type,
  payload,
  available_at,
  created_at
)
SELECT
  gen_random_uuid(),
  enqueued.workspace_id,
  'product_research_run',
  (enqueued.payload ->> 'runId')::uuid,
  'ProductResearchResumed',
  jsonb_build_object(
    'type', 'ProductResearchResumed',
    'runId', enqueued.payload ->> 'runId',
    'workspaceId', enqueued.workspace_id,
    'reason', 'automatic_stage_budget_recovery',
    'jobId', enqueued.id
  ),
  now(),
  now()
FROM enqueued;
