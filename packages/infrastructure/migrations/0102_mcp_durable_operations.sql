-- Durable operation handles for asynchronous MCP writes.
-- Additive/forward-only: existing data and tables are untouched.
CREATE TABLE IF NOT EXISTS "mcp_operations" (
  "operation_id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "client_id" varchar(180) NOT NULL REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "tool" varchar(100) NOT NULL,
  "request_key" uuid NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "job_id" uuid NOT NULL,
  "correlation_id" varchar(200) NOT NULL,
  "status" varchar(16) NOT NULL CHECK ("status" IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  "result_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error_code" varchar(120),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_operations_request_uq" UNIQUE ("workspace_id", "client_id", "tool", "request_key")
);
CREATE INDEX IF NOT EXISTS "mcp_operations_workspace_status_idx" ON "mcp_operations" ("workspace_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "mcp_operations_job_idx" ON "mcp_operations" ("workspace_id", "job_id");
