CREATE TABLE "workspace_ai_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"research_models" jsonb NOT NULL,
	"synthesis_models" jsonb NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_ai_settings" ADD CONSTRAINT "workspace_ai_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ai_settings" ADD CONSTRAINT "workspace_ai_settings_updated_by_auth_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;