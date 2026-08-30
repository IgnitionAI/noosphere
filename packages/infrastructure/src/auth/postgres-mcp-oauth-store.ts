import { createHash } from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  authUsers,
  mcpOauthAccessTokens,
  mcpOauthAuditEvents,
  mcpOauthAuthorizationCodes,
  mcpOauthClients,
  mcpOauthRefreshTokens,
  mcpOauthTokenRevocations,
  workspaceMembers,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import type { WorkspaceRole } from "@outbound/interface/http/request-context";
import type {
  McpOAuthAccessToken,
  McpOAuthAuthorizationCode,
  McpOAuthClient,
  McpOAuthRefreshToken,
  McpOAuthRateLimitRequest,
  McpOAuthRateLimitResult,
  McpOAuthRefreshRotationResult,
  McpOAuthScope,
  McpOAuthStore,
} from "@outbound/interface/mcp/mcp-oauth";
import { createMcpOAuthService, type McpOAuthService, type McpOAuthServiceOptions } from "@outbound/interface/mcp/mcp-oauth";

/** Durable MCP OAuth repository. Row locks make code consumption and refresh
 * rotation atomic across API replicas, while all lookup keys are digests. */
export class PostgresMcpOAuthStore implements McpOAuthStore {
  constructor(private readonly db: Database) {}

  async findClient(clientId: string): Promise<McpOAuthClient | null> {
    const [row] = await this.db.select().from(mcpOauthClients).where(and(eq(mcpOauthClients.clientId, clientId), isNull(mcpOauthClients.revokedAt))).limit(1);
    return row ? mapClient(row) : null;
  }

  async insertClient(client: McpOAuthClient): Promise<void> {
    await this.db.insert(mcpOauthClients).values({
      id: client.id,
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUris: [...client.redirectUris],
      userId: client.userId,
      workspaceId: client.workspaceId,
      workspaceSlug: client.workspaceSlug,
      allowedScopes: [...client.allowedScopes],
    });
  }

  async insertAuthorizationCode(code: McpOAuthAuthorizationCode): Promise<void> {
    await this.db.insert(mcpOauthAuthorizationCodes).values({
      id: code.id,
      codeHash: code.codeHash,
      clientId: code.clientId,
      userId: code.userId,
      workspaceId: code.workspaceId,
      redirectUri: code.redirectUri,
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
      scopes: [...code.scopes],
      resource: code.resource,
      expiresAt: code.expiresAt,
      consumedAt: code.consumedAt,
    });
  }

