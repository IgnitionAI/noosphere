CREATE TABLE "calendar_bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_booking_id" varchar(500) NOT NULL,
	"contact_id" uuid,
	"campaign_id" uuid,
	"status" varchar(40) NOT NULL,
	"attendee_name" varchar(300),
	"attendee_email" varchar(320),
	"attendee_phone" varchar(80),
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"meeting_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"booking_url" varchar(2000) NOT NULL,
	"status" varchar(40) DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connections_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD CONSTRAINT "calendar_bookings_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."calendar_connections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD CONSTRAINT "calendar_bookings_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD CONSTRAINT "calendar_bookings_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_bookings_provider_uq" ON "calendar_bookings" USING btree ("workspace_id","connection_id","provider_booking_id");--> statement-breakpoint
CREATE INDEX "calendar_bookings_contact_idx" ON "calendar_bookings" USING btree ("workspace_id","contact_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_workspace_default_uq" ON "calendar_connections" USING btree ("workspace_id") WHERE "calendar_connections"."is_default" = true and "calendar_connections"."status" = 'active';
