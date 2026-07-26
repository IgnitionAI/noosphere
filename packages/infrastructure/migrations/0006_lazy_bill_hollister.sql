CREATE TABLE "icp_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(500) NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"criteria" jsonb NOT NULL,
	"buying_committee" jsonb NOT NULL,
	"problems" jsonb NOT NULL,
	"signals" jsonb NOT NULL,
	"exclusions" jsonb NOT NULL,
	"unknowns" jsonb NOT NULL,
	"unresolved_contradictions" jsonb NOT NULL,
	"blocked_findings" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_published_by_auth_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "icp_versions_proposal_uq" ON "icp_versions" USING btree ("workspace_id","proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "icp_versions_workspace_version_uq" ON "icp_versions" USING btree ("workspace_id","version");--> statement-breakpoint
CREATE INDEX "icp_versions_workspace_idx" ON "icp_versions" USING btree ("workspace_id","published_at");