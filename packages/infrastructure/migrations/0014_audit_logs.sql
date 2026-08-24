CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "action" varchar(160) NOT NULL,
  "subject_type" varchar(120) NOT NULL,
  "subject_id" uuid NOT NULL,
  "changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "correlation_id" varchar(200),
  "source_event_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audit_logs_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "audit_logs_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_logs_source_event_uq" ON "audit_logs" USING btree ("source_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_workspace_created_idx" ON "audit_logs" USING btree ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_subject_idx" ON "audit_logs" USING btree ("workspace_id", "subject_type", "subject_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_audit_log_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_logs_immutable_trg" ON "audit_logs";
--> statement-breakpoint
CREATE TRIGGER "audit_logs_immutable_trg"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_audit_log_mutation"();
