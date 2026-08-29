import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";

/** The maximum body accepted by the stateless MCP endpoint. */
export const MCP_MAX_BODY_BYTES = 1_048_576;

export interface McpTransportOptions {
  readonly capabilities: RuntimeCapabilities;
  /** Return true only when the request has a valid application identity. */
  readonly authorize?: (request: Request) => Promise<boolean> | boolean;
  /** Exact origins allowed to send browser requests; an absent Origin is allowed. */
  readonly allowedOrigins?: readonly string[];
  /** Hostnames (or host:port values) accepted by the endpoint. */
  readonly allowedHosts?: readonly string[];
  readonly maxBodyBytes?: number;
}

export interface McpTransport {
  readonly handle: (request: Request) => Promise<Response>;
  readonly close: () => Promise<void>;
  readonly maxBodyBytes: number;
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
  const allowedOrigins = normalizeOrigins(options.allowedOrigins ?? []);
  const allowedHosts = normalizeHosts(options.allowedHosts ?? []);
  const authorize = options.authorize ?? (() => false);
  const handler = createMcpHandler(() => createServer(options.capabilities), {
    // Keep the legacy (2025) path stateless and force JSON responses for the
    // modern path. The SDK handles initialize, negotiation, JSON-RPC errors,
    // notification acknowledgements and tool/resource dispatch.
    legacy: "stateless",
    responseMode: "json",
  });

  return Object.freeze({
    maxBodyBytes,
    close: handler.close,
    handle: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.pathname !== "/mcp") return httpError(404, "Not Found");
      if (!isAllowedHost(request, url, allowedHosts)) return httpError(403, "MCP host is not allowed");
      if (!isAllowedOrigin(request, allowedOrigins)) return httpError(403, "MCP origin is not allowed");
      let authorized = false;
      try {
        authorized = await authorize(request);
      } catch {
        authorized = false;
      }
      if (!authorized) {
        return new Response(JSON.stringify({ error: "MCP authentication required" }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8", "www-authenticate": "Bearer" },
        });
      }
      if (request.method !== "POST") {
        return new Response(null, { status: 405, headers: { allow: "POST" } });
      }
      if (!acceptsJsonOrEventStream(request.headers.get("accept"))) {
        return httpError(406, "MCP requires an application/json or text/event-stream Accept header");
      }
      if (!isJsonContentType(request.headers.get("content-type"))) {
        return httpError(415, "MCP requests must use application/json");
      }
      const contentLength = request.headers.get("content-length");
      if (contentLength !== null && Number(contentLength) > maxBodyBytes) {
        return httpError(413, "MCP request body exceeds 1 MiB");
      }
      // Read a clone so the SDK receives the original, untouched Web Request.
      let bodyBytes: ArrayBuffer;
      try {
        bodyBytes = await request.clone().arrayBuffer();
      } catch {
        return httpError(400, "Unable to read MCP request body");
      }
      if (bodyBytes.byteLength > maxBodyBytes) return httpError(413, "MCP request body exceeds 1 MiB");
      // The SDK owns era classification and protocol negotiation. In
      // particular, do not validate MCP-Protocol-Version against the legacy
      // SUPPORTED_PROTOCOL_VERSIONS list here: 2026-07-28 is a modern
      // per-request envelope revision and must reach createMcpHandler.
      return handler.fetch(request);
    },
  });
}

function createServer(capabilities: RuntimeCapabilities): McpServer {
  const server = new McpServer({ name: "noosphere", version: "0.0.0" });
  const traceInput = z.object({
    traceId: z.string().optional(),
    message: z.string().optional(),
  });
  server.registerTool("noosphere_ping", {
    description: "Return a request-local health trace without accessing providers or persistence.",
    inputSchema: traceInput,
  }, async ({ traceId, message }) => traceResult(traceId, message));
  server.registerTool("tracer", {
    description: "Emit a request-local trace marker for MCP Inspector smoke tests.",
    inputSchema: traceInput,
  }, async ({ traceId, message }) => traceResult(traceId, message));
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
  return server;
}

function traceResult(traceId: string | undefined, message: string | undefined) {
  const value = {
    ok: true as const,
    ...(traceId === undefined ? {} : { traceId }),
    ...(message === undefined ? {} : { message }),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function httpError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
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
