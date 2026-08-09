CREATE TABLE IF NOT EXISTS "workspace_signal_settings" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "signal_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_signal_settings_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "workspace_signal_settings_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."auth_users"("id")
);
