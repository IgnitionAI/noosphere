import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq, isNull } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, mcpOauthAccessTokens, mcpOauthAuditEvents, mcpOauthClients, mcpOauthRefreshTokens, workspaceMembers, workspaces } from "@outbound/infrastructure/database/schema";
import { createPostgresMcpOAuthService, PostgresMcpOAuthStore } from "@outbound/infrastructure/auth/postgres-mcp-oauth-store";
import { MCP_OAUTH_RESOURCE } from "@outbound/interface/mcp/mcp-oauth";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP OAuth family revocation durability", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const clientRowId = crypto.randomUUID();
  const clientId = `mcp-oauth-family-${workspaceId}`;
  const workspaceSlug = `mcp-oauth-family-${workspaceId}`;
  const familyId = crypto.randomUUID();
  const isolatedFamilyId = crypto.randomUUID();
  const accessTokenValue = `access-${workspaceId}`;
  const refreshTokenValue = `refresh-${workspaceId}`;
  const now = new Date("2026-08-29T12:00:00.000Z");
  const expiresAt = new Date(now.getTime() + 300_000);

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: workspaceSlug, name: "OAuth family fixture" });
    await database.db.insert(authUsers).values({ id: userId, name: "OAuth Family Fixture", email: `oauth-family-${userId}@example.test` });
    await database.db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner", status: "active" });
    await database.db.insert(mcpOauthClients).values({
      id: clientRowId,
      clientId,
      clientName: "OAuth Family Fixture",
      redirectUris: [],
      userId,
      workspaceId,
      workspaceSlug,
      allowedScopes: ["mcp:read"],
    });
    await database.db.insert(mcpOauthAccessTokens).values([
      { id: crypto.randomUUID(), tokenHash: hashToken(accessTokenValue), familyId, clientId, userId, workspaceId, scopes: ["mcp:read"], audience: "https://example.test/mcp", expiresAt, revokedAt: null },
      { id: crypto.randomUUID(), tokenHash: "b".repeat(64), familyId: isolatedFamilyId, clientId, userId, workspaceId, scopes: ["mcp:read"], audience: "https://example.test/mcp", expiresAt, revokedAt: null },
    ]);
    await database.db.insert(mcpOauthRefreshTokens).values({
      id: crypto.randomUUID(),
      tokenHash: hashToken(refreshTokenValue),
      familyId,
      clientId,
      userId,
      workspaceId,
      scopes: ["mcp:read"],
      audience: "https://example.test/mcp",
      expiresAt,
      rotatedAt: null,
      revokedAt: null,
    });
  });

  afterAll(async () => {
    await database.db.delete(mcpOauthAuditEvents).where(eq(mcpOauthAuditEvents.workspaceId, workspaceId));
    await database.db.delete(mcpOauthRefreshTokens).where(eq(mcpOauthRefreshTokens.workspaceId, workspaceId));
    await database.db.delete(mcpOauthAccessTokens).where(eq(mcpOauthAccessTokens.workspaceId, workspaceId));
    await database.db.delete(mcpOauthClients).where(eq(mcpOauthClients.clientId, clientId));
    await database.db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    await database.db.delete(authUsers).where(eq(authUsers.id, userId));
    await database.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await database.close();
  });

  test("revokeRefreshFamily is visible after a fresh store and never crosses families", async () => {
    const first = new PostgresMcpOAuthStore(database.db);
    expect(await first.isTokenFamilyRevoked(familyId)).toBe(false);
    expect(await first.isTokenFamilyRevoked(isolatedFamilyId)).toBe(false);

    const oauthA = createPostgresMcpOAuthService(database.db, { issuer: "https://example.test", resource: `https://example.test${MCP_OAUTH_RESOURCE}`, now: () => now });
    const rotated = await oauthA.refreshAccessToken({ clientId, refreshToken: refreshTokenValue, resource: `https://example.test${MCP_OAUTH_RESOURCE}` });
    expect(rotated.refreshToken).toBeDefined();
    expect(await oauthA.authenticateMcpRequest({ accessToken: accessTokenValue, resource: `https://example.test${MCP_OAUTH_RESOURCE}` })).toMatchObject({ userId, workspaceId, clientId });

    const oauthB = createPostgresMcpOAuthService(database.db, { issuer: "https://example.test", resource: `https://example.test${MCP_OAUTH_RESOURCE}`, now: () => now });
    await expect(oauthB.refreshAccessToken({ clientId, refreshToken: refreshTokenValue, resource: `https://example.test${MCP_OAUTH_RESOURCE}` })).rejects.toMatchObject({ oauthCode: "invalid_grant" });

    const restarted = new PostgresMcpOAuthStore(database.db);
    expect(await restarted.isTokenFamilyRevoked(familyId)).toBe(true);
    expect(await restarted.isTokenFamilyRevoked(isolatedFamilyId)).toBe(false);
    const oauthC = createPostgresMcpOAuthService(database.db, { issuer: "https://example.test", resource: `https://example.test${MCP_OAUTH_RESOURCE}`, now: () => now });
    await expect(oauthC.authenticateMcpRequest({ accessToken: rotated.accessToken, resource: `https://example.test${MCP_OAUTH_RESOURCE}` })).rejects.toMatchObject({ oauthCode: "invalid_token" });
    await expect(oauthC.refreshAccessToken({ clientId, refreshToken: rotated.refreshToken!, resource: `https://example.test${MCP_OAUTH_RESOURCE}` })).rejects.toMatchObject({ oauthCode: "invalid_grant" });
    const access = await database.db.select({ revokedAt: mcpOauthAccessTokens.revokedAt }).from(mcpOauthAccessTokens).where(eq(mcpOauthAccessTokens.familyId, familyId));
    const refresh = await database.db.select({ revokedAt: mcpOauthRefreshTokens.revokedAt }).from(mcpOauthRefreshTokens).where(eq(mcpOauthRefreshTokens.familyId, familyId));
    expect(access).toHaveLength(2);
    expect(refresh).toHaveLength(2);
    expect(access.every((row) => row.revokedAt?.getTime() === now.getTime())).toBe(true);
    expect(refresh.every((row) => row.revokedAt?.getTime() === now.getTime())).toBe(true);
    expect(await database.db.select({ id: mcpOauthAccessTokens.id }).from(mcpOauthAccessTokens).where(and(eq(mcpOauthAccessTokens.familyId, isolatedFamilyId), isNull(mcpOauthAccessTokens.revokedAt)))).toHaveLength(1);
    const auditRows = await database.client<{ action: string; client_id: string | null; user_id: string | null; workspace_id: string | null }[]>`select action, client_id, user_id, workspace_id from mcp_oauth_audit_events where workspace_id = ${workspaceId}`;
    expect(JSON.stringify(auditRows)).not.toContain(accessTokenValue);
    expect(JSON.stringify(auditRows)).not.toContain(refreshTokenValue);
    expect(auditRows.filter((row) => row.action === "mcp_oauth_token_issued")).toHaveLength(1);

    const [isolatedAccess] = await database.db.select({ tokenHash: mcpOauthAccessTokens.tokenHash })
      .from(mcpOauthAccessTokens)
      .where(and(eq(mcpOauthAccessTokens.familyId, isolatedFamilyId), isNull(mcpOauthAccessTokens.revokedAt)));
    expect(isolatedAccess).toBeDefined();
    await restarted.revokeToken(isolatedAccess!.tokenHash, now);
    expect(await restarted.isTokenFamilyRevoked(isolatedFamilyId)).toBe(false);
    expect((await restarted.findAccessToken(isolatedAccess!.tokenHash))?.revokedAt).toEqual(now);
  });

  test("rolls back refresh consumption when replacement persistence fails", async () => {
    const failedRefreshValue = `refresh-failure-${workspaceId}`;
    const failedRefreshHash = hashToken(failedRefreshValue);
    await database.db.insert(mcpOauthRefreshTokens).values({
      id: crypto.randomUUID(),
      tokenHash: failedRefreshHash,
      familyId: isolatedFamilyId,
      clientId,
      userId,
      workspaceId,
      scopes: ["mcp:read"],
      audience: "https://example.test/mcp",
      expiresAt,
      rotatedAt: null,
      revokedAt: null,
    });
    const [existingAccess] = await database.db.select().from(mcpOauthAccessTokens).where(eq(mcpOauthAccessTokens.familyId, isolatedFamilyId));
    expect(existingAccess).toBeDefined();

    const store = new PostgresMcpOAuthStore(database.db);
    await expect(store.rotateRefreshToken({
      tokenHash: failedRefreshHash,
      clientId,
      audience: "https://example.test/mcp",
      now,
      createTokens: async (current) => ({
        response: { accessToken: "unused", tokenType: "Bearer", expiresIn: 300, refreshToken: "unused-refresh", scope: "mcp:read" },
        // Reuse an existing primary key to force a real DB insertion failure.
        accessToken: {
          id: existingAccess!.id,
          tokenHash: hashToken(`replacement-access-${workspaceId}`),
          familyId: current.familyId,
          clientId: current.clientId,
          userId: current.userId,
          workspaceId: current.workspaceId,
          scopes: ["mcp:read"],
          audience: current.audience,
          expiresAt,
          revokedAt: null,
        },
        refreshToken: {
          id: crypto.randomUUID(),
          tokenHash: hashToken(`replacement-refresh-${workspaceId}`),
          familyId: current.familyId,
          clientId: current.clientId,
          userId: current.userId,
          workspaceId: current.workspaceId,
          scopes: ["mcp:read"],
          audience: current.audience,
          expiresAt,
          rotatedAt: null,
          revokedAt: null,
        },
      }),
    })).rejects.toBeDefined();
    const afterFailure = await store.findRefreshToken(failedRefreshHash);
    expect(afterFailure?.rotatedAt).toBeNull();
    expect(await database.db.select({ id: mcpOauthAccessTokens.id }).from(mcpOauthAccessTokens).where(eq(mcpOauthAccessTokens.familyId, isolatedFamilyId))).toHaveLength(1);
    expect(await database.db.select({ id: mcpOauthRefreshTokens.id }).from(mcpOauthRefreshTokens).where(and(eq(mcpOauthRefreshTokens.familyId, isolatedFamilyId), eq(mcpOauthRefreshTokens.tokenHash, failedRefreshHash)))).toHaveLength(1);
  });
});

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
