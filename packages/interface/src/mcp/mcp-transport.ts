import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";
import { registerMcpReadResources } from "@outbound/interface/mcp/mcp-read-resources";
import { registerMcpReadTools } from "@outbound/interface/mcp/mcp-read-tools";
import { registerMcpWriteTools } from "@outbound/interface/mcp/mcp-write-tools";
import { registerMcpGovernedEffectTools } from "@outbound/interface/mcp/mcp-governed-effect-tools";
import {
  deriveMcpCorrelationId,
  InMemoryMcpRateLimiter,
  MCP_CORRELATION_HEADER,
  MCP_MAX_RESPONSE_BYTES,
  type McpRateLimitDecision,
  type McpRateLimiter,
  validateMcpExecutionContext,
} from "@outbound/interface/mcp/mcp-request-governance";

/** The maximum body accepted by the stateless MCP endpoint. */
export const MCP_MAX_BODY_BYTES = 1_048_576;

export interface McpTransportOptions {
  readonly capabilities: RuntimeCapabilities;
  /** Return true or an OAuth execution context only when identity is valid. */
  readonly authorize?: (request: Request) => Promise<boolean | McpExecutionContext> | boolean | McpExecutionContext;
  /** Exact origins allowed to send browser requests; an absent Origin is allowed. */
  readonly allowedOrigins?: readonly string[];
  /** Hostnames (or host:port values) accepted by the endpoint. */
  readonly allowedHosts?: readonly string[];
  /** Exact HTTPS resource audience expected from the authorization boundary. */
  readonly expectedAudience?: string;
  /** RFC 9728 metadata URL advertised for bearer challenges. */
  readonly oauthResourceMetadataUrl?: string;
  readonly maxBodyBytes?: number;
  readonly maxResponseBytes?: number;
  /** In-process by default; implementations must key from authenticated context. */
  readonly rateLimiter?: McpRateLimiter;
}

export interface McpTransport {
  readonly handle: (request: Request) => Promise<Response>;
  readonly close: () => Promise<void>;
  readonly maxBodyBytes: number;
  readonly maxResponseBytes: number;
}

/**
 * Build the official TypeScript SDK's per-request Web Standard MCP handler.
 * `createMcpHandler` constructs a fresh `McpServer` for every request and the
 * legacy 2025 leg uses a fresh stateless transport, so no session state is
 * shared between concurrent requests or process restarts.
 */
