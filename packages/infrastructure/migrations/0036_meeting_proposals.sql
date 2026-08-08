CREATE TABLE "meeting_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"campaign_id" uuid,
	"calendar_booking_id" uuid,
	"status" varchar(40) DEFAULT 'offered' NOT NULL,
	"time_zone" varchar(100) NOT NULL,
	"slots" jsonb NOT NULL,
	"selected_slot_start" timestamp with time zone,
	"idempotency_key" varchar(500) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_proposals" ADD CONSTRAINT "meeting_proposals_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_proposals" ADD CONSTRAINT "meeting_proposals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_proposals" ADD CONSTRAINT "meeting_proposals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_proposals" ADD CONSTRAINT "meeting_proposals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_proposals" ADD CONSTRAINT "meeting_proposals_calendar_booking_id_calendar_bookings_id_fk" FOREIGN KEY ("calendar_booking_id") REFERENCES "public"."calendar_bookings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_proposals_idempotency_uq" ON "meeting_proposals" USING btree ("workspace_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_proposals_active_conversation_uq" ON "meeting_proposals" USING btree ("workspace_id","conversation_id") WHERE "meeting_proposals"."status" = 'offered';
--> statement-breakpoint
CREATE INDEX "meeting_proposals_conversation_idx" ON "meeting_proposals" USING btree ("workspace_id","conversation_id","created_at");
