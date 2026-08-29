import type { WorkspaceRole } from "@outbound/interface/http/request-context";

export const MCP_OAUTH_RESOURCE = "/mcp";
export const MCP_OAUTH_SCOPES = ["mcp:read", "mcp:write", "mcp:approve"] as const;
/** Strict upper bound for OAuth form bodies (well below the API upload limit). */
export const MCP_OAUTH_MAX_BODY_BYTES = 16 * 1024;
export const MCP_OAUTH_FORWARDED_PROTO_HEADER = "x-noosphere-forwarded-proto";
export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

export interface McpOAuthRateLimitRequest {
  readonly key: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface McpOAuthRateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/** Distributed limiter port; production wiring must provide a durable implementation. */
export interface McpOAuthRateLimiter {
  consume(input: McpOAuthRateLimitRequest): Promise<McpOAuthRateLimitResult>;
}

export interface McpOAuthClient {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly allowedScopes: readonly McpOAuthScope[];
}

export interface OAuthPrincipal {
  readonly userId: string;
  readonly workspaceId: string;
  readonly clientId: string;
  readonly role: WorkspaceRole;
  readonly scopes: readonly McpOAuthScope[];
  readonly audience: string;
}

export interface OAuthTokenResponse {
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number;
  readonly refreshToken?: string;
  readonly scope: string;
}

export interface OAuthAuthorizeContext {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
  readonly requestedScopes: readonly McpOAuthScope[];
  readonly resource: string;
  readonly approved: boolean;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly workspaceSlug?: string;
  readonly role?: WorkspaceRole;
}

export interface OAuthAuthorizationResult {
  readonly client: McpOAuthClient;
  readonly effectiveScopes: readonly McpOAuthScope[];
  readonly consentRequired?: true;
  readonly redirect?: string;
}

export interface OAuthAuthorizationServerMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly revocation_endpoint: string;
  readonly response_types_supported: readonly ["code"];
  readonly grant_types_supported: readonly ["authorization_code", "refresh_token"];
  readonly code_challenge_methods_supported: readonly ["S256"];
  readonly token_endpoint_auth_methods_supported: readonly ["none"];
  readonly scopes_supported: readonly McpOAuthScope[];
}

export interface OAuthProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly scopes_supported: readonly McpOAuthScope[];
  readonly bearer_methods_supported: readonly ["header"];
}

