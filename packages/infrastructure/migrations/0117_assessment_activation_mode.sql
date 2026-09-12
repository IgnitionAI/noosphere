ALTER TABLE "channel_assessments" ADD COLUMN "activation_mode" text;
--> statement-breakpoint
ALTER TABLE "channel_assessments" ADD CONSTRAINT "channel_assessments_activation_mode_check" CHECK ("activation_mode" IS NULL OR "activation_mode" = 'manual');
