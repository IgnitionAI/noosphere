CREATE OR REPLACE FUNCTION "public"."reject_icp_version_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ICP_VERSION_IMMUTABLE'; END; $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "icp_versions_immutable_trg" ON "icp_versions";--> statement-breakpoint
CREATE TRIGGER "icp_versions_immutable_trg" BEFORE UPDATE OR DELETE ON "icp_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_icp_version_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."reject_offer_version_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'OFFER_VERSION_IMMUTABLE'; END; $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "offer_versions_immutable_trg" ON "offer_versions";--> statement-breakpoint
CREATE TRIGGER "offer_versions_immutable_trg" BEFORE UPDATE OR DELETE ON "offer_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_offer_version_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."reject_offer_claim_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'OFFER_CLAIM_IMMUTABLE'; END; $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "offer_claims_immutable_trg" ON "offer_claims";--> statement-breakpoint
CREATE TRIGGER "offer_claims_immutable_trg" BEFORE UPDATE OR DELETE ON "offer_claims"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_offer_claim_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."reject_audit_log_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE'; END; $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_logs_immutable_trg" ON "audit_logs";--> statement-breakpoint
CREATE TRIGGER "audit_logs_immutable_trg" BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_audit_log_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."reject_messaging_strategy_version_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'MESSAGING_STRATEGY_VERSION_IMMUTABLE'; END; $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "messaging_strategy_versions_immutable_trg" ON "messaging_strategy_versions";--> statement-breakpoint
CREATE TRIGGER "messaging_strategy_versions_immutable_trg" BEFORE UPDATE OR DELETE ON "messaging_strategy_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_messaging_strategy_version_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."reject_ai_policy_version_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AI_POLICY_VERSION_IMMUTABLE'; END; $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "ai_policy_versions_immutable_trg" ON "ai_policy_versions";--> statement-breakpoint
CREATE TRIGGER "ai_policy_versions_immutable_trg" BEFORE UPDATE OR DELETE ON "ai_policy_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_ai_policy_version_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."reject_sequence_version_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SEQUENCE_VERSION_IMMUTABLE'; END; $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "sequence_versions_immutable_trg" ON "sequence_versions";--> statement-breakpoint
CREATE TRIGGER "sequence_versions_immutable_trg" BEFORE UPDATE OR DELETE ON "sequence_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_sequence_version_mutation"();
