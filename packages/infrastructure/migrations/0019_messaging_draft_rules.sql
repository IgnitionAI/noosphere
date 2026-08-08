ALTER TABLE "messaging_strategies" ADD COLUMN IF NOT EXISTS "draft_rules" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "draft_rules" jsonb DEFAULT '{}'::jsonb NOT NULL;
