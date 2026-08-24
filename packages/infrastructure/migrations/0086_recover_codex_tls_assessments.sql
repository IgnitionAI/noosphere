WITH recoverable AS MATERIALIZED (
  SELECT
    job.id AS job_id,
    job.workspace_id,
    assessment.id AS assessment_id,
    assessment.plan_id
  FROM jobs job
  INNER JOIN channel_assessments assessment
    ON assessment.workspace_id = job.workspace_id
   AND assessment.id::text = job.payload ->> 'assessmentId'
  WHERE job.type = 'prospecting.channel.assess'
    AND job.status = 'dead_lettered'
    AND job.last_error_code = 'CHANNEL_ASSESSMENT_FAILED'
    AND job.last_error_message = 'Codex CLI exited without a valid response'
    AND assessment.status = 'failed'
    AND assessment.error_code = 'CHANNEL_ASSESSMENT_FAILED'
    AND assessment.error_message = 'Codex CLI exited without a valid response'
), restored_assessments AS (
  UPDATE channel_assessments assessment
  SET status = 'pending',
      recommendation = NULL,
      score = NULL,
      strategy = '{}'::jsonb,
      metrics = '{}'::jsonb,
      evidence = '[]'::jsonb,
      rationale = NULL,
      sample_size = 0,
      error_code = NULL,
      error_message = NULL,
      started_at = NULL,
      completed_at = NULL,
      updated_at = now()
  FROM recoverable
  WHERE assessment.workspace_id = recoverable.workspace_id
    AND assessment.id = recoverable.assessment_id
    AND assessment.status = 'failed'
  RETURNING assessment.id, assessment.workspace_id, assessment.plan_id
), restored_plans AS (
  UPDATE prospecting_plans plan
  SET status = 'assessing',
      updated_at = now()
  FROM restored_assessments assessment
  WHERE plan.workspace_id = assessment.workspace_id
    AND plan.id = assessment.plan_id
  RETURNING plan.id
), restored_jobs AS (
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
  FROM restored_assessments assessment
  WHERE job.workspace_id = assessment.workspace_id
    AND job.id IN (
      SELECT recoverable.job_id
      FROM recoverable
      WHERE recoverable.workspace_id = assessment.workspace_id
        AND recoverable.assessment_id = assessment.id
    )
    AND job.status = 'dead_lettered'
  RETURNING job.id, job.workspace_id, assessment.id AS assessment_id
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
  restored_jobs.workspace_id,
  'ChannelAssessment',
  restored_jobs.assessment_id,
  'ChannelAssessmentInfrastructureRecovered',
  jsonb_build_object(
    'assessmentId', restored_jobs.assessment_id,
    'jobId', restored_jobs.id,
    'reason', 'CODEX_TLS_TRUST_STORE_FIXED'
  ),
  now(),
  now()
FROM restored_jobs;
