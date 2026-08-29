-- Lease ownership makes an interrupted MCP write reclaimable after expiry.
-- Additive/forward-only; no existing rows or data are removed.
ALTER TABLE "mcp_write_operations" ADD COLUMN IF NOT EXISTS "lease_owner" varchar(180);
ALTER TABLE "mcp_write_operations" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamptz;
CREATE INDEX IF NOT EXISTS "mcp_write_operations_lease_idx" ON "mcp_write_operations" ("status", "lease_expires_at");
-- Normalize legacy labels before enforcing the bounded audit vocabulary.
UPDATE "mcp_oauth_audit_events" SET "outcome" = 'replayed' WHERE "outcome" = 'replay';
UPDATE "mcp_oauth_audit_events" SET "outcome" = 'denied' WHERE "outcome" IN ('rejected', 'forbidden', 'scope_denied');
ALTER TABLE "mcp_oauth_audit_events" ADD CONSTRAINT "mcp_oauth_audit_outcome_ck"
  CHECK ("outcome" IN ('accepted', 'denied', 'replayed', 'stale', 'failed', 'in_progress'));
