CREATE TABLE "research_work_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" "research_stage" NOT NULL,
	"work_item_key" varchar(160) NOT NULL,
	"subject_artifact_key" varchar(160) NOT NULL,
	"ordinal" integer NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"error_code" varchar(120),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "research_stage_runs_attempt_uq";--> statement-breakpoint
ALTER TABLE "research_stage_runs" ADD COLUMN "work_item_key" varchar(160) DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "research_work_items" ADD CONSTRAINT "research_work_items_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_work_items_key_uq" ON "research_work_items" USING btree ("workspace_id","run_id","stage","work_item_key");--> statement-breakpoint
CREATE INDEX "research_work_items_join_idx" ON "research_work_items" USING btree ("workspace_id","run_id","stage","status");--> statement-breakpoint
CREATE UNIQUE INDEX "research_stage_runs_attempt_uq" ON "research_stage_runs" USING btree ("workspace_id","run_id","stage","work_item_key","attempt");