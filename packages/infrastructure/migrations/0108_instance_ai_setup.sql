CREATE TABLE IF NOT EXISTS instance_administrators (
  user_id uuid PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS instance_setup (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  skipped boolean NOT NULL DEFAULT false
);
