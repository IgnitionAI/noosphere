import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { buildMcpLocalInspectorCommand, MCP_LOCAL_ROLE_SCOPES, type McpLocalRole } from "./write-mcp-local-client-config";

export interface McpProductionSmokeEnvironment {
  readonly [name: string]: string | undefined;
}

export type McpSmokeRole = "viewer" | "operator" | "reviewer" | "admin" | "owner";
export type McpSmokeScope = "mcp:read" | "mcp:write" | "mcp:approve";

export interface McpSmokeIdentity {
  readonly name: string;
  readonly token: string;
  readonly workspaceId: string;
  readonly role: McpSmokeRole;
  readonly scopes: readonly McpSmokeScope[];
}

export interface McpProductionSmokeConfig {
  readonly endpoint: URL;
  readonly resource: string;
  readonly identities: readonly McpSmokeIdentity[];
  readonly foreignProposalId: string;
  readonly viewerProposalId: string;
  readonly revokedToken: string;
  readonly timeoutMs: number;
  readonly rateLimitProbe: boolean;
  readonly inspectorEnabled: boolean;
}

export interface McpProductionSmokeReport {
  readonly endpoint: string;
  readonly identities: readonly string[];
  readonly modernProtocol: string;
  readonly legacyProtocol: string;
  readonly rateLimited: boolean;
  readonly foreignTenantIsolation: boolean;
  readonly viewerRedaction: boolean;
  readonly membershipRevocation: boolean;
  readonly inspector: "not_configured" | "passed";
}

export interface McpInspectorProxy {
  readonly port: number;
  stop(force?: boolean): void;
}

export interface McpInspectorChild {
  readonly exited: Promise<number>;
  readonly pid?: number;
  kill(signal?: string | number): void;
}

export interface McpInspectorSpawnOptions {
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly stdout: "ignore";
  readonly stderr: "ignore";
  readonly detached: true;
  readonly killSignal: "SIGTERM";
}