export interface McpOAuthAuthorizationCode {
  readonly id: string;
  readonly codeHash: string;
  readonly clientId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
  readonly scopes: readonly McpOAuthScope[];
  readonly resource: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface McpOAuthAccessToken {
  readonly id: string;
  readonly tokenHash: string;
  readonly familyId: string;
  readonly clientId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly scopes: readonly McpOAuthScope[];
  readonly audience: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface McpOAuthRefreshToken {
  readonly id: string;
  readonly tokenHash: string;
  readonly familyId: string;
  readonly clientId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly scopes: readonly McpOAuthScope[];
  readonly audience: string;
  readonly expiresAt: Date;
  readonly rotatedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface McpOAuthStore {
  findClient(clientId: string): Promise<McpOAuthClient | null>;
  insertClient(client: McpOAuthClient): Promise<void>;
  insertAuthorizationCode(code: McpOAuthAuthorizationCode): Promise<void>;
  consumeAuthorizationCode(codeHash: string, now: Date): Promise<McpOAuthAuthorizationCode | null>;
  insertAccessToken(token: McpOAuthAccessToken): Promise<void>;
  findAccessToken(tokenHash: string): Promise<McpOAuthAccessToken | null>;
  insertRefreshToken(token: McpOAuthRefreshToken): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<McpOAuthRefreshToken | null>;
  replaceRefreshToken(tokenHash: string, now: Date, replacement: McpOAuthRefreshToken): Promise<"rotated" | "reused" | "missing">;
  revokeRefreshFamily(familyId: string, now: Date): Promise<void>;
  revokeToken(tokenHash: string, now: Date): Promise<void>;
  findActiveMembership(userId: string, workspaceId: string): Promise<{ readonly role: WorkspaceRole; readonly workspaceSlug: string } | null>;
  audit(input: { readonly action: string; readonly clientId?: string; readonly userId?: string; readonly workspaceId?: string; readonly subjectId?: string }): Promise<void>;
}

export interface McpOAuthServiceOptions {
  readonly issuer: string;
  readonly resource: string;
  readonly now?: () => Date;
  readonly authorizationCodeTtlSeconds?: number;
  readonly accessTokenTtlSeconds?: number;
  readonly refreshTokenTtlSeconds?: number;
}

export interface McpOAuthService {
  metadata(): OAuthAuthorizationServerMetadata;
  protectedResourceMetadata(): OAuthProtectedResourceMetadata;
  registerClient(input: {
    readonly clientName: string;
    readonly redirectUris: readonly string[];
    readonly userId: string;
    readonly workspaceId: string;
    readonly workspaceSlug: string;
    readonly allowedScopes?: readonly McpOAuthScope[];
  }): Promise<McpOAuthClient>;
  beginAuthorization(input: OAuthAuthorizeContext): Promise<OAuthAuthorizationResult>;
  exchangeAuthorizationCode(input: {
    readonly clientId: string;
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
    readonly resource: string;
  }): Promise<OAuthTokenResponse>;
  refreshAccessToken(input: {
    readonly clientId: string;
    readonly refreshToken: string;
    readonly resource: string;
  }): Promise<OAuthTokenResponse>;
  revokeToken(input: {
    readonly clientId?: string;
    readonly token: string;
    readonly tokenTypeHint?: string;
  }): Promise<void>;
  authenticateMcpRequest(input: {
    readonly accessToken: string;
    readonly resource: string;
    readonly requiredScopes?: readonly McpOAuthScope[];
  }): Promise<OAuthPrincipal>;
  createPkceChallenge(verifier: string): Promise<string>;
}

export interface McpOAuthHandlerOptions {
  readonly issuer: string;
  readonly resource: string;
  readonly allowedHosts?: readonly string[];
  /** Private service hostnames allowed to arrive over the internal HTTP hop. */
  readonly trustedInternalHosts?: readonly string[];
  readonly rateLimiter?: McpOAuthRateLimiter;
  readonly resolveUserContext?: (
    request: Request,
    workspaceSlug: string,
  ) => Promise<Pick<OAuthAuthorizeContext, "userId" | "workspaceId" | "workspaceSlug" | "role"> | null>;
}

export class McpOAuthError extends Error {
  constructor(
    readonly status: number,
    readonly oauthCode: string,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "McpOAuthError";
  }
}

export function createMcpOAuthHandler(
  service: McpOAuthService,
  options: McpOAuthHandlerOptions,
): (request: Request) => Promise<Response> {
  const issuer = new URL(options.issuer).origin;
  const resource = new URL(options.resource).toString().replace(/\/$/, "");
  const allowedHosts = new Set((options.allowedHosts ?? [new URL(issuer).host]).map((host) => normalizeHost(host)));
  const trustedInternalHosts = normalizeHosts(options.trustedInternalHosts ?? []);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!isAllowedHost(request, url, allowedHosts)) return oauthError(403, "access_denied", "OAuth host is not allowed");
    try {
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return json(service.metadata());
      }
      if (
        url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === `/.well-known/oauth-protected-resource${MCP_OAUTH_RESOURCE}`
      ) {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return json(service.protectedResourceMetadata());
      }
      if (url.pathname === "/oauth/authorize") return await handleAuthorize(request, url);
      if (url.pathname === "/oauth/token") return await handleToken(request, resource);
      if (url.pathname === "/oauth/revoke") return await handleRevoke(request);
      return oauthError(404, "not_found", "OAuth endpoint not found");
    } catch (error) {
      if (error instanceof McpOAuthError) return oauthError(error.status, error.oauthCode, error.message, error.headers);
      return oauthError(500, "server_error", "OAuth request failed");
    }
  };

