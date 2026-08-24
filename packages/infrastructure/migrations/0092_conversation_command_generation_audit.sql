ALTER TABLE "conversation_commands"
  ADD COLUMN IF NOT EXISTS "generation_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
