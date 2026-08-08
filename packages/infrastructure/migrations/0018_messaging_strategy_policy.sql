CREATE TABLE IF NOT EXISTS "messaging_strategies" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" varchar(500) NOT NULL,
  "current_version" integer DEFAULT 0 NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "messaging_strategies_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "messaging_strategies_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action,
  CONSTRAINT "messaging_strategies_workspace_id_uq" UNIQUE("workspace_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_strategies_workspace_name_uq" ON "messaging_strategies" USING btree ("workspace_id", lower("name")) WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging_strategy_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "strategy_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "published_by" uuid,
  "published_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "messaging_strategy_versions_workspace_strategy_fk" FOREIGN KEY ("workspace_id", "strategy_id") REFERENCES "public"."messaging_strategies"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "messaging_strategy_versions_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."auth_users"("id") ON DELETE no action,
  CONSTRAINT "messaging_strategy_versions_workspace_id_uq" UNIQUE("workspace_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_strategy_versions_strategy_version_uq" ON "messaging_strategy_versions" USING btree ("workspace_id", "strategy_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_strategy_versions_workspace_idx" ON "messaging_strategy_versions" USING btree ("workspace_id", "published_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_policies" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" varchar(500) NOT NULL,
  "current_version" integer DEFAULT 0 NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_policies_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "ai_policies_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action,
  CONSTRAINT "ai_policies_workspace_id_uq" UNIQUE("workspace_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_policies_workspace_name_uq" ON "ai_policies" USING btree ("workspace_id", lower("name")) WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_policy_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "policy_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "published_by" uuid,
  "published_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_policy_versions_workspace_policy_fk" FOREIGN KEY ("workspace_id", "policy_id") REFERENCES "public"."ai_policies"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "ai_policy_versions_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."auth_users"("id") ON DELETE no action,
  CONSTRAINT "ai_policy_versions_workspace_id_uq" UNIQUE("workspace_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_policy_versions_policy_version_uq" ON "ai_policy_versions" USING btree ("workspace_id", "policy_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_policy_versions_workspace_idx" ON "ai_policy_versions" USING btree ("workspace_id", "published_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_messaging_strategy_version_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'MESSAGING_STRATEGY_VERSION_IMMUTABLE';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "messaging_strategy_versions_immutable_trg" ON "messaging_strategy_versions";
--> statement-breakpoint
CREATE TRIGGER "messaging_strategy_versions_immutable_trg"
BEFORE UPDATE OR DELETE ON "messaging_strategy_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_messaging_strategy_version_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_ai_policy_version_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI_POLICY_VERSION_IMMUTABLE';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ai_policy_versions_immutable_trg" ON "ai_policy_versions";
--> statement-breakpoint
CREATE TRIGGER "ai_policy_versions_immutable_trg"
BEFORE UPDATE OR DELETE ON "ai_policy_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_ai_policy_version_mutation"();
