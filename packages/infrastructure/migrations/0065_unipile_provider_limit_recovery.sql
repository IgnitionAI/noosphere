INSERT INTO "jobs" (
  "id", "workspace_id", "type", "payload", "idempotency_key", "correlation_id",
  "status", "attempts", "max_attempts", "priority", "available_at", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  action."workspace_id",
  'outreach.dispatch',
  jsonb_build_object('workspaceId', action."workspace_id", 'actionId', action."id"),
  action."id"::text || ':dispatch:provider-limit-recovery:v1',
  action."id"::text,
  'pending',
  0,
  90,
  0,
  now() + interval '8 hours',
  now(),
  now()
FROM "outreach_actions" action
WHERE action."provider" = 'unipile'
  AND action."status" = 'failed'
  AND action."last_error_code" = 'UNIPILE_422'
  AND action."last_error_message" ~* '(limit_exceeded|usage limit set by the provider|provider.*limit)'
ON CONFLICT ("workspace_id", "type", "idempotency_key") DO NOTHING;
--> statement-breakpoint
UPDATE "campaign_enrollments" enrollment
SET "status" = 'active', "completed_at" = NULL
FROM "outreach_actions" action
WHERE action."workspace_id" = enrollment."workspace_id"
  AND action."enrollment_id" = enrollment."id"
  AND action."provider" = 'unipile'
  AND action."status" = 'failed'
  AND action."last_error_code" = 'UNIPILE_422'
  AND action."last_error_message" ~* '(limit_exceeded|usage limit set by the provider|provider.*limit)';
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
  AND action."status" = 'failed'
  AND action."last_error_code" = 'UNIPILE_422'
  AND action."last_error_message" ~* '(limit_exceeded|usage limit set by the provider|provider.*limit)';
--> statement-breakpoint
UPDATE "outreach_actions"
SET
  "status" = 'scheduled',
  "due_at" = now() + interval '8 hours',
  "locked_at" = NULL,
  "locked_until" = NULL,
  "locked_by" = NULL,
  "last_error_code" = 'UNIPILE_PROVIDER_LIMIT',
  "last_error_message" = 'The provider usage limit will be checked again automatically',
  "updated_at" = now()
WHERE "provider" = 'unipile'
  AND "status" = 'failed'
  AND "last_error_code" = 'UNIPILE_422'
  AND "last_error_message" ~* '(limit_exceeded|usage limit set by the provider|provider.*limit)';
