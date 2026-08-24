ALTER TABLE "conversation_commands"
  ADD COLUMN IF NOT EXISTS "execution_mode" varchar(20) NOT NULL DEFAULT 'live';

ALTER TABLE "conversation_commands"
  DROP CONSTRAINT IF EXISTS "conversation_commands_execution_mode_ck";

ALTER TABLE "conversation_commands"
  ADD CONSTRAINT "conversation_commands_execution_mode_ck"
  CHECK ("execution_mode" IN ('live', 'dry_run'));