  async function handleAuthorize(request: Request, url: URL): Promise<Response> {
    if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed("GET, POST");
    assertSecureAuthorizationRequest(request, url, trustedInternalHosts);
    const form = request.method === "POST" ? await readForm(request) : null;
    const parameters = form ?? url.searchParams;
    await enforceSourceRateLimit("authorize", request);
    const required = (name: string): string => {
      const value = parameters.get(name)?.trim();
      if (!value) throw invalidRequest(`${name} is required`);
      return value;
    };
    const responseType = required("response_type");
    if (responseType !== "code") throw invalidRequest("response_type must be code");
    const clientId = required("client_id");
    const redirectUri = required("redirect_uri");
    const state = required("state");
    if (state.length > 512) throw invalidRequest("state is too long");
    const codeChallenge = required("code_challenge");
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) throw invalidRequest("code_challenge must be base64url");
    if (parameters.get("code_challenge_method") !== "S256") throw invalidRequest("code_challenge_method must be S256");
    const requestedScopes = parseScopes(parameters.get("scope"));
    const workspaceSlug = parameters.get("workspace_slug") ?? parameters.get("workspace") ?? "";
    const userContext = options.resolveUserContext
      ? workspaceSlug
        ? await options.resolveUserContext(request, workspaceSlug)
        : null
      : null;
    if (options.resolveUserContext && !userContext) throw new McpOAuthError(401, "login_required", "An active workspace session is required");
    await enforceUserRateLimit("authorize", userContext?.userId);
    await enforceClientRateLimit("authorize", request, parameters, userContext?.userId);
    const result = await service.beginAuthorization({
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
      requestedScopes,
      resource: parameters.get("resource") ?? resource,
      approved: request.method === "POST"
        ? parameters.get("decision") === "approve"
        : parameters.get("approved") === "true",
      ...userContext,
    });
    if (result.redirect) return new Response(null, { status: 302, headers: { location: result.redirect } });
    if (request.method === "POST") {
      if (parameters.get("decision") !== "deny") throw invalidRequest("decision must be approve or deny");
      const refusal = new URL(redirectUri);
      refusal.searchParams.set("error", "access_denied");
      refusal.searchParams.set("state", state);
      return new Response(null, { status: 302, headers: { location: refusal.toString() } });
    }
    return json({
      consentRequired: true,
      client: {
        clientId: result.client.clientId,
        clientName: result.client.clientName,
        redirectUri,
        workspaceSlug: result.client.workspaceSlug,
      },
      requestedScopes,
      effectiveScopes: result.effectiveScopes,
      state,
    });
  }

  async function handleToken(request: Request, expectedResource: string): Promise<Response> {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const form = await readForm(request);
    await enforceSourceRateLimit("token", request);
    await enforceClientRateLimit("token", request, form);
    const grantType = requiredForm(form, "grant_type");
    const clientId = requiredForm(form, "client_id");
    const requestedResource = requiredForm(form, "resource");
    if (requestedResource !== expectedResource) throw invalidGrant("resource audience mismatch");
    const token = grantType === "authorization_code"
      ? await service.exchangeAuthorizationCode({
        clientId,
        code: requiredForm(form, "code"),
        redirectUri: requiredForm(form, "redirect_uri"),
        codeVerifier: requiredForm(form, "code_verifier"),
        resource: requestedResource,
      })
      : grantType === "refresh_token"
        ? await service.refreshAccessToken({ clientId, refreshToken: requiredForm(form, "refresh_token"), resource: requestedResource })
        : (() => { throw invalidGrant("unsupported grant_type"); })();
    return json({
      access_token: token.accessToken,
      token_type: token.tokenType,
      expires_in: token.expiresIn,
      ...(token.refreshToken ? { refresh_token: token.refreshToken } : {}),
      scope: token.scope,
    });
  }

  async function handleRevoke(request: Request): Promise<Response> {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const form = await readForm(request);
    await enforceSourceRateLimit("revoke", request);
    await enforceClientRateLimit("revoke", request, form);
    await service.revokeToken({
      ...(form.get("client_id") ? { clientId: form.get("client_id")! } : {}),
      token: requiredForm(form, "token"),
      ...(form.get("token_type_hint") ? { tokenTypeHint: form.get("token_type_hint")! } : {}),
    });
    return new Response(null, { status: 200 });
  }

  async function enforceSourceRateLimit(
    endpoint: "authorize" | "token" | "revoke",
    request: Request,
  ): Promise<void> {
    if (!options.rateLimiter) return;
    const result = await options.rateLimiter.consume({
      key: `mcp-oauth:${endpoint}:source:ip:${clientIp(request, trustedInternalHosts)}`,
      limit: endpoint === "authorize" ? 20 : 30,
      windowSeconds: 60,
    });
    if (!result.allowed) throw rateLimitError(result.retryAfterSeconds);
  }

  async function enforceClientRateLimit(
    endpoint: "authorize" | "token" | "revoke",
    request: Request,
    parameters: URLSearchParams,
    userId?: string,
  ): Promise<void> {
    if (!options.rateLimiter) return;
    const clientId = parameters.get("client_id")?.trim() || "anonymous";
    const identity = userId ? `user:${userId}` : `ip:${clientIp(request, trustedInternalHosts)}`;
    const result = await options.rateLimiter.consume({
      key: `mcp-oauth:${endpoint}:client:${clientId}:${identity}`,
      limit: endpoint === "authorize" ? 20 : 30,
      windowSeconds: 60,
    });
    if (!result.allowed) throw rateLimitError(result.retryAfterSeconds);
  }

  async function enforceUserRateLimit(
    endpoint: "authorize" | "token" | "revoke",
    userId?: string,
  ): Promise<void> {
    if (!options.rateLimiter || !userId) return;
    const result = await options.rateLimiter.consume({
      key: `mcp-oauth:${endpoint}:user:${userId}`,
      limit: endpoint === "authorize" ? 20 : 30,
      windowSeconds: 60,
    });
    if (!result.allowed) throw rateLimitError(result.retryAfterSeconds);
  }
}

