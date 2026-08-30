import { describe, expect, test } from "bun:test";
import {
  createMcpOAuthService,
  createMcpOAuthHandler,
  MCP_OAUTH_MAX_BODY_BYTES,
  MCP_OAUTH_RESOURCE,
  MCP_OAUTH_SCOPES,
  type McpOAuthClient,
  type McpOAuthService,
  type McpOAuthStore,
  type McpOAuthAuthorizationCode,
  type McpOAuthAccessToken,
  type McpOAuthRefreshToken,
  type OAuthAuthorizeContext,
  type OAuthPrincipal,
  type OAuthTokenResponse,
} from "@outbound/interface/mcp/mcp-oauth";

const issuer = "https://example.test";
const challenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function service(overrides: Partial<McpOAuthService> = {}): McpOAuthService {
  const client: McpOAuthClient = {
    id: "client-row",
    clientId: "client-public",
    clientName: "Smoke client",
    redirectUris: ["https://client.example/callback"],
    userId: "user-1",
    workspaceId: "workspace-1",
    workspaceSlug: "acme",
    allowedScopes: [...MCP_OAUTH_SCOPES],
  };
  const token: OAuthTokenResponse = {
    accessToken: "access-secret",
    tokenType: "Bearer",
    expiresIn: 300,
    refreshToken: "refresh-secret",
    scope: "mcp:read",
  };
  return {
    metadata: () => ({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...MCP_OAUTH_SCOPES],
    }),
    protectedResourceMetadata: () => ({
      resource: `${issuer}${MCP_OAUTH_RESOURCE}`,
      authorization_servers: [issuer],
      scopes_supported: [...MCP_OAUTH_SCOPES],
      bearer_methods_supported: ["header"],
    }),
    registerClient: async () => client,
    beginAuthorization: async (input: OAuthAuthorizeContext) => ({
      client,
      effectiveScopes: input.requestedScopes,
      ...(input.approved ? { redirect: `${input.redirectUri}?code=one-use-code&state=${encodeURIComponent(input.state)}` } : { consentRequired: true }),
    }),
    exchangeAuthorizationCode: async () => token,
    refreshAccessToken: async () => token,
    revokeToken: async () => undefined,
    authenticateMcpRequest: async () => ({
      userId: "user-1",
      workspaceId: "workspace-1",
      clientId: "client-public",
      role: "viewer",
      scopes: ["mcp:read"],
      audience: `${issuer}${MCP_OAUTH_RESOURCE}`,
    } satisfies OAuthPrincipal),
    createPkceChallenge: async () => challenge,
    ...overrides,
  };
}