export interface McpInspectorRuntime {
  serve(fetch: (request: Request) => Promise<Response>): McpInspectorProxy;
  spawn(args: readonly string[], options: McpInspectorSpawnOptions): McpInspectorChild;
  createHome(): Promise<string>;
  removeHome(path: string): Promise<void>;
  readonly childCleanupTimeoutMs?: number;
  isProcessGroupAlive?(pid: number): boolean;
  killProcessGroup?(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ROLES = new Set<McpSmokeRole>(["viewer", "operator", "reviewer", "admin", "owner"]);
const SCOPES = new Set<McpSmokeScope>(["mcp:read", "mcp:write", "mcp:approve"]);
const MAX_IDENTITIES = 12;
const MAX_TOKEN_BYTES = 4_096;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_FORWARDER_TIMEOUT_MS = 30_000;
const INSPECTOR_CHILD_CLEANUP_TIMEOUT_MS = 2_000;
const INSPECTOR_HOME_PREFIX = "noosphere-mcp-inspector-";
const MCP_FORWARDER_RESPONSE_TOO_LARGE = "MCP_RESPONSE_TOO_LARGE";
const MCP_FORWARDER_RESPONSE_DEADLINE = "MCP_RESPONSE_DEADLINE_EXCEEDED";
const MCP_FORWARDER_CLIENT_CLOSED = "MCP_CLIENT_CLOSED";
export const MCP_FORWARDER_STREAM_FAILED = "MCP_FORWARDER_STREAM_FAILED";
export const MCP_INSPECTOR_CLEANUP_FAILED = "MCP_INSPECTOR_CLEANUP_FAILED";
const INSPECTOR_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"] as const;
const FORWARDER_REQUEST_HEADERS = new Set([
  "accept",
  "cache-control",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
  "x-correlation-id",
]);
const FORWARDER_RESPONSE_HEADERS = new Set([
  "allow",
  "cache-control",
  "content-encoding",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
  "retry-after",
  "www-authenticate",
  "x-correlation-id",
]);
/** Build the real Inspector 0.16.3 CLI invocation. The token is injected by
 * the local forwarding server below because this Inspector release has no
 * direct CLI header option (and therefore must not receive a bearer in argv).
 */
export function buildMcpInspectorCommand(targetUrl: string | URL): string[] {
  return buildMcpLocalInspectorCommand({
    forwarderUrl: typeof targetUrl === "string" ? targetUrl : targetUrl.href,
    method: "tools/list",
  });
}

/**
 * Parse only an explicit, production-like smoke configuration. Tokens are
 * accepted as input but never included in reports, command output, or errors.
 */
export function parseMcpProductionSmokeConfig(
  environment: McpProductionSmokeEnvironment = process.env,
): McpProductionSmokeConfig {
  const endpoint = canonicalEndpoint(required(environment, "MCP_SMOKE_URL"), "MCP_SMOKE_URL");
  const resource = canonicalEndpoint(required(environment, "MCP_SMOKE_RESOURCE"), "MCP_SMOKE_RESOURCE");
  if (resource.href !== endpoint.href) throw new Error("MCP_SMOKE_RESOURCE must exactly match MCP_SMOKE_URL");

  const identities = parseIdentities(required(environment, "MCP_SMOKE_IDENTITIES_JSON"));
  if (new Set(identities.map((identity) => identity.workspaceId)).size < 2) {
    throw new Error("MCP_SMOKE_IDENTITIES_JSON must contain at least two workspaces");
  }
  const foreignProposalId = required(environment, "MCP_SMOKE_FOREIGN_PROPOSAL_ID");
  if (!UUID.test(foreignProposalId)) {
    throw new Error("MCP_SMOKE_FOREIGN_PROPOSAL_ID must be a UUID");
  }
  const viewerProposalId = required(environment, "MCP_SMOKE_VIEWER_PROPOSAL_ID");
  if (!UUID.test(viewerProposalId)) throw new Error("MCP_SMOKE_VIEWER_PROPOSAL_ID must be a UUID");
  const revokedToken = required(environment, "MCP_SMOKE_REVOKED_TOKEN");
  boundedToken(revokedToken, "MCP_SMOKE_REVOKED_TOKEN");
  const timeoutMs = parseBoundedInteger(environment.MCP_SMOKE_TIMEOUT_MS, 30_000, 1_000, MAX_TIMEOUT_MS, "MCP_SMOKE_TIMEOUT_MS");
  const rateLimitProbe = environment.MCP_SMOKE_RATE_LIMIT !== "false";
  const inspectorValue = environment.MCP_SMOKE_INSPECTOR;
  if (inspectorValue !== undefined && inspectorValue !== "true" && inspectorValue !== "false") throw new Error("MCP_SMOKE_INSPECTOR must be true or false");
  const inspectorEnabled = inspectorValue === "true";
  return {
    endpoint,
    resource: resource.href,
    identities,
    foreignProposalId,
    viewerProposalId,
    revokedToken,
    timeoutMs,
    rateLimitProbe,
    inspectorEnabled,
  };
}

/** Safe projection suitable for logs and CI artifacts. */
export function redactMcpProductionSmokeConfig(
  config: McpProductionSmokeConfig,
): Omit<McpProductionSmokeConfig, "identities" | "foreignProposalId" | "viewerProposalId" | "revokedToken"> & {
  readonly identities: readonly (Omit<McpSmokeIdentity, "token"> & { readonly tokenRedacted: true })[];
} {
  return {
    endpoint: new URL(config.endpoint.href),
    resource: config.resource,
    identities: config.identities.map(({ token: _token, ...identity }) => ({ ...identity, tokenRedacted: true as const })),
    // Optional probe inputs are intentionally omitted from this projection;
    // proposal IDs may identify tenant data and revoked tokens are secrets.
    timeoutMs: config.timeoutMs,
    rateLimitProbe: config.rateLimitProbe,
    inspectorEnabled: config.inspectorEnabled,
  };
}

/** Run the bounded read-only MCP protocol smoke over the configured HTTPS edge. */
export async function runMcpProductionSmoke(
  config: McpProductionSmokeConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<McpProductionSmokeReport> {
  assertSmokeIdentityMatrix(config.identities);
  const reviewer = config.identities.find((identity) => identity.role === "reviewer" || identity.role === "admin" || identity.role === "owner") ?? config.identities[0]!;
  const viewer = config.identities.find((identity) => identity.role === "viewer") ?? config.identities[0]!;

  const modern = await sdkRoundTrip(config, reviewer, "auto", fetchImpl);
  const legacy = await sdkRoundTrip(config, viewer, "legacy", fetchImpl);
  await assertMalformedRequest(config, viewer, fetchImpl);
  await assertBodyLimit(config, viewer, fetchImpl);
  await assertUnknownMethod(config, viewer, fetchImpl);
  await assertForeignOrigin(config, viewer, fetchImpl);
  const rateLimited = config.rateLimitProbe ? await assertRateLimit(config, viewer, fetchImpl) : false;
  await assertRoleSurface(config, reviewer, config.identities.find((identity) => identity.role === "operator")!, fetchImpl);
  const foreignTenantIsolation = await assertForeignProposalHidden(config, viewer, fetchImpl).then(() => true);
  const viewerRedaction = await assertViewerRedaction(config, viewer, fetchImpl).then(() => true);
  const membershipRevocation = await assertRevokedToken(config, config.revokedToken, fetchImpl).then(() => true);
  const inspector = config.inspectorEnabled ? await runInspector(config, reviewer) : "not_configured" as const;
  return {
    endpoint: config.endpoint.href,
    identities: config.identities.map((identity) => `${identity.name}:${identity.workspaceId}:${identity.role}`),
    modernProtocol: modern.protocol,
    legacyProtocol: legacy.protocol,
    rateLimited,
    foreignTenantIsolation,
    viewerRedaction,
    membershipRevocation,
    inspector,
  };
}

async function sdkRoundTrip(
  config: McpProductionSmokeConfig,
  identity: McpSmokeIdentity,
  mode: "auto" | "legacy",
  fetchImpl: typeof fetch,
): Promise<{ readonly protocol: string }> {
  const client = new Client(
    { name: `noosphere-a4-${mode}`, version: "1.0.0" },
    { versionNegotiation: { mode }, listMaxPages: 16 },
  );
  const transport = new StreamableHTTPClientTransport(config.endpoint, {
    authProvider: { token: async () => identity.token },
    onInsufficientScope: "throw",
    fetch: fetchImpl,
  });
  try {
    await withTimeout(client.connect(transport), config.timeoutMs, "MCP SDK initialize");
    const tools = await withTimeout(client.listTools(), config.timeoutMs, "MCP tools/list");
    if (!tools.tools.some((tool) => tool.name === "noosphere_ping")) throw new Error("MCP tools/list omitted noosphere_ping");
    const resources = await withTimeout(client.listResources(), config.timeoutMs, "MCP resources/list");
    if (!resources.resources.some((resource) => resource.uri === "noosphere://runtime")) throw new Error("MCP resources/list omitted runtime");
    const runtime = await withTimeout(client.readResource({ uri: "noosphere://runtime" }), config.timeoutMs, "MCP resources/read");
    if (!runtime.contents.length) throw new Error("MCP resources/read returned no bounded contents");
    const ping = await withTimeout(client.callTool({ name: "noosphere_ping", arguments: { traceId: `a4-${mode}` } }), config.timeoutMs, "MCP noosphere_ping");
    if (ping.isError) throw new Error("MCP noosphere_ping returned an error");
    return { protocol: client.getProtocolEra() ?? "unknown" };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function assertMalformedRequest(config: McpProductionSmokeConfig, identity: McpSmokeIdentity, fetchImpl: typeof fetch): Promise<void> {
  const correlationId = "a4-malformed";
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: requestHeaders(identity, correlationId, config.endpoint.origin),
    body: "{",
  });
  const body = await boundedBody(response);
  if (response.status !== 400 || body === null || bodyCode(body) !== "INVALID_JSON_RPC") {
    throw new Error(`MCP malformed request check failed (${response.status})`);
  }
  assertCorrelation(response, correlationId);
}

async function assertBodyLimit(config: McpProductionSmokeConfig, identity: McpSmokeIdentity, fetchImpl: typeof fetch): Promise<void> {
  const correlationId = "a4-body-limit";
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: requestHeaders(identity, correlationId, config.endpoint.origin),
    body: "x".repeat(MAX_RESPONSE_BYTES + 1),
  });
  if (response.status !== 413) throw new Error(`MCP body limit check failed (${response.status})`);
  assertCorrelation(response, correlationId);
}

async function assertUnknownMethod(config: McpProductionSmokeConfig, identity: McpSmokeIdentity, fetchImpl: typeof fetch): Promise<void> {
  const correlationId = "a4-unknown-method";
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: requestHeaders(identity, correlationId, config.endpoint.origin),
    body: JSON.stringify({ jsonrpc: "2.0", id: "unknown", method: "mcp_unknown_method", params: {} }),
  });
  const body = await boundedBody(response);
  if (response.status !== 200 || !body || !isRpcError(body)) throw new Error(`MCP unknown method check failed (${response.status})`);
  assertCorrelation(response, correlationId);
}

