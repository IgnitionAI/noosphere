CREATE TABLE "editorial_learning_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE cascade,
  "strategy_id" uuid NOT NULL,
  "strategy_version_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "facts" jsonb NOT NULL,
  "inferences" jsonb NOT NULL,
  "recommendations" jsonb NOT NULL,
  "bounds" jsonb NOT NULL,
  "model_version" varchar(120) NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "window_ended_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "editorial_learning_versions_workspace_strategy_fk" FOREIGN KEY ("workspace_id", "strategy_id") REFERENCES "editorial_strategies" ("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "editorial_learning_versions_workspace_strategy_version_fk" FOREIGN KEY ("workspace_id", "strategy_version_id") REFERENCES "editorial_strategy_versions" ("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "editorial_learning_versions_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "editorial_learning_versions_window_ck" CHECK ("window_ended_at" >= "window_started_at")
);

CREATE UNIQUE INDEX "editorial_learning_versions_strategy_version_uq" ON "editorial_learning_versions" ("workspace_id", "strategy_id", "version");
CREATE UNIQUE INDEX "editorial_learning_versions_input_uq" ON "editorial_learning_versions" ("workspace_id", "strategy_version_id", "input_hash");
CREATE INDEX "editorial_learning_versions_latest_idx" ON "editorial_learning_versions" ("workspace_id", "strategy_id", "version");

CREATE OR REPLACE FUNCTION "public"."reject_editorial_learning_version_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'EDITORIAL_LEARNING_VERSION_IMMUTABLE';
END;
$$;

CREATE TRIGGER "editorial_learning_versions_immutable_trg"
BEFORE UPDATE OR DELETE ON "editorial_learning_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_editorial_learning_version_mutation"();
