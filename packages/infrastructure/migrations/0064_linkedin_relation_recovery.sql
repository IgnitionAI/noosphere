INSERT INTO "jobs" (
  "id", "workspace_id", "type", "payload", "idempotency_key", "correlation_id",
  "status", "attempts", "max_attempts", "priority", "available_at", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  action."workspace_id",
  'outreach.dispatch',
  jsonb_build_object('workspaceId', action."workspace_id", 'actionId', action."id"),
  action."id"::text || ':dispatch:relationship-recovery:v1',
  action."id"::text,
  'pending',
  0,
  90,
  0,
  now(),
  now(),
  now()
FROM "outreach_actions" action
WHERE action."provider" = 'unipile'
  AND action."channel" = 'linkedin'
  AND action."step_kind" = 'linkedin_message'
  AND action."status" = 'failed'
  AND action."last_error_code" = 'UNIPILE_422'
  AND action."last_error_message" ~* '(no_connection_with_recipient|first degree connection)'
ON CONFLICT ("workspace_id", "type", "idempotency_key") DO NOTHING;
--> statement-breakpoint
UPDATE "campaign_enrollments" enrollment
SET "status" = 'active', "completed_at" = NULL
FROM "outreach_actions" action
WHERE action."workspace_id" = enrollment."workspace_id"
  AND action."enrollment_id" = enrollment."id"
  AND action."provider" = 'unipile'
  AND action."channel" = 'linkedin'
  AND action."step_kind" = 'linkedin_message'
  AND action."status" = 'failed'
  AND action."last_error_code" = 'UNIPILE_422'
  AND action."last_error_message" ~* '(no_connection_with_recipient|first degree connection)';
--> statement-breakpoint
UPDATE "campaigns" campaign
SET
  "status" = 'active',
  "automation_stage" = 'sending',
  "automation_error_code" = NULL,
  "automation_error_message" = NULL,
  "updated_at" = now()
FROM "outreach_actions" action
WHERE action."workspace_id" = campaign."workspace_id"
  AND action."campaign_id" = campaign."id"
  AND action."provider" = 'unipile'
  AND action."channel" = 'linkedin'
  AND action."step_kind" = 'linkedin_message'
  AND action."status" = 'failed'
  AND action."last_error_code" = 'UNIPILE_422'
  AND action."last_error_message" ~* '(no_connection_with_recipient|first degree connection)';
--> statement-breakpoint
UPDATE "outreach_actions"
SET
  "status" = 'scheduled',
  "due_at" = now(),
  "locked_at" = NULL,
  "locked_until" = NULL,
  "locked_by" = NULL,
  "last_error_code" = 'LINKEDIN_RELATION_PENDING',
  "last_error_message" = 'The LinkedIn invitation has not been accepted yet',
  "updated_at" = now()
WHERE "provider" = 'unipile'
  AND "channel" = 'linkedin'
  AND "step_kind" = 'linkedin_message'
  AND "status" = 'failed'
  AND "last_error_code" = 'UNIPILE_422'
  AND "last_error_message" ~* '(no_connection_with_recipient|first degree connection)';
