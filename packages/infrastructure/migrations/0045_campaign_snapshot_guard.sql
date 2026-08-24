-- The canonical campaign migration predates the active migration journal and
-- was not replayed on databases assembled from the consolidated chain.
-- Keep the activation snapshot immutable after leaving draft.
CREATE OR REPLACE FUNCTION "public"."reject_campaign_snapshot_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.offer_version_id IS DISTINCT FROM OLD.offer_version_id OR
    NEW.icp_version_id IS DISTINCT FROM OLD.icp_version_id OR
    NEW.messaging_strategy_version_id IS DISTINCT FROM OLD.messaging_strategy_version_id OR
    NEW.ai_policy_version_id IS DISTINCT FROM OLD.ai_policy_version_id OR
    NEW.sequence_version_id IS DISTINCT FROM OLD.sequence_version_id
  ) THEN
    RAISE EXCEPTION 'CAMPAIGN_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "campaign_snapshot_immutable_trg" ON "campaigns";--> statement-breakpoint
CREATE TRIGGER "campaign_snapshot_immutable_trg"
BEFORE UPDATE ON "campaigns"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_campaign_snapshot_mutation"();
