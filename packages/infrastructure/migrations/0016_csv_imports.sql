CREATE TABLE IF NOT EXISTS "import_batches" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "filename" varchar(500) NOT NULL,
  "file_hash" varchar(64) NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "mapping" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "raw_content" text NOT NULL,
  "raw_expires_at" timestamp with time zone NOT NULL,
  "status" varchar(40) NOT NULL DEFAULT 'uploaded',
  "previewed_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_by" uuid,
  "totals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "import_batches_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "import_batches_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE SET NULL,
  CONSTRAINT "import_batches_workspace_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "import_batches_workspace_key_uq" UNIQUE ("workspace_id", "idempotency_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_workspace_created_idx" ON "import_batches" USING btree ("workspace_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_rows" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "line_number" integer NOT NULL,
  "raw_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "normalized_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "row_fingerprint" varchar(64) NOT NULL,
  "status" varchar(40) NOT NULL DEFAULT 'pending',
  "reason" varchar(500),
  "company_id" uuid,
  "contact_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "import_rows_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "import_rows_batch_fk" FOREIGN KEY ("workspace_id", "batch_id") REFERENCES "public"."import_batches"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "import_rows_workspace_line_uq" UNIQUE ("workspace_id", "batch_id", "line_number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_rows_batch_status_idx" ON "import_rows" USING btree ("workspace_id", "batch_id", "status");
