CREATE TABLE "research_tool_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"tool_name" varchar(120) NOT NULL,
	"normalized_input_hash" varchar(128) NOT NULL,
	"normalized_input" jsonb NOT NULL,
	"status" varchar(30) NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"output" text,
	"content_hash" varchar(128),
	"retryable" boolean DEFAULT true NOT NULL,
	"last_error_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_tool_requests" ADD CONSTRAINT "research_tool_requests_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."product_research_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_tool_requests_input_uq" ON "research_tool_requests" USING btree ("workspace_id","run_id","tool_name","normalized_input_hash");--> statement-breakpoint
CREATE INDEX "research_tool_requests_lease_idx" ON "research_tool_requests" USING btree ("status","lease_expires_at");