export function createMcpTransport(options: McpTransportOptions): McpTransport {
  const maxBodyBytes = options.maxBodyBytes ?? MCP_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0 || maxBodyBytes > MCP_MAX_BODY_BYTES) {
    throw new Error(`MCP max body must be a positive integer <= ${MCP_MAX_BODY_BYTES}`);
  }
  const maxResponseBytes = options.maxResponseBytes ?? MCP_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0 || maxResponseBytes > MCP_MAX_RESPONSE_BYTES) {
    throw new Error(`MCP max response must be a positive integer <= ${MCP_MAX_RESPONSE_BYTES}`);
  }
  const allowedOrigins = normalizeOrigins(options.allowedOrigins ?? []);
  const allowedHosts = normalizeHosts(options.allowedHosts ?? []);
  const authorize = options.authorize ?? (() => false);
  const rateLimiter = options.rateLimiter ?? new InMemoryMcpRateLimiter();
  const handler = createMcpHandler((ctx) => createServer(options.capabilities, ctx.authInfo?.extra), {
    // Keep the legacy (2025) path stateless and force JSON responses for the
    // modern path. The SDK handles initialize, negotiation, JSON-RPC errors,
    // notification acknowledgements and tool/resource dispatch.
    legacy: "stateless",
    responseMode: "json",
  });

  return Object.freeze({
    maxBodyBytes,
    maxResponseBytes,
    close: handler.close,
    handle: async (request: Request): Promise<Response> => {
      const correlationId = deriveMcpCorrelationId(request.headers.get(MCP_CORRELATION_HEADER));
      const url = new URL(request.url);
      if (url.pathname !== "/mcp") return httpError(404, "MCP_NOT_FOUND", correlationId, "Not Found");
      if (!isAllowedHost(request, url, allowedHosts)) return httpError(403, "MCP_HOST_NOT_ALLOWED", correlationId, "MCP host is not allowed");
      if (!isAllowedOrigin(request, allowedOrigins)) return httpError(403, "MCP_ORIGIN_NOT_ALLOWED", correlationId, "MCP origin is not allowed");
      let authorized: boolean | McpExecutionContext = false;
      try {
        authorized = await authorize(request);
      } catch {
        authorized = false;
      }
      if (!authorized) {
        return httpError(401, "MCP_AUTH_REQUIRED", correlationId, "MCP authentication required", {
          "www-authenticate": options.oauthResourceMetadataUrl
            ? `Bearer resource_metadata="${options.oauthResourceMetadataUrl}"`
            : "Bearer",
        });
      }
      const expectedAudience = options.expectedAudience ?? `${url.origin}/mcp`;
      const executionContext = typeof authorized === "object" ? validateMcpExecutionContext(authorized, expectedAudience) : null;
      if (!executionContext) {
        return httpError(401, "MCP_AUTH_CONTEXT_INVALID", correlationId, "MCP authentication context is invalid");
      }
      if (request.method !== "POST") {
        return httpError(405, "MCP_METHOD_NOT_ALLOWED", correlationId, "MCP requires POST", { allow: "POST" });
      }
      if (!acceptsJsonOrEventStream(request.headers.get("accept"))) {
        return httpError(406, "MCP_ACCEPT_UNSUPPORTED", correlationId, "MCP requires an application/json or text/event-stream Accept header");
      }
      if (!isJsonContentType(request.headers.get("content-type"))) {
        return httpError(415, "MCP_CONTENT_TYPE_UNSUPPORTED", correlationId, "MCP requests must use application/json");
      }
      const contentLength = request.headers.get("content-length");
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBodyBytes)) {
        return httpError(413, "MCP_REQUEST_TOO_LARGE", correlationId, "MCP request body exceeds the configured limit");
      }
      // Read a clone so the SDK receives the original, untouched Web Request.
      let bodyBytes: ArrayBuffer;
      try {
        bodyBytes = await request.clone().arrayBuffer();
      } catch {
        return httpError(400, "MCP_BODY_UNREADABLE", correlationId, "Unable to read MCP request body");
      }
      if (bodyBytes.byteLength > maxBodyBytes) return httpError(413, "MCP_REQUEST_TOO_LARGE", correlationId, "MCP request body exceeds the configured limit");
      const parsed = parseJsonRpcBody(new TextDecoder().decode(bodyBytes));
      if (!parsed.valid) return protocolError(correlationId, parsed.id);
      const quotaContext = executionContext;
      const tool = jsonRpcToolName(parsed.value);
      const cost = jsonRpcCost(parsed.value);
      let quota: McpRateLimitDecision;
      try {
        quota = await rateLimiter.consume({
          clientId: quotaContext.clientId,
          workspaceId: quotaContext.workspaceId,
          tool,
          cost,
        });
      } catch {
        quota = { allowed: false, retryAfterSeconds: 1 };
      }
      if (!isRateLimitDecision(quota) || !quota.allowed) {
        return rateLimitError(correlationId, isRateLimitDecision(quota) ? quota.retryAfterSeconds : undefined);
      }
      // The SDK owns era classification and protocol negotiation. In
      // particular, do not validate MCP-Protocol-Version against the legacy
      // SUPPORTED_PROTOCOL_VERSIONS list here: 2026-07-28 is a modern
      // per-request envelope revision and must reach createMcpHandler.
      const sdkResponse = await handler.fetch(request, {
        authInfo: {
          // The token has already been validated by the OAuth boundary and
          // is deliberately not propagated to MCP tool callbacks.
          token: "",
          clientId: executionContext.clientId,
          scopes: [...executionContext.scopes],
          resource: new URL(executionContext.audience),
          extra: {
            userId: executionContext.userId,
            workspaceId: executionContext.workspaceId,
            clientId: executionContext.clientId,
            role: executionContext.role,
            scopes: [...executionContext.scopes],
            audience: executionContext.audience,
            correlationId,
          },
        },
      });
      return boundResponse(sdkResponse, correlationId, maxResponseBytes);
    },
  });
}

