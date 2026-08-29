-- Persisted optimistic-concurrency revisions for MCP internal writes.
-- Additive/forward-only; existing rows start at revision 1.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE "content_ideas" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE "mcp_oauth_audit_events" ADD COLUMN IF NOT EXISTS "actor_type" varchar(40) NOT NULL DEFAULT 'oauth';
ALTER TABLE "mcp_oauth_audit_events" ADD COLUMN IF NOT EXISTS "tool" varchar(100);
ALTER TABLE "mcp_oauth_audit_events" ADD COLUMN IF NOT EXISTS "correlation_id" uuid;
ALTER TABLE "mcp_oauth_audit_events" ADD COLUMN IF NOT EXISTS "outcome" varchar(40) NOT NULL DEFAULT 'accepted';
ALTER TABLE "companies" ADD CONSTRAINT "companies_revision_ck" CHECK ("revision" > 0);
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_revision_ck" CHECK ("revision" > 0);
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_revision_ck" CHECK ("revision" > 0);
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_revision_ck" CHECK ("revision" > 0);
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_revision_ck" CHECK ("revision" > 0);
