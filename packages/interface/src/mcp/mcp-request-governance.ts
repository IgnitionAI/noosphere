import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";
import * as z from "zod/v4";

/** Header carrying a request-local, non-secret correlation identifier. */
export const MCP_CORRELATION_HEADER = "x-correlation-id";
export const MCP_MAX_CORRELATION_BYTES = 128;
export const MCP_MAX_CLIENT_ID_BYTES = 200;
export const MCP_MAX_TOOL_NAME_BYTES = 200;
export const MCP_MAX_RESPONSE_BYTES = 1_048_576;
export const MCP_MAX_RATE_LIMIT_COST = 100;

const knownScopes = ["mcp:read", "mcp:write", "mcp:approve"] as const;
const knownRoles = ["viewer", "operator", "reviewer", "admin", "owner"] as const;
const safeIdentifier = /^[\x21-\x7e]+$/;
const safeCorrelation = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const executionContextSchema = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  clientId: z.string().min(1).max(MCP_MAX_CLIENT_ID_BYTES).regex(safeIdentifier),
  role: z.enum(knownRoles),
  scopes: z.array(z.enum(knownScopes)).max(knownScopes.length).refine((scopes) => new Set(scopes).size === scopes.length),
  audience: z.string().url().max(2_048),
}).strict();

/**
 * Validate the identity supplied by an authorization boundary before it is
 * copied into SDK authInfo. The expected audience is supplied by the
 * transport, never by request arguments or an untrusted header.
 */
export function validateMcpExecutionContext(value: unknown, expectedAudience: string): McpExecutionContext | null {
  const parsed = executionContextSchema.safeParse(value);
  if (!parsed.success || !isCanonicalHttpsAudience(parsed.data.audience, expectedAudience)) return null;
  return parsed.data as McpExecutionContext;
}

/** Return a safe inbound correlation value or generate a request-local one. */
export function deriveMcpCorrelationId(value: unknown): string {
  if (typeof value === "string") {
    const candidate = value.trim();
    if (candidate.length <= MCP_MAX_CORRELATION_BYTES && safeCorrelation.test(candidate)) return candidate;
  }
  return crypto.randomUUID();
}

export function isSafeMcpCorrelationId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MCP_MAX_CORRELATION_BYTES && safeCorrelation.test(value);
}

/** A bounded quota decision returned by an in-process or future durable limiter. */
export interface McpRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

export interface McpRateLimitInput {
  readonly clientId: string;
  readonly workspaceId: string;
  readonly tool: string;
  readonly cost: number;
}

/**
 * Transport-level limiter port. Implementations must key from authenticated
 * context values. A malformed decision or thrown error is fail-closed by the
 * transport.
 */
export interface McpRateLimiter {
  readonly consume: (input: McpRateLimitInput) => McpRateLimitDecision | Promise<McpRateLimitDecision>;
}

export interface InMemoryMcpRateLimiterOptions {
  readonly maxCost?: number;
  readonly windowMs?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

type Bucket = { used: number; startedAt: number };

/** Bounded fixed-window limiter suitable for one process and local tests. */
export class InMemoryMcpRateLimiter implements McpRateLimiter {
  readonly #maxCost: number;
  readonly #windowMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(options: InMemoryMcpRateLimiterOptions = {}) {
    const maxCost = options.maxCost ?? 100;
    const windowMs = options.windowMs ?? 60_000;
    const maxEntries = options.maxEntries ?? 10_000;
    if (!Number.isSafeInteger(maxCost) || maxCost < 1 || maxCost > MCP_MAX_RATE_LIMIT_COST) throw new Error("MCP rate limit maxCost is out of bounds");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 86_400_000) throw new Error("MCP rate limit window is out of bounds");
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000) throw new Error("MCP rate limit entries are out of bounds");
    this.#maxCost = maxCost;
    this.#windowMs = windowMs;
    this.#maxEntries = maxEntries;
    this.#now = options.now ?? Date.now;
  }

  consume(input: McpRateLimitInput): McpRateLimitDecision {
    if (!isBoundedRateInput(input)) return { allowed: false, retryAfterSeconds: this.retryAfterSeconds() };
    const now = this.#now();
    const key = `${input.clientId}\u0000${input.workspaceId}\u0000${input.tool}`;
    let bucket = this.#buckets.get(key);
    if (bucket && now - bucket.startedAt >= this.#windowMs) {
      this.#buckets.delete(key);
      bucket = undefined;
    }
    if (!bucket) {
      this.evictExpired(now);
      if (this.#buckets.size >= this.#maxEntries) return { allowed: false, retryAfterSeconds: this.retryAfterSeconds() };
      bucket = { used: 0, startedAt: now };
      this.#buckets.set(key, bucket);
    }
    if (bucket.used + input.cost > this.#maxCost) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((this.#windowMs - (now - bucket.startedAt)) / 1_000)) };
    }
    bucket.used += input.cost;
    return { allowed: true };
  }

  clear(): void {
    this.#buckets.clear();
  }

  private evictExpired(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.startedAt >= this.#windowMs) this.#buckets.delete(key);
    }
  }

  private retryAfterSeconds(): number {
    return Math.max(1, Math.ceil(this.#windowMs / 1_000));
  }
}

function isBoundedRateInput(input: McpRateLimitInput): boolean {
  return typeof input.clientId === "string" && input.clientId.length > 0 && input.clientId.length <= MCP_MAX_CLIENT_ID_BYTES && safeIdentifier.test(input.clientId)
    && typeof input.workspaceId === "string" && input.workspaceId.length > 0 && input.workspaceId.length <= 200 && safeIdentifier.test(input.workspaceId)
    && typeof input.tool === "string" && input.tool.length > 0 && input.tool.length <= MCP_MAX_TOOL_NAME_BYTES && safeIdentifier.test(input.tool)
    && Number.isSafeInteger(input.cost) && input.cost >= 1 && input.cost <= MCP_MAX_RATE_LIMIT_COST;
}

function isCanonicalHttpsAudience(value: string, expected: string): boolean {
  try {
    const actualUrl = new URL(value);
    const expectedUrl = new URL(expected);
    return actualUrl.protocol === "https:"
      && expectedUrl.protocol === "https:"
      && actualUrl.href === expectedUrl.href
      && actualUrl.pathname === "/mcp"
      && actualUrl.search === ""
      && actualUrl.hash === "";
  } catch {
    return false;
  }
}
