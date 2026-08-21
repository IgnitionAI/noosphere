CREATE INDEX "attribution_touches_contact_identity_idx"
  ON "attribution_touches" (
    "workspace_id",
    "contact_id",
    "occurred_at",
    "social_interaction_id"
  )
  WHERE "status" = 'active'
    AND "kind" = 'identity'
    AND "contact_id" IS NOT NULL;
