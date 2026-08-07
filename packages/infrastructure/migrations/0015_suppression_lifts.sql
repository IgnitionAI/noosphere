ALTER TABLE "contact_suppressions"
  ADD COLUMN IF NOT EXISTS "lifted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "lifted_by" uuid,
  ADD COLUMN IF NOT EXISTS "lift_justification" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "contact_suppressions"
    ADD CONSTRAINT "contact_suppressions_lifted_by_fk"
    FOREIGN KEY ("lifted_by") REFERENCES "public"."auth_users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "contact_suppressions_fingerprint_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_suppressions_fingerprint_uq"
  ON "contact_suppressions" USING btree ("workspace_id", "identity_type", "normalized_value", "channel")
  WHERE "normalized_value" is not null;
