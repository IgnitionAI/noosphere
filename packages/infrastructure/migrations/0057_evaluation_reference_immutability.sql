CREATE OR REPLACE FUNCTION prevent_evaluation_reference_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EVALUATION_REFERENCE_IMMUTABLE' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "evaluation_datasets_immutable_trg" ON "evaluation_datasets";--> statement-breakpoint
CREATE TRIGGER "evaluation_datasets_immutable_trg" BEFORE UPDATE ON "evaluation_datasets" FOR EACH ROW EXECUTE FUNCTION prevent_evaluation_reference_mutation();--> statement-breakpoint
DROP TRIGGER IF EXISTS "evaluation_cases_immutable_trg" ON "evaluation_cases";--> statement-breakpoint
CREATE TRIGGER "evaluation_cases_immutable_trg" BEFORE UPDATE ON "evaluation_cases" FOR EACH ROW EXECUTE FUNCTION prevent_evaluation_reference_mutation();
