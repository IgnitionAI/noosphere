CREATE TABLE "calendar_meeting_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_event_type_id" integer NOT NULL,
	"slug" varchar(200) NOT NULL,
	"title" varchar(300) NOT NULL,
	"length_minutes" integer NOT NULL,
	"booking_url" varchar(2000) NOT NULL,
	"time_zone" varchar(100) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_meeting_types_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD COLUMN "meeting_type_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD COLUMN "opportunity_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD COLUMN "attendee_time_zone" varchar(100);--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD COLUMN "organizer_time_zone" varchar(100);--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD COLUMN "no_show_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD COLUMN "reschedule_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD CONSTRAINT "calendar_bookings_workspace_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
CREATE TABLE "calendar_booking_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"action" varchar(40) NOT NULL,
	"idempotency_key" varchar(500) NOT NULL,
	"from_status" varchar(40),
	"to_status" varchar(40) NOT NULL,
	"previous_provider_booking_id" varchar(500),
	"new_provider_booking_id" varchar(500),
	"previous_start_at" timestamp with time zone,
	"new_start_at" timestamp with time zone,
	"reason" text,
	"actor_user_id" uuid,
	"source" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_meeting_types" ADD CONSTRAINT "calendar_meeting_types_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."calendar_connections"("workspace_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD CONSTRAINT "calendar_bookings_meeting_type_fk" FOREIGN KEY ("workspace_id","meeting_type_id") REFERENCES "public"."calendar_meeting_types"("workspace_id","id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD CONSTRAINT "calendar_bookings_opportunity_fk" FOREIGN KEY ("workspace_id","opportunity_id") REFERENCES "public"."opportunities"("workspace_id","id") ON DELETE SET NULL ("opportunity_id");--> statement-breakpoint
ALTER TABLE "calendar_booking_history" ADD CONSTRAINT "calendar_booking_history_booking_fk" FOREIGN KEY ("workspace_id","booking_id") REFERENCES "public"."calendar_bookings"("workspace_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "calendar_booking_history" ADD CONSTRAINT "calendar_booking_history_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_meeting_types_provider_uq" ON "calendar_meeting_types" USING btree ("workspace_id","connection_id","provider_event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_meeting_types_default_uq" ON "calendar_meeting_types" USING btree ("workspace_id","connection_id") WHERE "is_default" = true and "active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_booking_history_idempotency_uq" ON "calendar_booking_history" USING btree ("workspace_id","booking_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "calendar_booking_history_timeline_idx" ON "calendar_booking_history" USING btree ("workspace_id","booking_id","created_at");--> statement-breakpoint
INSERT INTO "calendar_meeting_types" ("id", "workspace_id", "connection_id", "provider_event_type_id", "slug", "title", "length_minutes", "booking_url", "time_zone", "is_default", "active")
SELECT gen_random_uuid(), "workspace_id", "id", "event_type_id", COALESCE("event_type_slug", 'default'), COALESCE("event_type_title", 'Rendez-vous'), 30, "booking_url", COALESCE("time_zone", 'Europe/Paris'), true, true
FROM "calendar_connections"
WHERE "event_type_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "calendar_bookings" b
SET "meeting_type_id" = t."id", "organizer_time_zone" = t."time_zone"
FROM "calendar_meeting_types" t
WHERE b."workspace_id" = t."workspace_id" AND b."connection_id" = t."connection_id" AND t."is_default" = true;--> statement-breakpoint
UPDATE "calendar_bookings" b
SET "opportunity_id" = o."id"
FROM "opportunities" o
WHERE b."workspace_id" = o."workspace_id" AND b."contact_id" = o."contact_id" AND b."campaign_id" IS NOT DISTINCT FROM o."campaign_id";