async function assertForeignOrigin(config: McpProductionSmokeConfig, identity: McpSmokeIdentity, fetchImpl: typeof fetch): Promise<void> {
  const correlationId = "a4-origin";
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: { ...requestHeaders(identity, correlationId, config.endpoint.origin), origin: "https://foreign.invalid" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "origin", method: "tools/list", params: {} }),
  });
  if (response.status !== 403) throw new Error(`MCP foreign Origin check failed (${response.status})`);
  assertCorrelation(response, correlationId);
}

async function assertRateLimit(config: McpProductionSmokeConfig, identity: McpSmokeIdentity, fetchImpl: typeof fetch): Promise<boolean> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: requestHeaders(identity, `a4-rate-${attempt}`, config.endpoint.origin),
      body: JSON.stringify({ jsonrpc: "2.0", id: attempt, method: "tools/list", params: {} }),
    });
    if (response.status !== 429) continue;
    const retryAfter = response.headers.get("retry-after");
    if (!retryAfter || !/^\d{1,5}$/.test(retryAfter) || Number(retryAfter) < 1) {
      throw new Error("MCP rate limit response omitted a bounded Retry-After");
    }
    const body = await boundedBody(response);
    if (bodyCode(body) !== "RATE_LIMITED") throw new Error("MCP rate limit response omitted RATE_LIMITED");
    return true;
  }
  throw new Error("MCP rate limit probe did not receive 429 within its bounded budget");
}

