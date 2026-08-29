import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../..", import.meta.url);

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

describe("MCP OAuth persistence boundaries", () => {
  test("migration creates forward-only hashed token tables with tenant foreign keys", async () => {
    const migration = await text("packages/infrastructure/migrations/0098_mcp_oauth_workspace.sql");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "mcp_oauth_clients"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "mcp_oauth_authorization_codes"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "mcp_oauth_access_tokens"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "mcp_oauth_refresh_tokens"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "mcp_oauth_token_revocations"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "mcp_oauth_audit_events"');
    expect(migration).toContain("mcp_oauth_audit_rate_limit_idx");
    expect(migration).toContain('"family_id" uuid NOT NULL');
    expect(migration).toContain('REFERENCES "auth_users"("id")');
    expect(migration).toContain('REFERENCES "workspaces"("id")');
    expect(migration).toContain("UNIQUE");
    expect(migration.toLowerCase()).not.toContain("drop table");
    expect(migration.toLowerCase()).not.toContain("delete from");
  });

  test("repository source uses transactional row locks for one-shot and refresh operations", async () => {
    const source = await text("packages/infrastructure/src/auth/postgres-mcp-oauth-store.ts");
    expect(source).toContain("transaction(async");
    expect(source.toLowerCase()).toContain('for("update")');
    expect(source).toContain("replaceRefreshToken");
    expect(source).toContain("revokeRefreshFamily");
  });

  test("persists and decodes the generic mcp:approve OAuth scope", async () => {
    const source = await text("packages/infrastructure/src/auth/postgres-mcp-oauth-store.ts");
    expect(source).toContain('item === "mcp:approve"');
    const schema = await text("packages/infrastructure/src/database/schema.ts");
    expect(schema).toContain('allowedScopes: jsonb("allowed_scopes")');
    expect(schema).toContain('scopes: jsonb("scopes")');
  });

  test("repository rate limiting is durable and serialized instead of process-local", async () => {
    const source = await text("packages/infrastructure/src/auth/postgres-mcp-oauth-store.ts");
    expect(source).toContain("async consume(input");
    expect(source).toContain("mcp_oauth_rate_limit");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("mcpOauthAuditEvents");
    const handler = await text("packages/interface/src/mcp/mcp-oauth.ts");
    expect(handler).toContain(":source:ip:");
    expect(handler).toContain("enforceSourceRateLimit");
  });

  test("bootstrap dispatches OAuth before MCP and authenticates bearer tokens", async () => {
    const source = await text("packages/bootstrap/src/create-noosphere-api-runtime.ts");
    expect(source).toContain("createMcpOAuthHandler");
    expect(source).toContain('pathname.startsWith("/oauth/")');
    expect(source).toContain("authenticateMcpRequest");
    expect(source).toContain("rateLimiter: mcpOAuthStore");
    expect(source).toContain("securePublicOrigin");
    expect(source).toContain("const publicAppOrigin = securePublicOrigin");
    expect(source).toContain("MCP_TRUSTED_INTERNAL_HOSTS");
  });
});
