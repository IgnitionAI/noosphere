ALTER TABLE instance_ai_connections ALTER COLUMN encrypted_api_key DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE instance_ai_connections ADD COLUMN IF NOT EXISTS authentication_session_id uuid;
