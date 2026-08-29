-- Durable idempotency ledger for internal-only MCP mutations.
-- Additive/forward-only: existing data and tables are untouched.
CREATE TABLE IF NOT EXISTS "mcp_write_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "client_id" varchar(180) NOT NULL REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "tool" varchar(100) NOT NULL,
  "request_key" uuid NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "status" varchar(32) NOT NULL,
  "result" jsonb,
  "correlation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_write_operations_idempotency_uq" UNIQUE ("workspace_id", "client_id", "tool", "request_key")
);
CREATE INDEX IF NOT EXISTS "mcp_write_operations_workspace_idx" ON "mcp_write_operations" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "mcp_write_operations_correlation_idx" ON "mcp_write_operations" ("correlation_id");
