CREATE TABLE instance_ai_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, provider text NOT NULL,
 base_url text NOT NULL, encrypted_api_key text NOT NULL, version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE instance_ai_models (
 connection_id uuid NOT NULL REFERENCES instance_ai_connections(id) ON DELETE CASCADE,
 model text NOT NULL, reasoning_effort text NOT NULL, connection_version integer NOT NULL,
 status text NOT NULL DEFAULT 'untested' CHECK (status IN ('untested','testing','ready','failed')),
 test_id uuid, tested_at timestamptz, error_code text,
 PRIMARY KEY(connection_id, model)
);
--> statement-breakpoint
CREATE TABLE instance_ai_defaults (
 id boolean PRIMARY KEY DEFAULT true CHECK(id = true),
 connection_id uuid NOT NULL REFERENCES instance_ai_connections(id) ON DELETE CASCADE,
 model text NOT NULL
);
