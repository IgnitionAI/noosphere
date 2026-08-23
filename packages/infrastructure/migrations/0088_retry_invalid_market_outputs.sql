WITH recoverable AS MATERIALIZED (
  SELECT
    job.id AS job_id,
    job.workspace_id,
    job.payload,
    item.id AS work_item_id
  FROM jobs job
  JOIN product_research_runs run
    ON run.workspace_id = job.workspace_id
   AND run.id = (job.payload ->> 'runId')::uuid
  JOIN research_work_items item
    ON item.workspace_id = job.workspace_id
   AND item.run_id = run.id
   AND item.stage = 'market_investigation'
   AND item.work_item_key = job.payload ->> 'workItemKey'
  WHERE job.type = 'research.stage.execute'
    AND job.status = 'completed'
    AND job.payload ->> 'stage' = 'market_investigation'
    AND run.status = 'running'
    AND run.active_stage = 'market_investigation'
    AND item.status = 'failed'
    AND item.error_code = 'AGENT_EXECUTION_FAILED'
    AND EXISTS (
      SELECT 1
      FROM research_stage_runs failed_stage
      WHERE failed_stage.workspace_id = job.workspace_id
        AND failed_stage.run_id = run.id
        AND failed_stage.stage = 'market_investigation'
        AND failed_stage.work_item_key = item.work_item_key
        AND failed_stage.status = 'failed'
        AND failed_stage.error_code = 'AGENT_EXECUTION_FAILED'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM research_stage_runs completed_stage
      WHERE completed_stage.workspace_id = job.workspace_id
        AND completed_stage.run_id = run.id
        AND completed_stage.stage = 'market_investigation'
        AND completed_stage.work_item_key = item.work_item_key
        AND completed_stage.status = 'completed'
    )
), restored_items AS (
  UPDATE research_work_items item
  SET status = 'pending',
      error_code = NULL,
      updated_at = now()
  FROM recoverable
  WHERE item.id = recoverable.work_item_id
  RETURNING item.id
), requeued AS (
  UPDATE jobs job
  SET status = 'pending',
      attempts = 0,
      available_at = now(),
      locked_at = NULL,
      locked_until = NULL,
      locked_by = NULL,
      completed_at = NULL,
      last_error_code = NULL,
      last_error_message = NULL,
      updated_at = now()
  FROM recoverable
  WHERE job.id = recoverable.job_id
  RETURNING job.id, job.workspace_id, job.payload
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
  requeued.workspace_id,
  'product_research_run',
  (requeued.payload ->> 'runId')::uuid,
  'ResearchWorkItemRecovered',
  jsonb_build_object(
    'type', 'ResearchWorkItemRecovered',
    'workspaceId', requeued.workspace_id,
    'runId', requeued.payload ->> 'runId',
    'stage', 'market_investigation',
    'workItemKey', requeued.payload ->> 'workItemKey',
    'reason', 'STRUCTURED_OUTPUT_RECOVERY_DEPLOYED'
  ),
  now(),
  now()
FROM requeued;
