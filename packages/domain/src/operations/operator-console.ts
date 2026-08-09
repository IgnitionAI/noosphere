const sensitiveKey = /(?:authorization|cookie|token|secret|password|passwd|api.?key|private.?key|access.?key|refresh.?key|credential)/i;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /(?<!\d)(?:\+?\d[\s().-]?){8,15}(?!\d)/g;

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