async function assertForeignProposalHidden(config: McpProductionSmokeConfig, identity: McpSmokeIdentity, fetchImpl: typeof fetch): Promise<void> {
  const foreignWorkspaceId = config.identities.find((candidate) => candidate.workspaceId !== identity.workspaceId)?.workspaceId;
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: {
      ...requestHeaders(identity, "a4-foreign-id", config.endpoint.origin),
      ...(foreignWorkspaceId === undefined ? {} : { "x-workspace-id": foreignWorkspaceId, "x-workspace-slug": "foreign" }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "foreign", method: "tools/call", params: { name: "approval_get", arguments: { proposalId: config.foreignProposalId, workspaceId: foreignWorkspaceId } } }),
  });
  const body = await boundedBody(response);
  const serialized = body === null ? "" : JSON.stringify(body);
  if (!body || !isRpcError(body) || serialized.includes(config.foreignProposalId!)) {
    throw new Error(`MCP foreign proposal check failed (${response.status})`);
  }
}

async function assertViewerRedaction(config: McpProductionSmokeConfig, identity: McpSmokeIdentity, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: requestHeaders(identity, "a4-viewer-redaction", config.endpoint.origin),
    body: JSON.stringify({ jsonrpc: "2.0", id: "viewer", method: "tools/call", params: { name: "approval_get", arguments: { proposalId: config.viewerProposalId } } }),
  });
  const body = await boundedBody(response);
  const serialized = body === null ? "" : JSON.stringify(body);
  if (!body || !serialized.includes('"redacted":true') || serialized.includes('"body":') || serialized.includes('"subject":') || serialized.includes('"slotStart":')) {
    throw new Error(`MCP viewer redaction check failed (${response.status})`);
  }
}

async function assertRevokedToken(config: McpProductionSmokeConfig, token: string, fetchImpl: typeof fetch): Promise<void> {
  const correlationId = "a4-revoked-token";
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      origin: config.endpoint.origin,
      "x-correlation-id": correlationId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "revoked", method: "tools/list", params: {} }),
  });
  const body = await boundedBody(response);
  const serialized = body === null ? "" : JSON.stringify(body);
  if (response.status !== 401 || serialized.includes(token)) throw new Error(`MCP revoked token check failed (${response.status})`);
  assertCorrelation(response, correlationId);
}

