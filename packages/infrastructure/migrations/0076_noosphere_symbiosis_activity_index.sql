CREATE INDEX "social_interactions_workspace_activity_idx"
  ON "social_interactions" (
    "workspace_id",
    "status",
    "last_seen_at",
    "id"
  );