function parseScopes(value: string | null): readonly McpOAuthScope[] {
  const scopes = (value ?? "mcp:read").split(/[\t ]+/).filter(Boolean);
  const unique = [...new Set(scopes)];
  if (unique.some((scope) => !MCP_OAUTH_SCOPES.includes(scope as McpOAuthScope))) throw invalidRequest("scope is not supported");
  return unique as McpOAuthScope[];
}

async function readForm(request: Request, maxBodyBytes = MCP_OAUTH_MAX_BODY_BYTES): Promise<URLSearchParams> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    throw new McpOAuthError(415, "invalid_request", "OAuth endpoints require form encoding");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength.trim())) throw invalidRequest("Content-Length is invalid");
    if (Number(contentLength) > maxBodyBytes) throw bodyTooLarge(maxBodyBytes);
  }
  try {
    const reader = request.body?.getReader();
    if (!reader) return new URLSearchParams();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > maxBodyBytes) {
          await reader.cancel();
          throw bodyTooLarge(maxBodyBytes);
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return new URLSearchParams(text);
  } catch (error) {
    if (error instanceof McpOAuthError) throw error;
    throw invalidRequest("Malformed form body");
  }
}

function requiredQuery(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) throw invalidRequest(`${name} is required`);
  return value;
}

function requiredForm(form: URLSearchParams, name: string): string {
  const value = form.get(name)?.trim();
  if (!value) throw invalidRequest(`${name} is required`);
  return value;
}

function assertSecureAuthorizationRequest(request: Request, url: URL, trustedInternalHosts: ReadonlySet<string>): void {
  const forwardedProtocol = request.headers.get(MCP_OAUTH_FORWARDED_PROTO_HEADER)?.trim().toLowerCase();
  if (forwardedProtocol !== undefined && forwardedProtocol !== "http" && forwardedProtocol !== "https") throw invalidRequest("Forwarded protocol is invalid");
  if (forwardedProtocol === undefined && request.headers.has("x-forwarded-proto")) throw invalidRequest("Untrusted forwarded protocol");
  const isTrustedInternalHost = trustedInternalHosts.has(url.hostname.toLowerCase()) || trustedInternalHosts.has(url.host.toLowerCase());
  const protocol = forwardedProtocol ? `${forwardedProtocol}:` : url.protocol;
  if (protocol === "https:" && (url.protocol === "https:" || isTrustedInternalHost)) return;
  if (!forwardedProtocol && isTrustedInternalHost && url.protocol === "http:") return;
  if (!forwardedProtocol && protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")) return;
  throw invalidRequest("Authorization endpoints require HTTPS (except localhost)");
}

function clientIp(request: Request, trustedInternalHosts: ReadonlySet<string>): string {
  const value = request.headers.get("x-noosphere-client-ip")?.trim();
  if (!value) return "unknown";
  const url = new URL(request.url);
  const internal = trustedInternalHosts.has(url.hostname.toLowerCase()) || trustedInternalHosts.has(url.host.toLowerCase());
  return internal ? value : "unknown";
}

function bodyTooLarge(maxBodyBytes: number): McpOAuthError {
  return new McpOAuthError(413, "request_entity_too_large", `OAuth request body exceeds ${maxBodyBytes} bytes`);
}

function rateLimitError(retryAfterSeconds: number): McpOAuthError {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  return new McpOAuthError(429, "rate_limited", "Too many requests", { "retry-after": String(retryAfter) });
}

function normalizeHost(value: string): string {
  try { return new URL(value).host.toLowerCase(); } catch { return value.trim().toLowerCase(); }
}

function normalizeHosts(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map((value) => normalizeHost(value)).filter(Boolean));
}