async function assertRoleSurface(config: McpProductionSmokeConfig, reviewer: McpSmokeIdentity, operator: McpSmokeIdentity, fetchImpl: typeof fetch): Promise<void> {
  const reviewerResponse = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: requestHeaders(reviewer, "a4-reviewer-read", config.endpoint.origin),
    body: JSON.stringify({ jsonrpc: "2.0", id: "reviewer", method: "tools/call", params: { name: "approval_list", arguments: { limit: 10 } } }),
  });
  const reviewerBody = await boundedBody(reviewerResponse);
  if (reviewerResponse.status !== 200 || !reviewerBody || isRpcError(reviewerBody)) throw new Error(`MCP reviewer read check failed (${reviewerResponse.status})`);

  const operatorResponse = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: requestHeaders(operator, "a4-operator-read", config.endpoint.origin),
    body: JSON.stringify({ jsonrpc: "2.0", id: "operator", method: "tools/call", params: { name: "approval_list", arguments: { limit: 10 } } }),
  });
  const operatorBody = await boundedBody(operatorResponse);
  if (operatorResponse.status !== 200 || !operatorBody || isRpcError(operatorBody)) throw new Error(`MCP operator read check failed (${operatorResponse.status})`);

  const deniedResponse = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: requestHeaders(operator, "a4-operator-decision", config.endpoint.origin),
    body: JSON.stringify({ jsonrpc: "2.0", id: "operator-decision", method: "tools/call", params: { name: "approval_decide", arguments: { approvalItemId: config.foreignProposalId ?? config.viewerProposalId ?? crypto.randomUUID(), decision: "approve" } } }),
  });
  const deniedBody = await boundedBody(deniedResponse);
  const deniedSerialized = deniedBody === null ? "" : JSON.stringify(deniedBody);
  if (deniedResponse.status !== 200 || !deniedSerialized.includes("MCP_GOVERNED_EFFECT_FORBIDDEN")) throw new Error(`MCP operator decision guard failed (${deniedResponse.status})`);
}

const defaultMcpInspectorRuntime: McpInspectorRuntime = {
  serve: (fetch) => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
    if (server.port === undefined) {
      server.stop(true);
      throw new Error("MCP Inspector proxy did not bind a port");
    }
    return { port: server.port, stop: (force?: boolean) => server.stop(force) };
  },
  spawn: (args, options) => Bun.spawn([...args], options),
  killProcessGroup: (pid, signal) => {
    if (Number.isSafeInteger(pid) && pid > 1) process.kill(-pid, signal);
  },
  isProcessGroupAlive: (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 1) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "EPERM";
    }
  },
  createHome: async () => {
    const home = await mkdtemp(join(tmpdir(), INSPECTOR_HOME_PREFIX));
    try {
      await chmod(home, 0o700);
      return home;
    } catch (error) {
      await rm(home, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  },
  removeHome: (path) => rm(path, { recursive: true, force: true }),
};

export async function runInspector(
  config: McpProductionSmokeConfig,
  identity: McpSmokeIdentity,
  runtime: McpInspectorRuntime = defaultMcpInspectorRuntime,
): Promise<"passed"> {
  // Inspector 0.16.3's CLI transport does not accept custom headers. Keep the
  // target local and inject the OAuth header only while forwarding to Caddy's
  // HTTPS endpoint; no token appears in Inspector argv or child output.
  let proxy: McpInspectorProxy | undefined;
  let child: McpInspectorChild | undefined;
  let detachedChildPid: number | undefined;
  let home: string | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    proxy = runtime.serve(async (request) => {
      return forwardMcpInspectorRequest(request, {
        endpoint: config.endpoint,
        token: identity.token,
        timeoutMs: config.timeoutMs,
      });
    });
    home = await runtime.createHome();
    const target = `http://127.0.0.1:${proxy.port}/mcp`;
    child = runtime.spawn(buildMcpInspectorCommand(target), {
      cwd: home,
      env: {
        ...buildMcpInspectorEnvironment(),
        HOME: home,
        NPM_CONFIG_USERCONFIG: "/dev/null",
        NPM_CONFIG_GLOBALCONFIG: "/dev/null",
      },
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
      killSignal: "SIGTERM",
    });
    detachedChildPid = child.pid;
    const exitCode = await withTimeout(child.exited, config.timeoutMs, "MCP Inspector smoke");
    if (exitCode !== 0) throw new Error(`MCP Inspector smoke failed (${exitCode})`);
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
  }

  let cleanupFailed = false;
  if (child !== undefined) {
    try {
      const terminated = await terminateMcpInspectorChild(child, runtime, detachedChildPid);
      cleanupFailed = !terminated;
    } catch {
      cleanupFailed = true;
    }
  }
  try {
    proxy?.stop(true);
  } catch {
    cleanupFailed = true;
  }
  if (home !== undefined) {
    try {
      await runtime.removeHome(home);
    } catch {
      cleanupFailed = true;
    }
  }

  if (hasPrimaryError) {
    const detail = primaryError instanceof Error ? primaryError.message : "unknown error";
    throw new Error(redactMcpInspectorDiagnostic(detail, [identity.token]));
  }
  if (cleanupFailed) throw new Error(MCP_INSPECTOR_CLEANUP_FAILED);
  return "passed";
}

