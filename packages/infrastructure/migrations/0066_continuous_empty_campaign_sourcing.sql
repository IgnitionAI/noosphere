UPDATE "campaigns"
SET
  "automation_stage" = 'sourcing',
  "automation_error_code" = NULL,
  "automation_error_message" = NULL,
  "updated_at" = now()
WHERE "status" = 'draft'
  AND "prospect_count" = 0
  AND "automation_stage" = 'attention'
  AND "automation_error_code" = 'NO_PROSPECTS_FOUND';