function isAllowedHost(request: Request, url: URL, allowedHosts: ReadonlySet<string>): boolean {
  const supplied = request.headers.get("host");
  return allowedHosts.has(normalizeHost(supplied ?? url.host));
}

function invalidRequest(message: string): McpOAuthError {
  return new McpOAuthError(400, "invalid_request", message);
}

function invalidGrant(message: string): McpOAuthError {
  return new McpOAuthError(400, "invalid_grant", message);
}

function methodNotAllowed(method: string): Response {
  return new Response(null, { status: 405, headers: { allow: method } });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function oauthError(status: number, code: string, description: string, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify({ error: code, error_description: description }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/**
 * Compose the protocol-level OAuth service around a durable store. Secrets are
 * generated only in memory and persisted as SHA-256 digests; the store never
 * receives bearer values or PKCE verifiers.
 */
export function createMcpOAuthService(
  store: McpOAuthStore,
  options: McpOAuthServiceOptions,
): McpOAuthService {
  const issuer = new URL(options.issuer).origin;
  const resource = canonicalResource(options.resource);
  const now = options.now ?? (() => new Date());
  const codeTtl = positiveTtl(options.authorizationCodeTtlSeconds, 300);
  const accessTtl = positiveTtl(options.accessTokenTtlSeconds, 300);
  const refreshTtl = positiveTtl(options.refreshTokenTtlSeconds, 2_592_000);
  const accessFamilies = new Map<string, string>();
  const revokedFamilies = new Set<string>();

  const service: McpOAuthService = {
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
      resource,
      authorization_servers: [issuer],
      scopes_supported: [...MCP_OAUTH_SCOPES],
      bearer_methods_supported: ["header"],
    }),
    registerClient: async (input) => {
      const clientName = input.clientName.trim();
      if (!clientName || clientName.length > 200) throw invalidRequest("client_name is invalid");
      const redirectUris = [...new Set(input.redirectUris.map((uri) => validateRedirectUri(uri)))];
      if (redirectUris.length === 0) throw invalidRequest("redirect_uris is required");
      const allowedScopes = normalizeScopes(input.allowedScopes ?? ["mcp:read"]);
      const membership = await store.findActiveMembership(input.userId, input.workspaceId);
      if (!membership || membership.workspaceSlug !== input.workspaceSlug) throw new McpOAuthError(403, "access_denied", "Workspace membership is inactive");
      const client: McpOAuthClient = {
        id: crypto.randomUUID(),
        clientId: await randomOpaque(),
        clientName,
        redirectUris,
        userId: input.userId,
        workspaceId: input.workspaceId,
        workspaceSlug: input.workspaceSlug,
        allowedScopes,
      };
      await store.insertClient(client);
      await audit({ action: "mcp_oauth_client_registered", clientId: client.clientId, userId: client.userId, workspaceId: client.workspaceId });
      return client;
    },
    beginAuthorization: async (input) => {
      const client = await store.findClient(input.clientId);
      if (!client) throw invalidGrant("unknown client");
      if (!client.redirectUris.includes(input.redirectUri)) throw invalidGrant("redirect_uri does not match client registration");
      if (canonicalResource(input.resource) !== resource) throw invalidGrant("resource audience mismatch");
      if (!input.userId || !input.workspaceId || !input.workspaceSlug || !input.role) {
        throw new McpOAuthError(401, "login_required", "An active workspace session is required");
      }
      if (input.userId !== client.userId || input.workspaceId !== client.workspaceId || input.workspaceSlug !== client.workspaceSlug) {
        throw new McpOAuthError(403, "access_denied", "Client is not registered for this workspace");
      }
      const membership = await store.findActiveMembership(input.userId, input.workspaceId);
      if (!membership || membership.workspaceSlug !== client.workspaceSlug) throw new McpOAuthError(403, "access_denied", "Workspace membership is inactive");
      const effectiveScopes = intersectScopes(input.requestedScopes, client.allowedScopes, roleScopes(membership.role));
      if (effectiveScopes.length === 0) throw new McpOAuthError(403, "invalid_scope", "Requested scope is not permitted");
      if (!input.approved) return { client, effectiveScopes, consentRequired: true };
      const code = await randomOpaque();
      const codeHash = await hashOpaque(code);
      await store.insertAuthorizationCode({
        id: crypto.randomUUID(),
        codeHash,
        clientId: client.clientId,
        userId: client.userId,
        workspaceId: client.workspaceId,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: "S256",
        scopes: effectiveScopes,
        resource,
        expiresAt: new Date(now().getTime() + codeTtl * 1000),
        consumedAt: null,
      });
      const redirect = new URL(input.redirectUri);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", input.state);
      await audit({ action: "mcp_oauth_authorization_granted", clientId: client.clientId, userId: client.userId, workspaceId: client.workspaceId });
      return { client, effectiveScopes, redirect: redirect.toString() };
    },
    exchangeAuthorizationCode: async (input) => {
      const client = await store.findClient(input.clientId);
      if (!client) throw invalidGrant("unknown client");
      const codeHash = await hashOpaque(input.code);
      const record = await store.consumeAuthorizationCode(codeHash, now());
      if (!record || record.clientId !== client.clientId || record.redirectUri !== input.redirectUri || record.resource !== resource) throw invalidGrant("authorization code is invalid or expired");
      if (record.codeChallengeMethod !== "S256" || !(await safeEqual(record.codeChallenge, await createPkceChallenge(input.codeVerifier)))) throw invalidGrant("PKCE verification failed");
      const membership = await store.findActiveMembership(record.userId, record.workspaceId);
      if (!membership) throw invalidGrant("workspace membership is inactive");
      return issueTokens(record.clientId, record.userId, record.workspaceId, record.scopes);
    },
    refreshAccessToken: async (input) => {
      const client = await store.findClient(input.clientId);
      if (!client) throw invalidGrant("unknown client");
      const tokenHash = await hashOpaque(input.refreshToken);
      const record = await store.findRefreshToken(tokenHash);
      if (!record || record.clientId !== client.clientId || record.audience !== resource || record.revokedAt || record.expiresAt <= now()) throw invalidGrant("refresh token is invalid or expired");
      if (record.rotatedAt) {
        await store.revokeRefreshFamily(record.familyId, now());
        revokedFamilies.add(record.familyId);
        await audit({ action: "mcp_oauth_refresh_reuse_detected", clientId: client.clientId, userId: record.userId, workspaceId: record.workspaceId });
        throw invalidGrant("refresh token reuse detected");
      }
      const membership = await store.findActiveMembership(record.userId, record.workspaceId);
      if (!membership) throw invalidGrant("workspace membership is inactive");
      const scopes = intersectScopes(record.scopes, roleScopes(membership.role));
      if (scopes.length === 0) throw invalidGrant("workspace scope is no longer permitted");
      const tokens = await issueTokens(record.clientId, record.userId, record.workspaceId, scopes, record.familyId, false);
      const replacement: McpOAuthRefreshToken = {
        id: crypto.randomUUID(),
        tokenHash: await hashOpaque(tokens.refreshToken!),
        familyId: record.familyId,
        clientId: record.clientId,
        userId: record.userId,
        workspaceId: record.workspaceId,
        scopes,
        audience: resource,
        expiresAt: new Date(now().getTime() + refreshTtl * 1000),
        rotatedAt: null,
        revokedAt: null,
      };
      const result = await store.replaceRefreshToken(tokenHash, now(), replacement);
      if (result !== "rotated") {
        await store.revokeRefreshFamily(record.familyId, now());
        revokedFamilies.add(record.familyId);
        throw invalidGrant("refresh token reuse detected");
      }
      return tokens;
    },
    revokeToken: async (input) => {
      const tokenHash = await hashOpaque(input.token);
      await store.revokeToken(tokenHash, now());
      await audit({ action: "mcp_oauth_token_revoked", ...(input.clientId ? { clientId: input.clientId } : {}) });
    },
    authenticateMcpRequest: async (input) => {
      const tokenHash = await hashOpaque(input.accessToken);
      const token = await store.findAccessToken(tokenHash);
      if (!token || token.audience !== resource || token.revokedAt || token.expiresAt <= now() || (accessFamilies.get(tokenHash) ? revokedFamilies.has(accessFamilies.get(tokenHash)!) : false)) {
        throw new McpOAuthError(401, "invalid_token", "Bearer token is invalid or expired", { "www-authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource", error="invalid_token"` });
      }
      const membership = await store.findActiveMembership(token.userId, token.workspaceId);
      if (!membership) throw new McpOAuthError(401, "invalid_token", "Workspace membership is inactive");
      const scopes = intersectScopes(token.scopes, roleScopes(membership.role));
      const required = input.requiredScopes ?? ["mcp:read"];
      if (required.some((scope) => !scopes.includes(scope))) throw new McpOAuthError(403, "insufficient_scope", "Required scope is missing", { "www-authenticate": `Bearer scope="${required.join(" ")}"` });
      return { userId: token.userId, workspaceId: token.workspaceId, clientId: token.clientId, role: membership.role, scopes, audience: token.audience };
    },
    createPkceChallenge,
  };
  return service;

  async function issueTokens(clientId: string, userId: string, workspaceId: string, scopes: readonly McpOAuthScope[], familyId = crypto.randomUUID(), persistRefresh = true): Promise<OAuthTokenResponse> {
    const accessToken = await randomOpaque();
    const refreshToken = await randomOpaque();
    const issuedAt = now();
    await store.insertAccessToken({ id: crypto.randomUUID(), tokenHash: await hashOpaque(accessToken), familyId, clientId, userId, workspaceId, scopes, audience: resource, expiresAt: new Date(issuedAt.getTime() + accessTtl * 1000), revokedAt: null });
    accessFamilies.set(await hashOpaque(accessToken), familyId);
    const record: McpOAuthRefreshToken = { id: crypto.randomUUID(), tokenHash: await hashOpaque(refreshToken), familyId, clientId, userId, workspaceId, scopes, audience: resource, expiresAt: new Date(issuedAt.getTime() + refreshTtl * 1000), rotatedAt: null, revokedAt: null };
    // Refresh rotation replaces the old row atomically; initial issuance inserts it.
    if (persistRefresh) await store.insertRefreshToken(record);
    await audit({ action: "mcp_oauth_token_issued", clientId, userId, workspaceId });
    return { accessToken, tokenType: "Bearer", expiresIn: accessTtl, refreshToken, scope: scopes.join(" ") };
  }

  async function audit(input: Parameters<McpOAuthStore["audit"]>[0]): Promise<void> {
    await store.audit(input);
  }
}

function canonicalResource(value: string): string {
  const parsed = new URL(value);
  return parsed.toString().replace(/\/$/, "");
}

function positiveTtl(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function validateRedirectUri(value: string): string {
  const parsed = new URL(value);
  if (parsed.hash || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)))) throw invalidRequest("redirect_uri must use HTTPS (except localhost)");
  return parsed.toString();
}

function normalizeScopes(scopes: readonly McpOAuthScope[]): readonly McpOAuthScope[] {
  const unique = [...new Set(scopes)];
  if (!unique.length || unique.some((scope) => !MCP_OAUTH_SCOPES.includes(scope))) throw invalidRequest("scope is not supported");
  return unique;
}

function roleScopes(role: WorkspaceRole): readonly McpOAuthScope[] {
  if (role === "viewer") return ["mcp:read"];
  if (role === "operator") return ["mcp:read", "mcp:write"];
  return [...MCP_OAUTH_SCOPES];
}

function intersectScopes(...sets: readonly (readonly McpOAuthScope[])[]): readonly McpOAuthScope[] {
  return MCP_OAUTH_SCOPES.filter((scope) => sets.every((set) => set.includes(scope)));
}

async function createPkceChallenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw invalidGrant("code_verifier is invalid");
  return digestBase64Url(verifier);
}

async function randomOpaque(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function hashOpaque(value: string): Promise<string> {
  return digestBase64Url(value);
}

async function digestBase64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return result === 0;
}
