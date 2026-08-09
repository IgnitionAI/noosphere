ALTER TABLE "calendar_bookings" DROP CONSTRAINT IF EXISTS "calendar_bookings_opportunity_fk";--> statement-breakpoint
ALTER TABLE "calendar_bookings" ADD CONSTRAINT "calendar_bookings_opportunity_fk" FOREIGN KEY ("workspace_id","opportunity_id") REFERENCES "public"."opportunities"("workspace_id","id") ON DELETE SET NULL ("opportunity_id");
