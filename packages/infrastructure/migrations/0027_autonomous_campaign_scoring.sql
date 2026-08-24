ALTER TABLE "campaign_prospects" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "score_version" varchar(80);--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "score_explanation" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD COLUMN "exclusion_reason" varchar(160);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "automation_stage" varchar(40) DEFAULT 'sourcing' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "automation_error_code" varchar(120);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "automation_error_message" text;