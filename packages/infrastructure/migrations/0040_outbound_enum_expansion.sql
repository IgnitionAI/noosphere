ALTER TYPE "public"."crm_source" ADD VALUE 'discovery' BEFORE 'provider';--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."outreach_action_status" RENAME TO "outreach_action_status_before_merge";--> statement-breakpoint
CREATE TYPE "public"."outreach_action_status" AS ENUM('planned', 'awaiting_approval', 'due', 'sending', 'scheduled', 'executing', 'sent', 'failed', 'skipped', 'cancelled', 'suspended');--> statement-breakpoint
ALTER TABLE "outreach_actions" ALTER COLUMN "status" TYPE "public"."outreach_action_status" USING "status"::text::"public"."outreach_action_status";--> statement-breakpoint
DROP TYPE "public"."outreach_action_status_before_merge";
