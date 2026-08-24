CREATE TYPE "public"."workspace_onboarding_step" AS ENUM('workspace', 'product', 'icp', 'sending_account', 'calendar', 'prerequisites', 'autopilot');--> statement-breakpoint
CREATE TYPE "public"."workspace_onboarding_status" AS ENUM('pending', 'completed', 'skipped');--> statement-breakpoint
CREATE TABLE "workspace_onboarding" (
	"workspace_id" uuid NOT NULL,
	"step" "workspace_onboarding_step" NOT NULL,
	"status" "workspace_onboarding_status" DEFAULT 'pending' NOT NULL,
	"actor_user_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_onboarding_workspace_id_step_pk" PRIMARY KEY("workspace_id","step")
);
--> statement-breakpoint
ALTER TABLE "workspace_onboarding" ADD CONSTRAINT "workspace_onboarding_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_onboarding" ADD CONSTRAINT "workspace_onboarding_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "workspace_onboarding_workspace_status_idx" ON "workspace_onboarding" USING btree ("workspace_id","status","updated_at");
