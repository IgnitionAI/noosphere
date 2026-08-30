const SAFE_CODE = /^[A-Z][A-Z0-9_.:-]{0,119}$/;
const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TEXT = /^[\x21-\x7e]{1,200}$/;
const SAFE_HASH = /^[a-f0-9]{64}$/;

export type McpObservationOutcome = "success" | "failure" | "denied";
export type McpAuthDecision = "accepted" | "denied" | "missing" | "invalid";

export interface McpObservabilityEvent {
  readonly event: string;
  readonly correlationId: string;
  readonly durationMs: number;
  readonly outcome: McpObservationOutcome;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly protocolCode?: number;
  readonly authDecision?: McpAuthDecision;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly clientId?: string;
  readonly tool?: string;
  readonly resource?: string;
  readonly entityId?: string;
  readonly inputHash?: string;
}

export interface McpObservabilityPort {
  readonly observe: (event: McpObservabilityEvent) => void;
}

export type McpObservabilityCallback = (event: McpObservabilityEvent) => void;

/**
 * Production logger: serializes only the explicit MCP observation allowlist.
 * `write` is injectable for tests and for process logging adapters.
 */
export function createMcpObservabilityLogger(write: (line: string) => void = (line) => console.info(line)): McpObservabilityPort {
  return {
    observe(event) {
      const safe = sanitizeMcpObservabilityEvent(event);
      write(JSON.stringify(safe));
    },
  };
}

export function sanitizeMcpObservabilityEvent(value: unknown): McpObservabilityEvent {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const event = safeText(input.event, "mcp_request");
  const correlationId = safeText(input.correlationId, "unknown");
  const durationMs = typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
    ? Math.max(0, Math.min(86_400_000, Math.floor(input.durationMs)))
    : 0;
  const outcome = input.outcome === "success" || input.outcome === "denied" ? input.outcome : "failure";
  const safe: Record<string, unknown> = { event, correlationId, durationMs, outcome };
  if (typeof input.code === "string" && SAFE_CODE.test(input.code)) safe.code = input.code;
  if (typeof input.httpStatus === "number" && Number.isSafeInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599) safe.httpStatus = input.httpStatus;
  if (typeof input.protocolCode === "number" && Number.isSafeInteger(input.protocolCode) && input.protocolCode >= -32_768 && input.protocolCode <= 32_767) safe.protocolCode = input.protocolCode;
  if (input.authDecision === "accepted" || input.authDecision === "denied" || input.authDecision === "missing" || input.authDecision === "invalid") safe.authDecision = input.authDecision;
  if (typeof input.userId === "string" && SAFE_ID.test(input.userId)) safe.userId = input.userId;
  if (typeof input.workspaceId === "string" && SAFE_ID.test(input.workspaceId)) safe.workspaceId = input.workspaceId;
  if (typeof input.clientId === "string" && SAFE_TEXT.test(input.clientId)) safe.clientId = input.clientId;
  if (typeof input.tool === "string" && SAFE_TEXT.test(input.tool)) safe.tool = input.tool;
  if (typeof input.resource === "string" && isSafeResource(input.resource)) safe.resource = input.resource;
  if (typeof input.entityId === "string" && SAFE_ID.test(input.entityId)) safe.entityId = input.entityId;
  if (typeof input.inputHash === "string" && SAFE_HASH.test(input.inputHash)) safe.inputHash = input.inputHash;
  return safe as unknown as McpObservabilityEvent;
}

export function recordMcpObservation(
  target: McpObservabilityPort | McpObservabilityCallback | undefined,
  event: McpObservabilityEvent,
): void {
  if (!target) return;
  try {
    if (typeof target === "function") target(sanitizeMcpObservabilityEvent(event));
    else target.observe(sanitizeMcpObservabilityEvent(event));
  } catch {
    // Observability must never change request behavior or disclose logger errors.
  }
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && SAFE_TEXT.test(value) ? value : fallback;
}

function isSafeResource(value: string): boolean {
  if (value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname === "/mcp" && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}
