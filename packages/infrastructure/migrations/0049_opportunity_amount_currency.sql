ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "amount" numeric(19, 6);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "currency" varchar(3);
