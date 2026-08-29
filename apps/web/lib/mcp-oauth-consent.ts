const SUPPORTED_SCOPES = new Set(["mcp:read", "mcp:write", "mcp:approve"]);

export interface McpOAuthAuthorizationRequest {
  readonly responseType: "code";
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
  readonly scope: string;
  readonly resource?: string;
  readonly workspaceSlug: string;
}

export interface McpOAuthConsent {
  readonly consentRequired: true;
  readonly client: {
    readonly clientId: string;
    readonly clientName: string;
    readonly redirectUri: string;
    readonly workspaceSlug: string;
  };
  readonly requestedScopes: readonly string[];
  readonly effectiveScopes: readonly string[];
  readonly state: string;
}

export type McpOAuthDecision = "approve" | "deny";

export class McpOAuthConsentError extends Error {
  constructor(
    readonly status: number,
    readonly oauthCode: string,
    message: string,
  ) {
    super(message);
    this.name = "McpOAuthConsentError";
  }
}

export interface McpOAuthConsentGatewayDependencies {
  readonly apiOrigin: string;
  readonly publicHost?: string;
  readonly fetch: typeof fetch;
  readonly readCookieHeader: () => Promise<string>;
  readonly getSession: () => Promise<unknown | null>;
  readonly listWorkspaces: () => Promise<readonly { readonly slug: string }[]>;
}

export interface McpOAuthConsentGateway {
  readonly getConsent: (request: McpOAuthAuthorizationRequest) => Promise<McpOAuthConsent>;
  readonly decide: (request: McpOAuthAuthorizationRequest, decision: McpOAuthDecision) => Promise<string>;
}

/**
 * Parse only the OAuth fields accepted by the browser consent page. The
 * resulting object is captured by a server action, so the action does not
 * trust hidden inputs for client, redirect, state or PKCE values.
 */
export function parseMcpOAuthAuthorizationRequest(
  source: Record<string, string | string[] | undefined> | URLSearchParams,
): McpOAuthAuthorizationRequest {
  const value = (key: string): string | undefined => {
    if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
    const raw = source[key];
    return Array.isArray(raw) ? undefined : raw;
  };
  const required = (key: string): string => {
    const raw = value(key)?.trim();
    if (!raw) throw consentError(400, "invalid_request", `${key} is required`);
    return raw;
  };

  const responseType = required("response_type");
  if (responseType !== "code") throw consentError(400, "invalid_request", "response_type must be code");
  const redirectUri = required("redirect_uri");
  try {
    const parsedRedirect = new URL(redirectUri);
    if (parsedRedirect.hash) throw new Error("fragment");
    if (parsedRedirect.protocol !== "https:" && !isLocalhost(parsedRedirect.hostname)) {
      throw new Error("insecure");
    }
  } catch {
    throw consentError(400, "invalid_request", "redirect_uri is invalid");
  }
  const state = required("state");
  if (state.length > 512) throw consentError(400, "invalid_request", "state is too long");
  const codeChallenge = required("code_challenge");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    throw consentError(400, "invalid_request", "code_challenge must be base64url");
  }
  if (value("code_challenge_method") !== "S256") {
    throw consentError(400, "invalid_request", "code_challenge_method must be S256");
  }
  const scope = value("scope")?.trim() || "mcp:read";
  const scopes = scope.split(/[\t ]+/).filter(Boolean);
  if (scopes.length === 0 || scopes.some((candidate) => !SUPPORTED_SCOPES.has(candidate))) {
    throw consentError(400, "invalid_request", "scope is not supported");
  }
  const workspaceSlug = required("workspace_slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspaceSlug) || workspaceSlug.length > 120) {
    throw consentError(400, "invalid_request", "workspace_slug is invalid");
  }
  const resource = value("resource")?.trim() || undefined;
  if (resource) {
    try {
      const parsedResource = new URL(resource);
      if (parsedResource.hash || (parsedResource.protocol !== "https:" && !isLocalhost(parsedResource.hostname))) {
        throw new Error("resource");
      }
    } catch {
      throw consentError(400, "invalid_request", "resource is invalid");
    }
  }

  return {
    responseType: "code",
    clientId: required("client_id"),
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
    scope: [...new Set(scopes)].join(" "),
    ...(resource ? { resource } : {}),
    workspaceSlug,
  };
}

export function createMcpOAuthConsentGateway(
  dependencies: McpOAuthConsentGatewayDependencies,
): McpOAuthConsentGateway {
  return {
    getConsent: async (request) => {
      await assertAuthenticatedWorkspace(request, dependencies);
      const response = await send(dependencies, request, "GET");
      if (!response.ok) throw await upstreamError(response);
      const payload = await response.json().catch(() => null) as Partial<McpOAuthConsent> | null;
      if (!payload || payload.consentRequired !== true || !payload.client || hasBrowserToken(payload)) {
        throw consentError(502, "server_error", "Invalid OAuth consent response");
      }
      return payload as McpOAuthConsent;
    },
    decide: async (request, decision) => {
      await assertAuthenticatedWorkspace(request, dependencies);
      const response = await send(dependencies, request, "POST", decision);
      if (response.status < 300 || response.status >= 400) throw await upstreamError(response);
      const location = response.headers.get("location");
      if (!location) throw consentError(502, "server_error", "OAuth response did not include a redirect");
      return validateDecisionRedirect(request, decision, location);
    },
  };
}

