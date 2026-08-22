UPDATE "campaign_prospects" AS prospect
SET
  "status" = 'enrolled',
  "enrolled_at" = COALESCE(prospect."enrolled_at", enrollment."enrolled_at"),
  "updated_at" = GREATEST(prospect."updated_at", enrollment."enrolled_at")
FROM "campaign_enrollments" AS enrollment
WHERE enrollment."workspace_id" = prospect."workspace_id"
  AND enrollment."campaign_id" = prospect."campaign_id"
  AND enrollment."contact_id" = prospect."contact_id"
  AND enrollment."status" = 'active'
  AND prospect."status" <> 'excluded'
  AND (
    prospect."status" <> 'enrolled'
    OR prospect."enrolled_at" IS NULL
  );
