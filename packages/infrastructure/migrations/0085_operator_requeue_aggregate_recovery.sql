WITH recoverable AS MATERIALIZED (
  SELECT DISTINCT ON (action.id)
    action.id,
    action.workspace_id,
    action.campaign_id,
    action.enrollment_id,
    action.contact_id
  FROM jobs job
  INNER JOIN outreach_actions action
    ON action.workspace_id = job.workspace_id
   AND action.id::text = job.payload ->> 'actionId'
  INNER JOIN campaigns campaign
    ON campaign.workspace_id = action.workspace_id
   AND campaign.id = action.campaign_id
   AND campaign.status = 'active'
  INNER JOIN audit_logs requeue_audit
    ON requeue_audit.workspace_id = job.workspace_id
   AND requeue_audit.subject_type = 'job'
   AND requeue_audit.subject_id = job.id
   AND requeue_audit.action = 'JobRequeued'
   AND requeue_audit.changes ->> 'previousErrorCode' = 'CAMPAIGN_JIT_GENERATION_FAILED'
  WHERE job.type = 'outreach.dispatch'
    AND job.status = 'pending'
    AND action.status = 'failed'
    AND action.last_error_code = 'CAMPAIGN_JIT_GENERATION_FAILED'
    AND NOT EXISTS (
      SELECT 1
      FROM outreach_attempts attempt
      WHERE attempt.workspace_id = action.workspace_id
        AND (attempt.action_id = action.id OR attempt.outreach_action_id = action.id)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM campaign_enrollments competing
      WHERE competing.workspace_id = action.workspace_id
        AND competing.contact_id = action.contact_id
        AND competing.id <> action.enrollment_id
        AND competing.status = 'active'
    )
  ORDER BY action.id, requeue_audit.created_at DESC
), restored_actions AS (
  UPDATE outreach_actions action
  SET status = 'scheduled',
      due_at = now(),
      locked_at = NULL,
      locked_until = NULL,
      locked_by = NULL,
      last_error_code = NULL,
      last_error_message = NULL,
      updated_at = now()
  FROM recoverable
  WHERE action.workspace_id = recoverable.workspace_id
    AND action.id = recoverable.id
    AND action.status = 'failed'
    AND action.last_error_code = 'CAMPAIGN_JIT_GENERATION_FAILED'
  RETURNING action.id, action.workspace_id, action.campaign_id, action.enrollment_id, action.contact_id
), restored_enrollments AS (
  UPDATE campaign_enrollments enrollment
  SET status = 'active',
      completed_at = NULL
  FROM restored_actions
  WHERE enrollment.workspace_id = restored_actions.workspace_id
    AND enrollment.id = restored_actions.enrollment_id
  RETURNING enrollment.id
), restored_campaigns AS (
  UPDATE campaigns campaign
  SET automation_stage = 'sending',
      automation_error_code = NULL,
      automation_error_message = NULL,
      updated_at = now()
  FROM restored_actions
  WHERE campaign.workspace_id = restored_actions.workspace_id
    AND campaign.id = restored_actions.campaign_id
    AND campaign.status = 'active'
  RETURNING campaign.id
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
  restored_actions.workspace_id,
  'OutreachAction',
  restored_actions.id,
  'OperatorRequeueAggregateRecovered',
  jsonb_build_object(
    'actionId', restored_actions.id,
    'campaignId', restored_actions.campaign_id,
    'contactId', restored_actions.contact_id,
    'reason', 'CAMPAIGN_JIT_GENERATION_FAILED'
  ),
  now(),
  now()
FROM restored_actions;
