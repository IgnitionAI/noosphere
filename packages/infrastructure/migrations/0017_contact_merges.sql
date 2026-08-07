ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "merged_into_id" uuid,
  ADD COLUMN IF NOT EXISTS "merged_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "contacts" ADD CONSTRAINT "contacts_merged_into_fk"
    FOREIGN KEY ("merged_into_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merge_candidates" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "primary_contact_id" uuid NOT NULL,
  "secondary_contact_id" uuid NOT NULL,
  "pair_key" varchar(80) NOT NULL,
  "match_type" varchar(30) NOT NULL,
  "signals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(30) NOT NULL DEFAULT 'pending',
  "decision_reason" text,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "merge_candidates_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "merge_candidates_primary_fk" FOREIGN KEY ("workspace_id", "primary_contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "merge_candidates_secondary_fk" FOREIGN KEY ("workspace_id", "secondary_contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "merge_candidates_decided_by_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."auth_users"("id") ON DELETE SET NULL,
  CONSTRAINT "merge_candidates_workspace_pair_uq" UNIQUE ("workspace_id", "pair_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merge_candidates_workspace_status_idx" ON "merge_candidates" USING btree ("workspace_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_merges" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "survivor_contact_id" uuid NOT NULL,
  "merged_contact_id" uuid NOT NULL,
  "candidate_id" uuid,
  "snapshot" jsonb NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "merged_by" uuid,
  "merged_at" timestamp with time zone NOT NULL DEFAULT now(),
  "undone_by" uuid,
  "undone_at" timestamp with time zone,
  CONSTRAINT "contact_merges_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "contact_merges_survivor_fk" FOREIGN KEY ("workspace_id", "survivor_contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "contact_merges_merged_fk" FOREIGN KEY ("workspace_id", "merged_contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "contact_merges_candidate_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."merge_candidates"("id") ON DELETE SET NULL,
  CONSTRAINT "contact_merges_merged_by_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."auth_users"("id") ON DELETE SET NULL,
  CONSTRAINT "contact_merges_undone_by_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."auth_users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_merges_workspace_history_idx" ON "contact_merges" USING btree ("workspace_id", "merged_at");
