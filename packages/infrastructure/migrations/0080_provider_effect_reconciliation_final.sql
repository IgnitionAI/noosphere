CREATE OR REPLACE FUNCTION "public"."protect_completed_publication_reconciliation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."completed_at" IS NOT NULL THEN
    RAISE EXCEPTION 'CONTENT_PUBLICATION_RECONCILIATION_FINAL';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "content_publication_reconciliations_final_trg"
BEFORE UPDATE ON "content_publication_reconciliations"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_completed_publication_reconciliation"();