async function terminateMcpInspectorChild(
  child: McpInspectorChild,
  runtime: McpInspectorRuntime,
  detachedChildPid: number | undefined,
): Promise<boolean> {
  const exit = observeMcpInspectorExit(child);
  const childExited = await exit.hasExited();
  if (!isValidDetachedChildPid(child, detachedChildPid)) return childExited;
  const validDetachedChildPid = detachedChildPid;
  const initialProbe = probeMcpInspectorGroup(child, runtime, validDetachedChildPid);
  if (initialProbe === "dead") return true;
  if (initialProbe !== "alive") return false;
  if (!childExited) {
    try {
      child.kill();
    } catch {
      // The child may have exited between the smoke check and cleanup.
    }
  }
  const beforeTermProbe = probeMcpInspectorGroup(child, runtime, validDetachedChildPid);
  if (beforeTermProbe === "dead") return true;
  if (beforeTermProbe !== "alive") return false;
  signalMcpInspectorGroup(child, runtime, validDetachedChildPid, "SIGTERM");
  if (await waitForMcpInspectorGroup(child, runtime, validDetachedChildPid, runtime.childCleanupTimeoutMs)) return true;
  const beforeKillProbe = probeMcpInspectorGroup(child, runtime, validDetachedChildPid);
  if (beforeKillProbe === "dead") return true;
  if (beforeKillProbe !== "alive") return false;
  signalMcpInspectorGroup(child, runtime, validDetachedChildPid, "SIGKILL");
  return await waitForMcpInspectorGroup(child, runtime, validDetachedChildPid, runtime.childCleanupTimeoutMs);
}

function isValidDetachedChildPid(child: McpInspectorChild, detachedChildPid: number | undefined): detachedChildPid is number {
  return detachedChildPid !== undefined
    && detachedChildPid === child.pid
    && Number.isSafeInteger(detachedChildPid)
    && detachedChildPid > 1;
}

type McpInspectorGroupProbe = "alive" | "dead" | "invalid" | "unsupported" | "error";

function probeMcpInspectorGroup(
  child: McpInspectorChild,
  runtime: McpInspectorRuntime,
  detachedChildPid: number | undefined,
): McpInspectorGroupProbe {
  if (!isValidDetachedChildPid(child, detachedChildPid)) return "invalid";
  if (runtime.isProcessGroupAlive === undefined) return "unsupported";
  try {
    return runtime.isProcessGroupAlive(detachedChildPid) ? "alive" : "dead";
  } catch {
    return "error";
  }
}

function signalMcpInspectorGroup(
  child: McpInspectorChild,
  runtime: McpInspectorRuntime,
  detachedChildPid: number | undefined,
  signal: "SIGTERM" | "SIGKILL",
): void {
  if (
    runtime.killProcessGroup === undefined
    || detachedChildPid === undefined
    || detachedChildPid !== child.pid
    || !Number.isSafeInteger(detachedChildPid)
    || detachedChildPid <= 1
  ) return;
  try {
    // detached:true makes pid the process-group leader; a negative pid scopes
    // termination to Inspector and descendants, never the parent group.
    runtime.killProcessGroup(detachedChildPid, signal);
  } catch {
    // The group may have exited with the child already.
  }
}

function observeMcpInspectorExit(child: McpInspectorChild): {
  hasExited: () => Promise<boolean>;
} {
  let settled = false;
  const exited = Promise.resolve(child.exited).then(
    () => { settled = true; },
    () => { settled = true; },
  );
  void exited.catch(() => undefined);
  return {
    hasExited: async () => {
      await Promise.resolve();
      return settled;
    },
  };
}

async function waitForMcpInspectorGroup(
  child: McpInspectorChild,
  runtime: McpInspectorRuntime,
  detachedChildPid: number,
  timeoutMs = INSPECTOR_CHILD_CLEANUP_TIMEOUT_MS,
): Promise<boolean> {
  const boundedTimeout = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, MAX_TIMEOUT_MS)
    : INSPECTOR_CHILD_CLEANUP_TIMEOUT_MS;
  const deadline = Date.now() + boundedTimeout;
  while (true) {
    const probe = probeMcpInspectorGroup(child, runtime, detachedChildPid);
    if (probe === "dead") return true;
    if (probe !== "alive") return false;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(remaining, 10)));
  }
}

