ALTER TABLE "icp_proposals" ADD COLUMN "review_status" varchar(40) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "icp_proposals" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "icp_proposals" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "icp_proposals" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "icp_proposals" ADD CONSTRAINT "icp_proposals_reviewed_by_auth_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;