function createServer(capabilities: RuntimeCapabilities, authExtra?: Record<string, unknown>): McpServer {
  const server = new McpServer({ name: "noosphere", version: "0.0.0" });
  const traceInput = z.object({
    traceId: z.string().max(128).optional(),
    message: z.string().max(4_096).optional(),
  });
  server.registerTool("noosphere_ping", {
    description: "Return a request-local health trace without accessing providers or persistence.",
    inputSchema: traceInput,
  }, async ({ traceId, message }) => traceResult(traceId, message, correlationIdFromExtra(authExtra)));
  server.registerTool("tracer", {
    description: "Emit a request-local trace marker for MCP Inspector smoke tests.",
    inputSchema: traceInput,
  }, async ({ traceId, message }) => traceResult(traceId, message, correlationIdFromExtra(authExtra)));
  server.registerResource("runtime", "noosphere://runtime", {
    description: "Read-only composed runtime capability summary.",
    mimeType: "application/json",
  }, async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({ status: "ok", capabilities: Object.keys(capabilities) }),
    }],
  }));
  const context = executionContextFromExtra(authExtra);
  if (context && capabilities.mcpRead) {
    registerMcpReadTools(server, capabilities.mcpRead, context);
    registerMcpReadResources(server, capabilities.mcpRead, context);
  }
  if (context && capabilities.mcpWrite) registerMcpWriteTools(server, capabilities.mcpWrite, context);
  if (context && capabilities.mcpGovernedEffects) registerMcpGovernedEffectTools(server, capabilities.mcpGovernedEffects, context);
  return server;
}

function executionContextFromExtra(extra: Record<string, unknown> | undefined): McpExecutionContext | null {
  if (!extra) return null;
  const userId = typeof extra.userId === "string" ? extra.userId : null;
  const workspaceId = typeof extra.workspaceId === "string" ? extra.workspaceId : null;
  const clientId = typeof extra.clientId === "string" ? extra.clientId : null;
  const role = typeof extra.role === "string" ? extra.role : null;
  const audience = typeof extra.audience === "string" ? extra.audience : null;
  const scopes = Array.isArray(extra.scopes) && extra.scopes.every((scope) => scope === "mcp:read" || scope === "mcp:write" || scope === "mcp:approve")
    ? extra.scopes as McpExecutionContext["scopes"]
    : null;
  if (!userId || !workspaceId || !clientId || !audience || !scopes || !["viewer", "operator", "reviewer", "admin", "owner"].includes(role ?? "")) return null;
  return { userId, workspaceId, clientId, role: role as McpExecutionContext["role"], scopes, audience };
}

function traceResult(traceId: string | undefined, message: string | undefined, correlationId: string) {
  const value = {
    ok: true as const,
    correlationId,
    ...(traceId === undefined ? {} : { traceId }),
    ...(message === undefined ? {} : { message }),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function httpError(status: number, code: string, correlationId: string, message: string, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ error: code, code, message, correlationId, retryable: status === 429 }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", [MCP_CORRELATION_HEADER]: correlationId, ...extraHeaders },
  });
}

function protocolError(correlationId: string, id: string | number | null): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32600,
      message: "Invalid Request",
      data: { code: "INVALID_JSON_RPC", correlationId },
    },
  }), {
    status: 400,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", [MCP_CORRELATION_HEADER]: correlationId },
  });
}

function rateLimitError(correlationId: string, retryAfterSeconds: number | undefined): Response {
  const retryAfter = normalizeRetryAfter(retryAfterSeconds);
  return httpError(429, "RATE_LIMITED", correlationId, "MCP request rate limit exceeded", { "retry-after": String(retryAfter) });
}

function isRateLimitDecision(value: unknown): value is McpRateLimitDecision {
  if (!value || typeof value !== "object" || !("allowed" in value) || typeof value.allowed !== "boolean") return false;
  if (!("retryAfterSeconds" in value)) return true;
  const retryAfterSeconds = value.retryAfterSeconds;
  return typeof retryAfterSeconds === "number" && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= 86_400;
}

function normalizeRetryAfter(value: number | undefined): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 86_400) return value;
  return 1;
}

