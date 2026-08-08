ALTER TABLE "calendar_connections" ADD COLUMN "api_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "event_type_id" integer;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "event_type_slug" varchar(200);--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "event_type_title" varchar(300);--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "username" varchar(200);--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "time_zone" varchar(100);--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "webhook_id" varchar(200);--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "last_error_code" varchar(120);
