-- MCP OAuth workspace grants. This migration is strictly additive: no existing
-- data is deleted or rewritten, and all bearer values remain hashed.
CREATE TABLE IF NOT EXISTS "mcp_oauth_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" varchar(180) NOT NULL UNIQUE,
  "client_name" varchar(200) NOT NULL,
  "redirect_uris" jsonb NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "workspace_slug" varchar(120) NOT NULL,
  "allowed_scopes" jsonb NOT NULL DEFAULT '["mcp:read"]'::jsonb,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mcp_oauth_clients_workspace_idx" ON "mcp_oauth_clients" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "mcp_oauth_clients_user_idx" ON "mcp_oauth_clients" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "mcp_oauth_authorization_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" varchar(128) NOT NULL UNIQUE,
  "client_id" varchar(180) NOT NULL REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "redirect_uri" text NOT NULL,
  "code_challenge" varchar(128) NOT NULL,
  "code_challenge_method" varchar(16) NOT NULL DEFAULT 'S256',
  "scopes" jsonb NOT NULL,
  "resource" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mcp_oauth_codes_client_expiry_idx" ON "mcp_oauth_authorization_codes" ("client_id", "expires_at");
CREATE INDEX IF NOT EXISTS "mcp_oauth_codes_workspace_idx" ON "mcp_oauth_authorization_codes" ("workspace_id", "created_at");

CREATE TABLE IF NOT EXISTS "mcp_oauth_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" varchar(128) NOT NULL UNIQUE,
  "family_id" uuid NOT NULL,
  "client_id" varchar(180) NOT NULL REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "scopes" jsonb NOT NULL,
  "audience" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mcp_oauth_access_client_idx" ON "mcp_oauth_access_tokens" ("client_id", "expires_at");
CREATE INDEX IF NOT EXISTS "mcp_oauth_access_workspace_idx" ON "mcp_oauth_access_tokens" ("workspace_id", "created_at");

CREATE TABLE IF NOT EXISTS "mcp_oauth_refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" varchar(128) NOT NULL UNIQUE,
  "family_id" uuid NOT NULL,
  "client_id" varchar(180) NOT NULL REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "scopes" jsonb NOT NULL,
  "audience" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "rotated_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mcp_oauth_refresh_family_idx" ON "mcp_oauth_refresh_tokens" ("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "mcp_oauth_refresh_client_idx" ON "mcp_oauth_refresh_tokens" ("client_id", "expires_at");
CREATE INDEX IF NOT EXISTS "mcp_oauth_refresh_workspace_idx" ON "mcp_oauth_refresh_tokens" ("workspace_id", "created_at");

CREATE TABLE IF NOT EXISTS "mcp_oauth_token_revocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" varchar(128) NOT NULL UNIQUE,
  "token_type" varchar(32) NOT NULL,
  "client_id" varchar(180) REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "reason" varchar(200),
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mcp_oauth_revocations_workspace_idx" ON "mcp_oauth_token_revocations" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "mcp_oauth_revocations_expiry_idx" ON "mcp_oauth_token_revocations" ("expires_at");

CREATE TABLE IF NOT EXISTS "mcp_oauth_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" varchar(160) NOT NULL,
  "client_id" varchar(180),
  "user_id" uuid REFERENCES "auth_users"("id") ON DELETE SET NULL,
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE SET NULL,
  "subject_id" varchar(180),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mcp_oauth_audit_workspace_idx" ON "mcp_oauth_audit_events" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "mcp_oauth_audit_client_idx" ON "mcp_oauth_audit_events" ("client_id", "created_at");
CREATE INDEX IF NOT EXISTS "mcp_oauth_audit_rate_limit_idx" ON "mcp_oauth_audit_events" ("action", "subject_id", "created_at");
