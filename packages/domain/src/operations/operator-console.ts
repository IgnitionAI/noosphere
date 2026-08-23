const sensitiveKey = /(?:authorization|cookie|token|secret|password|passwd|api.?key|private.?key|access.?key|refresh.?key|credential)/i;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /(?<!\d)(?:\+?\d[\s().-]?){8,15}(?!\d)/g;

export type ConsoleJobRecoveryDisposition = "automatic" | "manual" | "blocked" | "none";

/**
 * A retry is already owned by the durable queue and must not be accelerated by
 * an operator. Provider-facing dead letters are fail-closed unless their error
 * proves that no provider call could have started.
 */
export function consoleJobRecoveryDisposition(input: {
  readonly type: string;
  readonly status: string;
  readonly lastErrorCode: string | null;
}): ConsoleJobRecoveryDisposition {
  if (input.status === "retry") return "automatic";
  if (input.status !== "dead_lettered") return "none";
  if (input.type !== "outreach.dispatch") return "manual";
  if (input.lastErrorCode === "CAMPAIGN_JIT_GENERATION_FAILED") return "manual";
  if ([
    "OUTSIDE_SENDING_WINDOW",
    "OUTSIDE_SENDING_WINDOW_EXHAUSTED",
    "LINKEDIN_INVITE_RECENT",
    "LINKEDIN_RELATION_PENDING",
    "UNIPILE_PROVIDER_LIMIT",
  ].includes(input.lastErrorCode ?? "")) return "automatic";
  return "blocked";
}

export function sanitizeOperationalPayload(value: unknown, maximumLength = 2_000): unknown {
  const sanitized = sanitize(value, new WeakSet<object>());
  const serialized = JSON.stringify(sanitized);
  if (serialized.length <= maximumLength) return sanitized;
  return { truncated: true, preview: redactScalar(serialized.slice(0, maximumLength)) };
}

function sanitize(value: unknown, visited: WeakSet<object>): unknown {
  if (typeof value === "string") return redactScalar(value);
  if (typeof value !== "object" || value === null) return value;
  if (visited.has(value)) return "[CIRCULAR]";
  visited.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitize(entry, visited));
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    result[key] = sensitiveKey.test(key) ? "[REDACTED]" : sanitize(entry, visited);
  }
  return result;
}

function redactScalar(value: string): string {
  return value.replace(email, "[EMAIL_REDACTED]").replace(phone, "[PHONE_REDACTED]");
}