async function assertAuthenticatedWorkspace(
  request: McpOAuthAuthorizationRequest,
  dependencies: McpOAuthConsentGatewayDependencies,
): Promise<void> {
  if (!(await dependencies.getSession())) throw consentError(401, "login_required", "An active session is required");
  const workspaces = await dependencies.listWorkspaces();
  if (!workspaces.some((workspace) => workspace.slug === request.workspaceSlug)) {
    throw consentError(403, "access_denied", "Workspace membership is inactive");
  }
}

async function send(
  dependencies: McpOAuthConsentGatewayDependencies,
  request: McpOAuthAuthorizationRequest,
  method: "GET" | "POST",
  decision?: McpOAuthDecision,
): Promise<Response> {
  const target = buildOAuthUrl(dependencies.apiOrigin, request, method === "GET");
  const cookieHeader = await dependencies.readCookieHeader();
  const headers = new Headers({ accept: "application/json" });
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (dependencies.publicHost) headers.set("host", dependencies.publicHost);
  if (method === "POST") {
    headers.set("content-type", "application/x-www-form-urlencoded");
    return dependencies.fetch(target, {
      method,
      headers,
      body: formBody(request, decision!),
      redirect: "manual",
      cache: "no-store",
    });
  }
  return dependencies.fetch(target, { method, headers, redirect: "manual", cache: "no-store" });
}

function buildOAuthUrl(apiOrigin: string, request: McpOAuthAuthorizationRequest, includeQuery: boolean): URL {
  let base: URL;
  try {
    base = new URL(apiOrigin);
    if ((base.protocol !== "http:" && base.protocol !== "https:") || base.username || base.password || base.search || base.hash) {
      throw new Error("unsafe base");
    }
  } catch {
    throw consentError(500, "server_error", "OAuth backend is misconfigured");
  }
  const target = new URL("/oauth/authorize", base.origin);
  if (includeQuery) {
    for (const [key, value] of requestEntries(request)) target.searchParams.set(key, value);
  }
  return target;
}

function requestEntries(request: McpOAuthAuthorizationRequest): readonly [string, string][] {
  return [
    ["response_type", request.responseType],
    ["client_id", request.clientId],
    ["redirect_uri", request.redirectUri],
    ["state", request.state],
    ["code_challenge", request.codeChallenge],
    ["code_challenge_method", request.codeChallengeMethod],
    ["scope", request.scope],
    ...(request.resource ? [["resource", request.resource] as [string, string]] : []),
    ["workspace_slug", request.workspaceSlug],
  ];
}

function formBody(request: McpOAuthAuthorizationRequest, decision: McpOAuthDecision): string {
  const form = new URLSearchParams();
  for (const [key, value] of requestEntries(request)) form.set(key, value);
  form.set("decision", decision);
  return form.toString();
}

async function upstreamError(response: Response): Promise<McpOAuthConsentError> {
  const body = await response.json().catch(() => null) as { error?: string; error_description?: string } | null;
  const code = body?.error && /^[a-z_]+$/.test(body.error) ? body.error : response.status === 401 ? "login_required" : response.status === 403 ? "access_denied" : "invalid_request";
  return consentError(response.status >= 500 ? 502 : response.status, code, body?.error_description || "OAuth request was rejected");
}

function validateDecisionRedirect(
  request: McpOAuthAuthorizationRequest,
  decision: McpOAuthDecision,
  location: string,
): string {
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(request.redirectUri);
    actual = new URL(location);
  } catch {
    throw consentError(502, "server_error", "OAuth response redirect is invalid");
  }
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.hash || hasBrowserToken(actual)) {
    throw consentError(502, "server_error", "OAuth response redirect is invalid");
  }
  for (const [key, value] of expected.searchParams) {
    if (actual.searchParams.get(key) !== value) throw consentError(502, "server_error", "OAuth response redirect is invalid");
  }
  if (actual.searchParams.get("state") !== request.state || actual.searchParams.getAll("state").length !== 1) {
    throw consentError(502, "server_error", "OAuth response state is invalid");
  }
  if (decision === "approve") {
    if (!actual.searchParams.get("code") || actual.searchParams.getAll("code").length !== 1 || actual.searchParams.get("error")) {
      throw consentError(502, "server_error", "OAuth response code is invalid");
    }
  } else if (actual.searchParams.get("error") !== "access_denied" || actual.searchParams.get("code")) {
    throw consentError(502, "server_error", "OAuth refusal response is invalid");
  }
  return actual.toString();
}

function hasBrowserToken(value: unknown): boolean {
  if (value instanceof URL) {
    return ["access_token", "refresh_token", "id_token", "token"].some((key) => value.searchParams.has(key));
  }
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).some((key) => ["access_token", "refresh_token", "id_token", "token"].includes(key));
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function consentError(status: number, code: string, message: string): McpOAuthConsentError {
  return new McpOAuthConsentError(status, code, message);
}