export interface McpInspectorForwarderOptions {
  readonly endpoint: URL;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Forward Inspector requests while keeping the bearer only in memory. */
export async function forwardMcpInspectorRequest(
  request: Request,
  options: McpInspectorForwarderOptions,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== "/mcp") return new Response("Not found", { status: 404 });
  if (options.endpoint.protocol !== "https:" || options.endpoint.pathname !== "/mcp" || options.endpoint.username || options.endpoint.password || options.endpoint.search || options.endpoint.hash) {
    return new Response("MCP upstream unavailable", { status: 502 });
  }
  let body: Uint8Array | undefined;
  try {
    body = await boundedRequestBody(request);
  } catch {
    if (request.signal.aborted) return new Response("MCP client closed", { status: 499 });
    return new Response("Request too large", { status: 413 });
  }
  if (request.signal.aborted) return new Response("MCP client closed", { status: 499 });
  const timeoutMs = options.timeoutMs ?? DEFAULT_FORWARDER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    return new Response("MCP upstream unavailable", { status: 502 });
  }
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (FORWARDER_REQUEST_HEADERS.has(name)) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${options.token}`);
  headers.set("origin", options.endpoint.origin);
  const abortController = new AbortController();
  let responseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let responseController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleanedUp = false;
  let deadlineReject: ((reason?: unknown) => void) | undefined;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (timer !== undefined) clearTimeout(timer);
    request.signal.removeEventListener("abort", onClientAbort);
  };
  const abortAndCancel = (errorCode?: string): void => {
    abortController.abort();
    if (errorCode !== undefined) responseController?.error(new Error(errorCode));
    if (responseReader !== undefined) {
      void responseReader.cancel().catch(() => undefined).finally(cleanup);
    } else {
      cleanup();
    }
  };
  const onClientAbort = (): void => {
    abortAndCancel(MCP_FORWARDER_CLIENT_CLOSED);
    deadlineReject?.(new Error("MCP client closed"));
    if (responseReader === undefined) cleanup();
  };
  request.signal.addEventListener("abort", onClientAbort, { once: true });
  timer = setTimeout(() => {
    abortAndCancel(MCP_FORWARDER_RESPONSE_DEADLINE);
    deadlineReject?.(new Error("MCP upstream deadline exceeded"));
  }, timeoutMs);
  try {
    const fetchPromise = (options.fetchImpl ?? fetch)(options.endpoint, {
      method: request.method,
      headers,
      signal: abortController.signal,
      ...(body === undefined ? {} : { body: body as unknown as BodyInit }),
    });
    const upstream = await Promise.race([
      fetchPromise,
      new Promise<Response>((_, reject) => { deadlineReject = reject; }),
    ]);
    if (!upstream.body) {
      cleanup();
      return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers: safeForwarderResponseHeaders(upstream.headers) });
    }
    responseReader = upstream.body.getReader();
    let responseBytes = 0;
    const boundedBody = new ReadableStream<Uint8Array>({
      start(streamController) {
        responseController = streamController;
      },
      async pull(streamController) {
        try {
          const next = await responseReader!.read();
          if (next.done) {
            cleanup();
            streamController.close();
            return;
          }
          responseBytes += next.value.byteLength;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            abortAndCancel(MCP_FORWARDER_RESPONSE_TOO_LARGE);
            cleanup();
            return;
          }
          streamController.enqueue(next.value);
        } catch (error) {
          abortAndCancel();
          cleanup();
          streamController.error(new Error(MCP_FORWARDER_STREAM_FAILED));
        }
      },
      async cancel(reason) {
        abortAndCancel();
        await responseReader?.cancel(reason).catch(() => undefined);
        cleanup();
      },
    });
    return new Response(boundedBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: safeForwarderResponseHeaders(upstream.headers),
    });
  } catch {
    cleanup();
    return new Response("MCP upstream unavailable", { status: 502 });
  }
}

/** Redact tokens from diagnostics before they can reach a test or log sink. */
export function redactMcpInspectorDiagnostic(value: string, secrets: readonly string[]): string {
  return secrets.reduce((result, secret) => secret.length > 0 ? result.split(secret).join("[REDACTED]") : result, value);
}

function safeForwarderResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (FORWARDER_RESPONSE_HEADERS.has(name)) headers.set(name, value);
  }
  return headers;
}

export function buildMcpInspectorEnvironment(
  source: McpProductionSmokeEnvironment = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of INSPECTOR_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  environment.MCP_AUTO_OPEN_ENABLED = "false";
  return environment;
}

function assertSmokeIdentityMatrix(identities: readonly McpSmokeIdentity[]): void {
  if (!identities.some((identity) => identity.role === "reviewer")) {
    throw new Error("MCP smoke requires a reviewer identity");
  }
  if (!identities.some((identity) => identity.role === "viewer")) throw new Error("MCP smoke requires a viewer identity");
  if (!identities.some((identity) => identity.role === "operator")) throw new Error("MCP smoke requires an operator identity");
  for (const identity of identities) {
    if (!identity.scopes.includes("mcp:read")) throw new Error(`MCP smoke identity ${identity.name} requires mcp:read`);
  }
}

function parseIdentities(raw: string): readonly McpSmokeIdentity[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error("MCP_SMOKE_IDENTITIES_JSON must be valid JSON"); }
  if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > MAX_IDENTITIES) throw new Error("MCP_SMOKE_IDENTITIES_JSON must contain 2-12 identities");
  const names = new Set<string>();
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`MCP smoke identity ${index} is invalid`);
    const record = value as Record<string, unknown>;
    const name = boundedString(record.name, NAME, `identity ${index} name`, 64);
    if (names.has(name)) throw new Error(`identity ${name} is duplicated`);
    names.add(name);
    const token = boundedToken(record.token, `identity ${name} token`);
    const workspaceId = boundedString(record.workspaceId, UUID, `identity ${name} workspaceId`, 36);
    const role = record.role;
    if (typeof role !== "string" || !ROLES.has(role as McpSmokeRole)) throw new Error(`identity ${name} role is invalid`);
    if (!Array.isArray(record.scopes) || record.scopes.length < 1 || record.scopes.length > SCOPES.size || record.scopes.some((scope) => typeof scope !== "string" || !SCOPES.has(scope as McpSmokeScope))) {
      throw new Error(`identity ${name} scopes are invalid`);
    }
    const scopes = record.scopes as McpSmokeScope[];
    if (new Set(scopes).size !== scopes.length) throw new Error(`identity ${name} scopes contain duplicates`);
    const localRole: McpLocalRole = role === "admin" || role === "owner" ? "reviewer" : role as McpLocalRole;
    const allowedScopes = MCP_LOCAL_ROLE_SCOPES[localRole];
    if (!scopes.includes("mcp:read") || scopes.some((scope) => !allowedScopes.has(scope))) {
      throw new Error(`identity ${name} scopes are invalid for role`);
    }
    return { name, token, workspaceId, role: role as McpSmokeRole, scopes: [...scopes] };
  });
}

function canonicalEndpoint(value: string, variable: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${variable} must be an absolute HTTPS URL`); }
  if (url.protocol !== "https:" || url.pathname !== "/mcp" || url.search !== "" || url.hash !== "") throw new Error(`${variable} must be canonical HTTPS /mcp`);
  return url;
}

