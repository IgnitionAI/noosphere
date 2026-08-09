CREATE OR REPLACE FUNCTION "public"."reject_audit_log_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE';
END;
$$;
