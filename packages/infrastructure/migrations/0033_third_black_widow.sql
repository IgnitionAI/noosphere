CREATE TABLE "opportunity_stage_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage" varchar(80),
	"to_stage" varchar(80) NOT NULL,
	"source" varchar(80) NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_opportunity_fk" FOREIGN KEY ("workspace_id","opportunity_id") REFERENCES "public"."opportunities"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_stage_history_timeline_idx" ON "opportunity_stage_history" USING btree ("workspace_id","opportunity_id","created_at");--> statement-breakpoint
INSERT INTO "opportunity_stage_history" (
	"id", "workspace_id", "opportunity_id", "from_stage", "to_stage", "source", "reason", "created_at"
)
SELECT
	gen_random_uuid(), "workspace_id", "id", NULL, "stage", 'backfill',
	'Initialisation de l historique depuis l etat courant.', "created_at"
FROM "opportunities";
