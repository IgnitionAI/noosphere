CREATE OR REPLACE FUNCTION "public"."reject_sequence_version_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SEQUENCE_VERSION_IMMUTABLE';
END;
$$;
--> statement-breakpoint
ALTER TABLE "sequence_versions"
  DROP CONSTRAINT IF EXISTS "sequence_versions_sequence_id_sequences_id_fk";
--> statement-breakpoint
ALTER TABLE "sequence_versions"
  ADD CONSTRAINT "sequence_versions_sequence_id_sequences_id_fk"
  FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sequence_versions_immutable_trg" ON "sequence_versions";
--> statement-breakpoint
CREATE TRIGGER "sequence_versions_immutable_trg"
BEFORE UPDATE OR DELETE ON "sequence_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_sequence_version_mutation"();