  async consumeAuthorizationCode(codeHash: string, now: Date): Promise<McpOAuthAuthorizationCode | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(mcpOauthAuthorizationCodes).where(eq(mcpOauthAuthorizationCodes.codeHash, codeHash)).for("update").limit(1);
      if (!row || row.consumedAt || row.expiresAt <= now) return null;
      const [consumed] = await tx.update(mcpOauthAuthorizationCodes)
        .set({ consumedAt: now })
        .where(and(eq(mcpOauthAuthorizationCodes.id, row.id), isNull(mcpOauthAuthorizationCodes.consumedAt)))
        .returning();
      return consumed ? mapCode(consumed) : null;
    });
  }

  async insertAccessToken(token: McpOAuthAccessToken): Promise<void> {
    await this.db.insert(mcpOauthAccessTokens).values({
      id: token.id,
      tokenHash: token.tokenHash,
      familyId: token.familyId,
      clientId: token.clientId,
      userId: token.userId,
      workspaceId: token.workspaceId,
      scopes: [...token.scopes],
      audience: token.audience,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
    });
  }

  async findAccessToken(tokenHash: string): Promise<McpOAuthAccessToken | null> {
    const [row] = await this.db.select().from(mcpOauthAccessTokens).where(eq(mcpOauthAccessTokens.tokenHash, tokenHash)).limit(1);
    return row ? mapAccess(row) : null;
  }

  async isTokenFamilyRevoked(familyId: string): Promise<boolean> {
    const [revocation] = await this.db.select({ id: mcpOauthTokenRevocations.id })
      .from(mcpOauthTokenRevocations)
      .where(and(
        eq(mcpOauthTokenRevocations.tokenHash, familyRevocationHash(familyId)),
        eq(mcpOauthTokenRevocations.tokenType, "refresh_family"),
        eq(mcpOauthTokenRevocations.reason, "refresh_family_revoked"),
      ))
      .limit(1);
    return Boolean(revocation);
  }

  async insertRefreshToken(token: McpOAuthRefreshToken): Promise<void> {
    await this.db.insert(mcpOauthRefreshTokens).values({
      id: token.id,
      tokenHash: token.tokenHash,
      familyId: token.familyId,
      clientId: token.clientId,
      userId: token.userId,
      workspaceId: token.workspaceId,
      scopes: [...token.scopes],
      audience: token.audience,
      expiresAt: token.expiresAt,
      rotatedAt: token.rotatedAt,
      revokedAt: token.revokedAt,
    });
  }

  async findRefreshToken(tokenHash: string): Promise<McpOAuthRefreshToken | null> {
    const [row] = await this.db.select().from(mcpOauthRefreshTokens).where(eq(mcpOauthRefreshTokens.tokenHash, tokenHash)).limit(1);
    return row ? mapRefresh(row) : null;
  }

  async rotateRefreshToken(input: Parameters<McpOAuthStore["rotateRefreshToken"]>[0]): Promise<McpOAuthRefreshRotationResult> {
    return this.db.transaction(async (tx) => {
      const advisory = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`mcp-oauth-refresh:${input.tokenHash}`}, 0)) as acquired`);
      if (!(advisory[0] as { readonly acquired?: boolean } | undefined)?.acquired) return { status: "concurrent" };

      const [current] = await tx.select().from(mcpOauthRefreshTokens).where(eq(mcpOauthRefreshTokens.tokenHash, input.tokenHash)).for("update").limit(1);
      if (!current) return { status: "missing" };
      if (current.clientId !== input.clientId || current.audience !== input.audience || current.revokedAt || current.expiresAt <= input.now) return { status: "invalid" };
      if (current.rotatedAt) return { status: "replayed" };

      const [client] = await tx.select({ clientId: mcpOauthClients.clientId, userId: mcpOauthClients.userId, workspaceId: mcpOauthClients.workspaceId })
        .from(mcpOauthClients)
        .where(and(eq(mcpOauthClients.clientId, input.clientId), isNull(mcpOauthClients.revokedAt)))
        .for("update")
        .limit(1);
      if (!client || client.userId !== current.userId || client.workspaceId !== current.workspaceId) return { status: "invalid" };

      const [membership] = await tx.select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(and(
          eq(workspaceMembers.userId, current.userId),
          eq(workspaceMembers.workspaceId, current.workspaceId),
          eq(workspaceMembers.status, "active"),
          eq(workspaces.status, "active"),
          isNull(workspaces.deletedAt),
        ))
        .for("update")
        .limit(1);
      if (!membership) return { status: "invalid" };

      const tokens = await input.createTokens(mapRefresh(current), membership);
      if (!validReplacement(tokens, current)) return { status: "invalid" };

      const [consumed] = await tx.update(mcpOauthRefreshTokens)
        .set({ rotatedAt: input.now })
        .where(and(eq(mcpOauthRefreshTokens.id, current.id), isNull(mcpOauthRefreshTokens.rotatedAt), isNull(mcpOauthRefreshTokens.revokedAt)))
        .returning({ id: mcpOauthRefreshTokens.id });
      if (!consumed) return { status: "replayed" };

      await tx.insert(mcpOauthAccessTokens).values({
        id: tokens.accessToken.id,
        tokenHash: tokens.accessToken.tokenHash,
        familyId: tokens.accessToken.familyId,
        clientId: tokens.accessToken.clientId,
        userId: tokens.accessToken.userId,
        workspaceId: tokens.accessToken.workspaceId,
        scopes: [...tokens.accessToken.scopes],
        audience: tokens.accessToken.audience,
        expiresAt: tokens.accessToken.expiresAt,
        revokedAt: tokens.accessToken.revokedAt,
      });
      await tx.insert(mcpOauthRefreshTokens).values({
        id: tokens.refreshToken.id,
        tokenHash: tokens.refreshToken.tokenHash,
        familyId: tokens.refreshToken.familyId,
        clientId: tokens.refreshToken.clientId,
        userId: tokens.refreshToken.userId,
        workspaceId: tokens.refreshToken.workspaceId,
        scopes: [...tokens.refreshToken.scopes],
        audience: tokens.refreshToken.audience,
        expiresAt: tokens.refreshToken.expiresAt,
        rotatedAt: tokens.refreshToken.rotatedAt,
        revokedAt: tokens.refreshToken.revokedAt,
      });
      await tx.insert(mcpOauthAuditEvents).values({
        action: "mcp_oauth_token_issued",
        clientId: current.clientId,
        userId: current.userId,
        workspaceId: current.workspaceId,
      });
      return { status: "rotated", tokens };
    });
  }

  async replaceRefreshToken(tokenHash: string, now: Date, replacement: McpOAuthRefreshToken): Promise<"rotated" | "reused" | "missing"> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(mcpOauthRefreshTokens).where(eq(mcpOauthRefreshTokens.tokenHash, tokenHash)).for("update").limit(1);
      if (!current) return "missing";
      if (current.rotatedAt || current.revokedAt || current.expiresAt <= now) return "reused";
      const [updated] = await tx.update(mcpOauthRefreshTokens)
        .set({ rotatedAt: now })
        .where(and(eq(mcpOauthRefreshTokens.id, current.id), isNull(mcpOauthRefreshTokens.rotatedAt), isNull(mcpOauthRefreshTokens.revokedAt)))
        .returning({ id: mcpOauthRefreshTokens.id });
      if (!updated) return "reused";
      await tx.insert(mcpOauthRefreshTokens).values({
        id: replacement.id,
        tokenHash: replacement.tokenHash,
        familyId: replacement.familyId,
        clientId: replacement.clientId,
        userId: replacement.userId,
        workspaceId: replacement.workspaceId,
        scopes: [...replacement.scopes],
        audience: replacement.audience,
        expiresAt: replacement.expiresAt,
        rotatedAt: replacement.rotatedAt,
        revokedAt: replacement.revokedAt,
      });
      return "rotated";
    });
  }

  async revokeRefreshFamily(familyId: string, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [family] = await tx.select({ clientId: mcpOauthRefreshTokens.clientId, userId: mcpOauthRefreshTokens.userId, workspaceId: mcpOauthRefreshTokens.workspaceId, expiresAt: mcpOauthRefreshTokens.expiresAt })
        .from(mcpOauthRefreshTokens)
        .where(eq(mcpOauthRefreshTokens.familyId, familyId))
        .limit(1);
      await tx.update(mcpOauthRefreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(mcpOauthRefreshTokens.familyId, familyId), isNull(mcpOauthRefreshTokens.revokedAt)));
      await tx.update(mcpOauthAccessTokens)
        .set({ revokedAt: now })
        .where(and(eq(mcpOauthAccessTokens.familyId, familyId), isNull(mcpOauthAccessTokens.revokedAt)));
      if (family) {
        await tx.insert(mcpOauthTokenRevocations).values({
          tokenHash: familyRevocationHash(familyId),
          tokenType: "refresh_family",
          clientId: family.clientId,
          userId: family.userId,
          workspaceId: family.workspaceId,
          reason: "refresh_family_revoked",
          expiresAt: family.expiresAt,
        }).onConflictDoNothing({ target: mcpOauthTokenRevocations.tokenHash });
      }
    });
  }

  async revokeToken(tokenHash: string, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [access] = await tx.update(mcpOauthAccessTokens).set({ revokedAt: now }).where(and(eq(mcpOauthAccessTokens.tokenHash, tokenHash), isNull(mcpOauthAccessTokens.revokedAt))).returning({ id: mcpOauthAccessTokens.id, clientId: mcpOauthAccessTokens.clientId, userId: mcpOauthAccessTokens.userId, workspaceId: mcpOauthAccessTokens.workspaceId, expiresAt: mcpOauthAccessTokens.expiresAt });
      const [refresh] = await tx.update(mcpOauthRefreshTokens).set({ revokedAt: now }).where(and(eq(mcpOauthRefreshTokens.tokenHash, tokenHash), isNull(mcpOauthRefreshTokens.revokedAt))).returning({ id: mcpOauthRefreshTokens.id, clientId: mcpOauthRefreshTokens.clientId, userId: mcpOauthRefreshTokens.userId, workspaceId: mcpOauthRefreshTokens.workspaceId, expiresAt: mcpOauthRefreshTokens.expiresAt });
      await tx.insert(mcpOauthTokenRevocations).values({
        tokenHash,
        tokenType: refresh ? "refresh_token" : access ? "access_token" : "unknown",
        clientId: refresh?.clientId ?? access?.clientId ?? null,
        userId: refresh?.userId ?? access?.userId ?? null,
        workspaceId: refresh?.workspaceId ?? access?.workspaceId ?? null,
        reason: "explicit_revocation",
        expiresAt: refresh?.expiresAt ?? access?.expiresAt ?? null,
      }).onConflictDoNothing({ target: mcpOauthTokenRevocations.tokenHash });
    });
  }

  async findActiveMembership(userId: string, workspaceId: string): Promise<{ readonly role: WorkspaceRole; readonly workspaceSlug: string } | null> {
    const [row] = await this.db.select({ role: workspaceMembers.role, workspaceSlug: workspaces.slug })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active"), eq(workspaces.status, "active"), isNull(workspaces.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async audit(input: { readonly action: string; readonly clientId?: string; readonly userId?: string; readonly workspaceId?: string; readonly subjectId?: string }): Promise<void> {
    await this.db.insert(mcpOauthAuditEvents).values({
      action: input.action,
      clientId: input.clientId ?? null,
      userId: input.userId ?? null,
      workspaceId: input.workspaceId ?? null,
      subjectId: input.subjectId ?? null,
    });
  }

  /**
   * Durable fixed-window limiter shared by all API replicas. The existing
   * OAuth audit table is used as an append-only counter; an advisory lock
   * serializes check-and-insert so concurrent requests cannot over-admit.
   */
  async consume(input: McpOAuthRateLimitRequest): Promise<McpOAuthRateLimitResult> {
    const limit = Math.max(1, Math.floor(input.limit));
    const windowSeconds = Math.max(1, Math.floor(input.windowSeconds));
    const subjectId = createHash("sha256").update(input.key).digest("hex");
    const now = new Date();
    const since = new Date(now.getTime() - windowSeconds * 1000);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mcp-oauth-rate:${subjectId}`}, 0))`);
      const [row] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(mcpOauthAuditEvents)
        .where(and(
          eq(mcpOauthAuditEvents.action, "mcp_oauth_rate_limit"),
          eq(mcpOauthAuditEvents.subjectId, subjectId),
          gte(mcpOauthAuditEvents.createdAt, since),
        ));
      const count = Number(row?.count ?? 0);
      if (count >= limit) return { allowed: false, retryAfterSeconds: windowSeconds };
      await tx.insert(mcpOauthAuditEvents).values({ action: "mcp_oauth_rate_limit", subjectId });
      return { allowed: true, retryAfterSeconds: 0 };
    });
  }
}

function validReplacement(
  tokens: Awaited<ReturnType<Parameters<McpOAuthStore["rotateRefreshToken"]>[0]["createTokens"]>>,
  current: typeof mcpOauthRefreshTokens.$inferSelect,
): boolean {
  const access = tokens.accessToken;
  const refresh = tokens.refreshToken;
  return access.familyId === current.familyId
    && refresh.familyId === current.familyId
    && access.clientId === current.clientId
    && refresh.clientId === current.clientId
    && access.userId === current.userId
    && refresh.userId === current.userId
    && access.workspaceId === current.workspaceId
    && refresh.workspaceId === current.workspaceId
    && access.audience === current.audience
    && refresh.audience === current.audience
    && refresh.tokenHash !== current.tokenHash
    && refresh.rotatedAt === null
    && refresh.revokedAt === null
    && access.revokedAt === null;
}

/** Convenience composition for API bootstrap and tests. */
export function createPostgresMcpOAuthService(db: Database, options: McpOAuthServiceOptions): McpOAuthService {
  return createMcpOAuthService(new PostgresMcpOAuthStore(db), options);
}

export { PostgresMcpOAuthStore as PostgresMcpOAuthRepository };

function mapClient(row: typeof mcpOauthClients.$inferSelect): McpOAuthClient {
  return { id: row.id, clientId: row.clientId, clientName: row.clientName, redirectUris: stringArray(row.redirectUris), userId: row.userId, workspaceId: row.workspaceId, workspaceSlug: row.workspaceSlug, allowedScopes: scopeArray(row.allowedScopes) };
}

function mapCode(row: typeof mcpOauthAuthorizationCodes.$inferSelect): McpOAuthAuthorizationCode {
  return { id: row.id, codeHash: row.codeHash, clientId: row.clientId, userId: row.userId, workspaceId: row.workspaceId, redirectUri: row.redirectUri, codeChallenge: row.codeChallenge, codeChallengeMethod: "S256", scopes: scopeArray(row.scopes), resource: row.resource, expiresAt: row.expiresAt, consumedAt: row.consumedAt };
}

function mapAccess(row: typeof mcpOauthAccessTokens.$inferSelect): McpOAuthAccessToken {
  return { id: row.id, tokenHash: row.tokenHash, familyId: row.familyId, clientId: row.clientId, userId: row.userId, workspaceId: row.workspaceId, scopes: scopeArray(row.scopes), audience: row.audience, expiresAt: row.expiresAt, revokedAt: row.revokedAt };
}

function mapRefresh(row: typeof mcpOauthRefreshTokens.$inferSelect): McpOAuthRefreshToken {
  return { id: row.id, tokenHash: row.tokenHash, familyId: row.familyId, clientId: row.clientId, userId: row.userId, workspaceId: row.workspaceId, scopes: scopeArray(row.scopes), audience: row.audience, expiresAt: row.expiresAt, rotatedAt: row.rotatedAt, revokedAt: row.revokedAt };
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function scopeArray(value: unknown): readonly McpOAuthScope[] {
  return stringArray(value).filter((item): item is McpOAuthScope => item === "mcp:read" || item === "mcp:write" || item === "mcp:approve");
}

function familyRevocationHash(familyId: string): string {
  return createHash("sha256").update(`mcp-oauth-refresh-family:${familyId}`).digest("hex");
}