type ParsedJsonRpc = { readonly valid: true; readonly value: unknown; readonly id: string | number | null }
  | { readonly valid: false; readonly id: string | number | null };

function parseJsonRpcBody(body: string): ParsedJsonRpc {
  let value: unknown;
  try { value = JSON.parse(body) as unknown; } catch { return { valid: false, id: null }; }
  if (Array.isArray(value)) return { valid: true, value, id: null };
  if (!value || typeof value !== "object") return { valid: false, id: null };
  const record = value as Record<string, unknown>;
  const id = jsonRpcId(record.id);
  if (record.id !== undefined && id === undefined) return { valid: false, id: null };
  if (record.jsonrpc !== "2.0") return { valid: false, id: id ?? null };
  if (record.method === undefined && ("result" in record || "error" in record)) return { valid: true, value: record, id: id ?? null };
  if (typeof record.method !== "string" || record.method.length === 0 || record.method.length > 200 || !/^[\x21-\x7e]+$/.test(record.method)) return { valid: false, id: id ?? null };
  if (record.params !== undefined && (!record.params || typeof record.params !== "object")) return { valid: false, id: id ?? null };
  return { valid: true, value: record, id: id ?? null };
}

function jsonRpcId(value: unknown): string | number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.length <= 200) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function jsonRpcToolName(value: unknown): string {
  if (Array.isArray(value)) return "rpc:batch";
  if (!value || typeof value !== "object") return "rpc:invalid";
  const record = value as Record<string, unknown>;
  if (record.method !== "tools/call") return typeof record.method === "string" ? record.method : "rpc:response";
  const params = record.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return "tools/call";
  const name = (params as Record<string, unknown>).name;
  return typeof name === "string" && name.length > 0 && name.length <= 200 && /^[\x21-\x7e]+$/.test(name) ? name : "tools/call";
}

function jsonRpcCost(value: unknown): number {
  if (!Array.isArray(value)) return 1;
  return Math.max(1, Math.min(100, value.length));
}

function correlationIdFromExtra(extra: Record<string, unknown> | undefined): string {
  return typeof extra?.correlationId === "string" ? extra.correlationId : crypto.randomUUID();
}

async function boundResponse(response: Response, correlationId: string, maxResponseBytes: number): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set(MCP_CORRELATION_HEADER, correlationId);
  if (!response.body) return new Response(null, { status: response.status, statusText: response.statusText, headers });
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    return httpError(502, "MCP_RESPONSE_UNREADABLE", correlationId, "MCP response could not be read");
  }
  if (bytes.byteLength > maxResponseBytes) {
    return httpError(500, "MCP_RESPONSE_TOO_LARGE", correlationId, "MCP response exceeds the configured limit");
  }
  headers.delete("content-length");
  headers.set("content-length", String(bytes.byteLength));
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
}

function acceptsJsonOrEventStream(value: string | null): boolean {
  if (!value) return false;
  return value.split(",").some((part) => {
    const mediaType = part.trim().split(";", 1)[0]?.trim().toLowerCase();
    return mediaType === "application/json" || mediaType === "text/event-stream" || mediaType === "*/*";
  });
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function normalizeOrigins(origins: readonly string[]): ReadonlySet<string> {
  return new Set(origins.map((origin) => {
    try { return new URL(origin).origin.toLowerCase(); } catch { return origin.trim().toLowerCase().replace(/\/$/, ""); }
  }).filter(Boolean));
}

function normalizeHosts(hosts: readonly string[]): ReadonlySet<string> {
  return new Set(hosts.map((host) => {
    try { return new URL(host).host.toLowerCase(); } catch { return host.trim().toLowerCase(); }
  }).filter(Boolean));
}

function isAllowedOrigin(request: Request, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return allowedOrigins.has(new URL(origin).origin.toLowerCase()); } catch { return false; }
}

function isAllowedHost(request: Request, url: URL, allowedHosts: ReadonlySet<string>): boolean {
  if (allowedHosts.size === 0) return false;
  const suppliedHost = request.headers.get("host");
  const host = (suppliedHost ?? url.host).toLowerCase();
  return allowedHosts.has(host) || (suppliedHost === null && allowedHosts.has(url.hostname.toLowerCase()));
}
