CREATE OR REPLACE FUNCTION "public"."reject_editorial_strategy_version_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'EDITORIAL_STRATEGY_VERSION_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS "editorial_strategy_versions_immutable_trg" ON "editorial_strategy_versions";

CREATE TRIGGER "editorial_strategy_versions_immutable_trg"
BEFORE UPDATE OR DELETE ON "editorial_strategy_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_editorial_strategy_version_mutation"();