describe("MCP workspace OAuth", () => {
  test("serves RFC metadata and protected-resource metadata", async () => {
    const handler = createMcpOAuthHandler(service(), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    const metadata = await handler(new Request(`${issuer}/.well-known/oauth-authorization-server`));
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      issuer,
      token_endpoint: `${issuer}/oauth/token`,
      code_challenge_methods_supported: ["S256"],
    });
    const resource = await handler(new Request(`${issuer}/.well-known/oauth-protected-resource`));
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({ resource: `${issuer}${MCP_OAUTH_RESOURCE}`, authorization_servers: [issuer], scopes_supported: [...MCP_OAUTH_SCOPES] });
  });

  test("advertises mcp:approve and intersects it by fresh non-hierarchical role membership", async () => {
    const metadata = createMcpOAuthService(memoryStore(), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    expect(metadata.metadata().scopes_supported).toEqual(["mcp:read", "mcp:write", "mcp:approve"]);
    expect(metadata.protectedResourceMetadata().scopes_supported).toEqual(["mcp:read", "mcp:write", "mcp:approve"]);

    const requestedScopes = [...MCP_OAUTH_SCOPES];
    const expectedByRole = {
      viewer: ["mcp:read"],
      operator: ["mcp:read", "mcp:write"],
      reviewer: ["mcp:read", "mcp:write", "mcp:approve"],
      admin: ["mcp:read", "mcp:write", "mcp:approve"],
      owner: ["mcp:read", "mcp:write", "mcp:approve"],
    } as const;
    for (const role of Object.keys(expectedByRole) as (keyof typeof expectedByRole)[]) {
      const store = memoryStore(role);
      const oauth = createMcpOAuthService(store, { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
      const client = await oauth.registerClient({
        clientName: `Role ${role}`,
        redirectUris: ["https://client.example/callback"],
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceSlug: "acme",
        allowedScopes: requestedScopes,
      });
      const consent = await oauth.beginAuthorization({
        clientId: client.clientId,
        redirectUri: "https://client.example/callback",
        state: "state",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        requestedScopes,
        resource: `${issuer}${MCP_OAUTH_RESOURCE}`,
        approved: false,
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceSlug: "acme",
        role,
      });
      expect(consent.effectiveScopes).toEqual(expectedByRole[role]);
    }
  });

  test("revalidates role membership on each authorization call", async () => {
    const store = memoryStore("admin");
    const oauth = createMcpOAuthService(store, { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    const client = await oauth.registerClient({
      clientName: "Fresh membership",
      redirectUris: ["https://client.example/callback"],
      userId: "user-1",
      workspaceId: "workspace-1",
      workspaceSlug: "acme",
      allowedScopes: [...MCP_OAUTH_SCOPES],
    });
    const input = {
      clientId: client.clientId,
      redirectUri: "https://client.example/callback",
      state: "state",
      codeChallenge: challenge,
      codeChallengeMethod: "S256" as const,
      requestedScopes: [...MCP_OAUTH_SCOPES],
      resource: `${issuer}${MCP_OAUTH_RESOURCE}`,
      approved: false,
      userId: "user-1",
      workspaceId: "workspace-1",
      workspaceSlug: "acme",
      role: "admin" as const,
    };
    expect((await oauth.beginAuthorization(input)).effectiveScopes).toEqual([...MCP_OAUTH_SCOPES]);
    store.setRole("viewer");
    expect((await oauth.beginAuthorization(input)).effectiveScopes).toEqual(["mcp:read"]);
  });

  test("revalidates approval scope against fresh bearer membership", async () => {
    const store = memoryStore("admin");
    const oauth = createMcpOAuthService(store, { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, now: () => new Date("2026-08-29T00:00:00Z") });
    const client = await oauth.registerClient({
      clientName: "Bearer membership",
      redirectUris: ["https://client.example/callback"],
      userId: "user-1",
      workspaceId: "workspace-1",
      workspaceSlug: "acme",
      allowedScopes: [...MCP_OAUTH_SCOPES],
    });
    const verifier = "verifier-that-is-long-enough-for-pkce-0123456789";
    const authorization = await oauth.beginAuthorization({
      clientId: client.clientId,
      redirectUri: "https://client.example/callback",
      state: "state",
      codeChallenge: await oauth.createPkceChallenge(verifier),
      codeChallengeMethod: "S256",
      requestedScopes: [...MCP_OAUTH_SCOPES],
      resource: `${issuer}${MCP_OAUTH_RESOURCE}`,
      approved: true,
      userId: "user-1",
      workspaceId: "workspace-1",
      workspaceSlug: "acme",
      role: "admin",
    });
    const token = await oauth.exchangeAuthorizationCode({
      clientId: client.clientId,
      code: new URL(authorization.redirect!).searchParams.get("code")!,
      redirectUri: "https://client.example/callback",
      codeVerifier: verifier,
      resource: `${issuer}${MCP_OAUTH_RESOURCE}`,
    });
    await expect(oauth.authenticateMcpRequest({ accessToken: token.accessToken, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, requiredScopes: ["mcp:approve"] }))
      .resolves.toMatchObject({ role: "admin", scopes: ["mcp:read", "mcp:write", "mcp:approve"] });
    store.setRole("operator");
    await expect(oauth.authenticateMcpRequest({ accessToken: token.accessToken, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, requiredScopes: ["mcp:approve"] }))
      .rejects.toMatchObject({ oauthCode: "insufficient_scope" });
    await expect(oauth.authenticateMcpRequest({ accessToken: token.accessToken, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, requiredScopes: ["mcp:read"] }))
      .resolves.toMatchObject({ role: "operator", scopes: ["mcp:read", "mcp:write"] });
  });

  test("requires state, exact redirect and S256 PKCE before returning consent", async () => {
    const handler = createMcpOAuthHandler(service(), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    const missingState = await handler(new Request(`${issuer}/oauth/authorize?response_type=code&client_id=client-public&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=${challenge}&code_challenge_method=S256`));
    expect(missingState.status).toBe(400);
    const unsupportedMethod = await handler(new Request(`${issuer}/oauth/authorize?response_type=code&client_id=client-public&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=s&code_challenge=${challenge}&code_challenge_method=plain`));
    expect(unsupportedMethod.status).toBe(400);
    const consent = await handler(new Request(`${issuer}/oauth/authorize?response_type=code&client_id=client-public&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=s&code_challenge=${challenge}&code_challenge_method=S256`));
    expect(consent.status).toBe(200);
    expect(await consent.json()).toMatchObject({ consentRequired: true, client: { clientId: "client-public" }, state: "s" });
  });

  test("parses mcp:approve from the OAuth authorization request", async () => {
    let parsedScopes: McpOAuthClient["allowedScopes"] | undefined;
    const base = service();
    const handler = createMcpOAuthHandler(service({
      beginAuthorization: async (input) => {
        parsedScopes = input.requestedScopes;
        return base.beginAuthorization(input);
      },
    }), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    const response = await handler(new Request(`${issuer}/oauth/authorize?response_type=code&client_id=client-public&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=s&code_challenge=${challenge}&code_challenge_method=S256&scope=mcp%3Aread+mcp%3Awrite+mcp%3Aapprove`));
    expect(response.status).toBe(200);
    expect(parsedScopes).toEqual(["mcp:read", "mcp:write", "mcp:approve"]);
  });

  test("redirects only after explicit consent and preserves state", async () => {
    const handler = createMcpOAuthHandler(service(), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    const response = await handler(new Request(`${issuer}/oauth/authorize?response_type=code&client_id=client-public&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=opaque&code_challenge=${challenge}&code_challenge_method=S256&scope=mcp%3Aread&approved=true`));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("state=opaque");
  });

  test("accepts a server-side POST decision and redirects a refusal with access_denied", async () => {
    const handler = createMcpOAuthHandler(service(), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    const body = new URLSearchParams({
      response_type: "code",
      client_id: "client-public",
      redirect_uri: "https://client.example/callback",
      state: "opaque",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "mcp:read",
      workspace_slug: "acme",
      decision: "deny",
    });
    const response = await handler(new Request(`${issuer}/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://client.example/callback?error=access_denied&state=opaque");
  });

  test("exchanges, refreshes and revokes through form-encoded OAuth endpoints", async () => {
    const calls: string[] = [];
    const handler = createMcpOAuthHandler(service({
      exchangeAuthorizationCode: async () => { calls.push("code"); return { accessToken: "a", tokenType: "Bearer", expiresIn: 300, refreshToken: "r", scope: "mcp:read" }; },
      refreshAccessToken: async () => { calls.push("refresh"); return { accessToken: "a2", tokenType: "Bearer", expiresIn: 300, refreshToken: "r2", scope: "mcp:read" }; },
      revokeToken: async () => { calls.push("revoke"); },
    }), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    const codeResponse = await handler(new Request(`${issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=authorization_code&client_id=client-public&code=code&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_verifier=verifier&resource=https%3A%2F%2Fexample.test%2Fmcp" }));
    expect(codeResponse.status).toBe(200);
    expect(await codeResponse.json()).toMatchObject({ access_token: "a", token_type: "Bearer" });
    const refreshResponse = await handler(new Request(`${issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=refresh_token&client_id=client-public&refresh_token=r&resource=https%3A%2F%2Fexample.test%2Fmcp" }));
    expect(refreshResponse.status).toBe(200);
    const revokeResponse = await handler(new Request(`${issuer}/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "token=a&client_id=client-public&token_type_hint=access_token" }));
    expect(revokeResponse.status).toBe(200);
    expect(calls).toEqual(["code", "refresh", "revoke"]);
  });

  test("rejects malformed methods and non-form token requests", async () => {
    const handler = createMcpOAuthHandler(service(), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    expect((await handler(new Request(`${issuer}/oauth/token`))).status).toBe(405);
    const malformed = await handler(new Request(`${issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(malformed.status).toBe(415);
  });

  test("accepts public HTTPS forwarded by Caddy while rejecting spoofed X-Forwarded-Proto", async () => {
    const handler = createMcpOAuthHandler(service(), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, trustedInternalHosts: ["api"] });
    const query = "response_type=code&client_id=client-public&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=s&code_challenge=" + challenge + "&code_challenge_method=S256";
    const webHop = await handler(new Request(`http://api:3001/oauth/authorize?${query}`, {
      headers: { host: "example.test" },
    }));
    expect(webHop.status).toBe(200);
    const forwarded = await handler(new Request(`http://api:3001/oauth/authorize?${query}`, {
      headers: { host: "example.test", "x-noosphere-forwarded-proto": "https" },
    }));
    expect(forwarded.status).toBe(200);
    const publicDirect = await handler(new Request(`http://example.test/oauth/authorize?${query}`, {
      headers: { host: "example.test" },
    }));
    expect(publicDirect.status).toBe(400);
    const spoofed = await handler(new Request(`http://api:3001/oauth/authorize?${query}`, {
      headers: { host: "example.test", "x-forwarded-proto": "https" },
    }));
    expect(spoofed.status).toBe(400);
  });

  test("returns 413 before parsing oversized OAuth bodies, including streaming bodies", async () => {
    let exchangeCalls = 0;
    const handler = createMcpOAuthHandler(service({ exchangeAuthorizationCode: async () => { exchangeCalls += 1; return { accessToken: "a", tokenType: "Bearer", expiresIn: 300, scope: "mcp:read" }; } }), { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    const body = new URLSearchParams({ grant_type: "authorization_code", client_id: "client-public", code: "x", redirect_uri: "https://client.example/callback", code_verifier: "verifier", resource: `${issuer}${MCP_OAUTH_RESOURCE}`, padding: "x".repeat(MCP_OAUTH_MAX_BODY_BYTES) });
    const byLength = await handler(new Request(`${issuer}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.toString().length) },
      body,
    }));
    expect(byLength.status).toBe(413);
    const authorizeBody = "response_type=code&client_id=client-public&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=s&code_challenge=" + challenge + "&code_challenge_method=S256&padding=" + "x".repeat(MCP_OAUTH_MAX_BODY_BYTES);
    const authorize = await handler(new Request(`${issuer}/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(authorizeBody.length) },
      body: authorizeBody,
    }));
    expect(authorize.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MCP_OAUTH_MAX_BODY_BYTES + 1));
        controller.close();
      },
    });
    const byStream = await handler(new Request(`${issuer}/oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: stream,
    }));
    expect(byStream.status).toBe(413);
    expect(exchangeCalls).toBe(0);
  });

  test("uses the distributed limiter contract and returns stable Retry-After", async () => {
    const requests: Array<{ key: string; limit: number; windowSeconds: number }> = [];
    const handler = createMcpOAuthHandler(service(), {
      issuer,
      resource: `${issuer}${MCP_OAUTH_RESOURCE}`,
      trustedInternalHosts: ["api"],
      rateLimiter: {
        async consume(input) {
          requests.push(input);
          return { allowed: !input.key.includes(":client:client-public:"), retryAfterSeconds: 9 };
        },
      },
    });
    const response = await handler(new Request("http://api:3001/oauth/token", {
      method: "POST",
      headers: { host: "example.test", "content-type": "application/x-www-form-urlencoded", "x-noosphere-client-ip": "203.0.113.9" },
      body: "grant_type=refresh_token&client_id=client-public&refresh_token=r&resource=https%3A%2F%2Fexample.test%2Fmcp",
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("9");
    expect(await response.json()).toEqual({ error: "rate_limited", error_description: "Too many requests" });
    expect(requests[0]).toMatchObject({ limit: 30, windowSeconds: 60 });
    expect(requests[0]?.key).toContain(":source:");
    expect(requests[0]?.key).toContain("203.0.113.9");
    expect(requests[1]?.key).toContain("client-public");
  });

  test("exhausts a source bucket even when client ids rotate", async () => {
    const counts = new Map<string, number>();
    let exchangeCalls = 0;
    const handler = createMcpOAuthHandler(service({ exchangeAuthorizationCode: async () => { exchangeCalls += 1; return { accessToken: "a", tokenType: "Bearer", expiresIn: 300, scope: "mcp:read" }; } }), {
      issuer,
      resource: `${issuer}${MCP_OAUTH_RESOURCE}`,
      trustedInternalHosts: ["api"],
      rateLimiter: {
        async consume(input) {
          const count = (counts.get(input.key) ?? 0) + 1;
          counts.set(input.key, count);
          return { allowed: count <= 2, retryAfterSeconds: count > 2 ? 11 : 0 };
        },
      },
    });
    const request = (clientId: string) => handler(new Request("http://api:3001/oauth/token", {
      method: "POST",
      headers: { host: "example.test", "content-type": "application/x-www-form-urlencoded", "x-noosphere-client-ip": "203.0.113.10" },
      body: `grant_type=authorization_code&client_id=${clientId}&code=code&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_verifier=verifier&resource=https%3A%2F%2Fexample.test%2Fmcp`,
    }));
    expect((await request("random-client-1")).status).toBe(200);
    expect((await request("random-client-2")).status).toBe(200);
    const blocked = await request("random-client-3");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("11");
    expect(exchangeCalls).toBe(2);
    const sourceKeys = [...counts.keys()].filter((key) => key.includes(":source:"));
    expect(sourceKeys).toHaveLength(1);
  });

  test("issues one-use PKCE codes and audience-bound opaque tokens", async () => {
    const store = memoryStore();
    const oauth = createMcpOAuthService(store, { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, now: () => new Date("2026-08-29T00:00:00Z") });
    const registered = await oauth.registerClient({ clientName: "PKCE", redirectUris: ["https://client.example/callback"], userId: "user-1", workspaceId: "workspace-1", workspaceSlug: "acme" });
    const verifier = "verifier-that-is-long-enough-for-pkce-0123456789";
    const challengeValue = await oauth.createPkceChallenge(verifier);
    const authorization = await oauth.beginAuthorization({ clientId: registered.clientId, redirectUri: "https://client.example/callback", state: "state", codeChallenge: challengeValue, codeChallengeMethod: "S256", requestedScopes: ["mcp:read"], resource: `${issuer}${MCP_OAUTH_RESOURCE}`, approved: true, userId: "user-1", workspaceId: "workspace-1", workspaceSlug: "acme", role: "viewer" });
    const code = new URL(authorization.redirect!).searchParams.get("code")!;
    const token = await oauth.exchangeAuthorizationCode({ clientId: registered.clientId, code, redirectUri: "https://client.example/callback", codeVerifier: verifier, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    expect(token.accessToken).not.toBe(code);
    expect(token.scope).toBe("mcp:read");
    await expect(oauth.exchangeAuthorizationCode({ clientId: registered.clientId, code, redirectUri: "https://client.example/callback", codeVerifier: verifier, resource: `${issuer}${MCP_OAUTH_RESOURCE}` })).rejects.toMatchObject({ oauthCode: "invalid_grant" });
    const principal = await oauth.authenticateMcpRequest({ accessToken: token.accessToken, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, requiredScopes: ["mcp:read"] });
    expect(principal).toMatchObject({ userId: "user-1", workspaceId: "workspace-1", role: "viewer", clientId: registered.clientId });
  });

  test("rotates refresh tokens and revokes a reused family", async () => {
    const store = memoryStore();
    const oauth = createMcpOAuthService(store, { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, now: () => new Date("2026-08-29T00:00:00Z") });
    const registered = await oauth.registerClient({ clientName: "Refresh", redirectUris: ["https://client.example/callback"], userId: "user-1", workspaceId: "workspace-1", workspaceSlug: "acme" });
    const verifier = "verifier-that-is-long-enough-for-pkce-0123456789";
    const authorization = await oauth.beginAuthorization({ clientId: registered.clientId, redirectUri: "https://client.example/callback", state: "state", codeChallenge: await oauth.createPkceChallenge(verifier), codeChallengeMethod: "S256", requestedScopes: ["mcp:read"], resource: `${issuer}${MCP_OAUTH_RESOURCE}`, approved: true, userId: "user-1", workspaceId: "workspace-1", workspaceSlug: "acme", role: "viewer" });
    const code = new URL(authorization.redirect!).searchParams.get("code")!;
    const first = await oauth.exchangeAuthorizationCode({ clientId: registered.clientId, code, redirectUri: "https://client.example/callback", codeVerifier: verifier, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    const second = await oauth.refreshAccessToken({ clientId: registered.clientId, refreshToken: first.refreshToken!, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(oauth.refreshAccessToken({ clientId: registered.clientId, refreshToken: first.refreshToken!, resource: `${issuer}${MCP_OAUTH_RESOURCE}` })).rejects.toMatchObject({ oauthCode: "invalid_grant" });
    await expect(oauth.authenticateMcpRequest({ accessToken: second.accessToken, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, requiredScopes: ["mcp:read"] })).rejects.toMatchObject({ oauthCode: "invalid_token" });

    // A fresh service instance must observe the durable family revocation; it
    // cannot rely on process-local refresh/access maps.
    const restarted = createMcpOAuthService(store, { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, now: () => new Date("2026-08-29T00:00:00Z") });
    await expect(restarted.authenticateMcpRequest({ accessToken: second.accessToken, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, requiredScopes: ["mcp:read"] })).rejects.toMatchObject({ oauthCode: "invalid_token" });
  });

  test("uses an atomic rotation port so a concurrent loser cannot revoke the winner", async () => {
    const store = memoryStore() as AtomicMemoryStore;
    const oauth = createMcpOAuthService(store, { issuer, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, now: () => new Date("2026-08-29T00:00:00Z") });
    const registered = await oauth.registerClient({ clientName: "Concurrent Refresh", redirectUris: ["https://client.example/callback"], userId: "user-1", workspaceId: "workspace-1", workspaceSlug: "acme" });
    const verifier = "verifier-that-is-long-enough-for-pkce-0123456789";
    const authorization = await oauth.beginAuthorization({ clientId: registered.clientId, redirectUri: "https://client.example/callback", state: "state", codeChallenge: await oauth.createPkceChallenge(verifier), codeChallengeMethod: "S256", requestedScopes: ["mcp:read"], resource: `${issuer}${MCP_OAUTH_RESOURCE}`, approved: true, userId: "user-1", workspaceId: "workspace-1", workspaceSlug: "acme", role: "viewer" });
    const code = new URL(authorization.redirect!).searchParams.get("code")!;
    const issued = await oauth.exchangeAuthorizationCode({ clientId: registered.clientId, code, redirectUri: "https://client.example/callback", codeVerifier: verifier, resource: `${issuer}${MCP_OAUTH_RESOURCE}` });

    let rotationCalls = 0;
    store.rotateRefreshToken = async (input) => {
      rotationCalls += 1;
      if (rotationCalls > 1) return { status: "concurrent" };
      const current = await store.findRefreshToken(input.tokenHash);
      if (!current) return { status: "missing" };
      const tokens = await input.createTokens(current, { role: "viewer" });
      await store.insertAccessToken(tokens.accessToken);
      if (await store.replaceRefreshToken(input.tokenHash, input.now, tokens.refreshToken) !== "rotated") return { status: "replayed" };
      return { status: "rotated", tokens };
    };

    const outcomes = await Promise.allSettled([
      oauth.refreshAccessToken({ clientId: registered.clientId, refreshToken: issued.refreshToken!, resource: `${issuer}${MCP_OAUTH_RESOURCE}` }),
      oauth.refreshAccessToken({ clientId: registered.clientId, refreshToken: issued.refreshToken!, resource: `${issuer}${MCP_OAUTH_RESOURCE}` }),
    ]);
    const winner = outcomes.find((result): result is PromiseFulfilledResult<OAuthTokenResponse> => result.status === "fulfilled")?.value;
    const loser = outcomes.find((result) => result.status === "rejected");
    expect(rotationCalls).toBe(2);
    expect(winner?.accessToken).toBeDefined();
    expect(loser?.status).toBe("rejected");
    await expect(oauth.authenticateMcpRequest({ accessToken: winner!.accessToken, resource: `${issuer}${MCP_OAUTH_RESOURCE}`, requiredScopes: ["mcp:read"] })).resolves.toMatchObject({ userId: "user-1" });
  });
});

type AtomicMemoryStore = McpOAuthStore & {
  rotateRefreshToken: (input: {
    readonly tokenHash: string;
    readonly clientId: string;
    readonly audience: string;
    readonly now: Date;
    readonly createTokens: (record: McpOAuthRefreshToken, membership: { readonly role: OAuthPrincipal["role"] }) => Promise<{
      readonly response: OAuthTokenResponse;
      readonly accessToken: McpOAuthAccessToken;
      readonly refreshToken: McpOAuthRefreshToken;
    }>;
  }) => Promise<{ readonly status: "rotated"; readonly tokens: { readonly response: OAuthTokenResponse; readonly accessToken: McpOAuthAccessToken; readonly refreshToken: McpOAuthRefreshToken } } | { readonly status: "concurrent" | "replayed" | "missing" }>;
};

function memoryStore(initialRole: OAuthPrincipal["role"] = "viewer"): McpOAuthStore & { setRole: (role: OAuthPrincipal["role"]) => void } {
  const clients = new Map<string, McpOAuthClient>();
  const codes = new Map<string, McpOAuthAuthorizationCode>();
  const access = new Map<string, McpOAuthAccessToken>();
  const refresh = new Map<string, McpOAuthRefreshToken>();
  const revokedFamilies = new Set<string>();
  let role = initialRole;
  return {
    async findClient(clientId) { return clients.get(clientId) ?? null; },
    async insertClient(client) { clients.set(client.clientId, client); },
    async insertAuthorizationCode(code) { codes.set(code.codeHash, code); },
    async consumeAuthorizationCode(codeHash, now) {
      const code = codes.get(codeHash);
      if (!code || code.consumedAt || code.expiresAt <= now) return null;
      const consumed = { ...code, consumedAt: now };
      codes.set(codeHash, consumed);
      return consumed;
    },
    async insertAccessToken(token) { access.set(token.tokenHash, token); },
    async findAccessToken(tokenHash) { return access.get(tokenHash) ?? null; },
    async isTokenFamilyRevoked(familyId) { return revokedFamilies.has(familyId); },
    async rotateRefreshToken(input) {
      const current = refresh.get(input.tokenHash);
      if (!current) return { status: "missing" };
      if (current.clientId !== input.clientId || current.audience !== input.audience || current.revokedAt || current.expiresAt <= input.now) return { status: "invalid" };
      if (current.rotatedAt) return { status: "replayed" };
      const membership = await this.findActiveMembership(current.userId, current.workspaceId);
      if (!membership) return { status: "invalid" };
      const tokens = await input.createTokens(current, membership);
      const result = await this.replaceRefreshToken(input.tokenHash, input.now, tokens.refreshToken);
      if (result !== "rotated") return { status: "replayed" };
      await this.insertAccessToken(tokens.accessToken);
      return { status: "rotated", tokens };
    },
    async insertRefreshToken(token) { refresh.set(token.tokenHash, token); },
    async findRefreshToken(tokenHash) { return refresh.get(tokenHash) ?? null; },
    async replaceRefreshToken(tokenHash, now, replacement) {
      const current = refresh.get(tokenHash);
      if (!current) return "missing";
      if (current.rotatedAt || current.revokedAt || current.expiresAt <= now) return "reused";
      refresh.set(tokenHash, { ...current, rotatedAt: now });
      refresh.set(replacement.tokenHash, replacement);
      return "rotated";
    },
    async revokeRefreshFamily(familyId, now) {
      revokedFamilies.add(familyId);
      for (const [hash, token] of refresh) if (token.familyId === familyId) refresh.set(hash, { ...token, revokedAt: now });
    },
    async revokeToken(tokenHash, now) {
      const accessToken = access.get(tokenHash);
      if (accessToken) access.set(tokenHash, { ...accessToken, revokedAt: now });
      const refreshToken = refresh.get(tokenHash);
      if (refreshToken) refresh.set(tokenHash, { ...refreshToken, revokedAt: now });
    },
    async findActiveMembership(userId, workspaceId) { return userId === "user-1" && workspaceId === "workspace-1" ? { role, workspaceSlug: "acme" } : null; },
    async audit() { return undefined; },
    setRole(nextRole) { role = nextRole; },
  };
}