function requestHeaders(identity: McpSmokeIdentity, correlationId: string, origin: string): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    authorization: `Bearer ${identity.token}`,
    origin,
    "x-correlation-id": correlationId,
  };
}

async function boundedBody(response: Response): Promise<Record<string, unknown> | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) throw new Error("MCP smoke response exceeded the bounded content length");
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("MCP smoke response exceeded the bounded body limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  const data = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.match(/(?:^|\r?\n)data:\s?([^\r\n]*)/)?.[1]
    : text;
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function boundedRequestBody(request: Request): Promise<Uint8Array | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) throw new Error("request too large");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancelOnAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  request.signal.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    while (true) {
      if (request.signal.aborted) throw new Error("request aborted");
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("request too large");
      }
      chunks.push(next.value);
    }
  } finally {
    request.signal.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function bodyCode(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  if (typeof body.code === "string") return body.code;
  const error = body.error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const data = (error as Record<string, unknown>).data;
    if (data && typeof data === "object" && !Array.isArray(data) && typeof (data as Record<string, unknown>).code === "string") return (data as Record<string, unknown>).code as string;
  }
  return null;
}

function isRpcError(body: Record<string, unknown>): boolean {
  return Boolean(body.error) || Boolean(body.result && typeof body.result === "object" && (body.result as Record<string, unknown>).isError === true);
}

function assertCorrelation(response: Response, expected: string): void {
  if (response.headers.get("x-correlation-id") !== expected) throw new Error("MCP smoke response correlation mismatch");
}

function boundedString(value: unknown, pattern: RegExp, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function boundedToken(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 8 || value.length > MAX_TOKEN_BYTES || /[\u0000-\u001f\u007f\s]/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function required(environment: McpProductionSmokeEnvironment, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} is out of bounds`);
  return parsed;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${operation} timed out`)), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

if (import.meta.main) {
  const config = parseMcpProductionSmokeConfig();
  const report = await runMcpProductionSmoke(config);
  // Deliberately print only the redacted report; never print environment or SDK bodies.
  console.log(JSON.stringify(report));
}
