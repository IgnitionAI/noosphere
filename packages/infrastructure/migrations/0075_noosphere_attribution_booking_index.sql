CREATE INDEX "attribution_touches_booking_idx"
  ON "attribution_touches" (
    "workspace_id",
    "booking_id",
    "status",
    "kind",
    "occurred_at",
    "social_interaction_id"
  );
