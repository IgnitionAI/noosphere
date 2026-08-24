CREATE TABLE "content_publication_reconciliations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "publication_id" uuid NOT NULL,
  "status" varchar(40) DEFAULT 'pending' NOT NULL,
  "criteria_snapshot" jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 18 NOT NULL,
  "lease_token" uuid,
  "locked_until" timestamp with time zone,
  "next_attempt_at" timestamp with time zone,
  "candidates_count" integer DEFAULT 0 NOT NULL,
  "matched_provider_post_id" text,
  "matched_provider_social_id" text,
  "matched_provider_url" text,
  "matched_published_at" timestamp with time zone,
  "last_error_code" varchar(160),
  "last_error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_publication_reconciliations_workspace_id_uq" UNIQUE("workspace_id", "id"),
  CONSTRAINT "content_publication_reconciliations_status_ck" CHECK ("status" in ('pending', 'searching', 'matched', 'not_found', 'ambiguous', 'error')),
  CONSTRAINT "content_publication_reconciliations_attempts_ck" CHECK ("attempts" >= 0 and "max_attempts" > 0 and "attempts" <= "max_attempts"),
  CONSTRAINT "content_publication_reconciliations_candidates_ck" CHECK ("candidates_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "content_publication_reconciliations" ADD CONSTRAINT "content_publication_reconciliations_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "content_publication_reconciliations" ADD CONSTRAINT "content_publication_reconciliations_workspace_publication_fk" FOREIGN KEY ("workspace_id", "publication_id") REFERENCES "public"."content_publications"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "content_publication_reconciliations_publication_uq" ON "content_publication_reconciliations" USING btree ("workspace_id", "publication_id");
--> statement-breakpoint
CREATE INDEX "content_publication_reconciliations_due_idx" ON "content_publication_reconciliations" USING btree ("status", "next_attempt_at");
