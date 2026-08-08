INSERT INTO "opportunity_stage_history" (
	"id", "workspace_id", "opportunity_id", "from_stage", "to_stage", "source", "reason", "created_at"
)
SELECT
	gen_random_uuid(), o."workspace_id", o."id", NULL, o."stage", 'backfill',
	'Initialisation de l historique depuis l etat courant.', o."created_at"
FROM "opportunities" o
WHERE NOT EXISTS (
	SELECT 1
	FROM "opportunity_stage_history" h
	WHERE h."workspace_id" = o."workspace_id"
	  AND h."opportunity_id" = o."id"
);
