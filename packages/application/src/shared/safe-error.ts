const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_.:-]{0,119}$/;

/**
 * Return a bounded, stable error code without exposing an exception's message,
 * stack or serialized payload. Unknown errors intentionally collapse to the
 * boundary's generic code.
 */
export function classifySafeError(value: unknown, fallback = "MCP_INTERNAL_ERROR"): string {
  const safeFallback = SAFE_ERROR_CODE.test(fallback) ? fallback : "MCP_INTERNAL_ERROR";
  if (!value || typeof value !== "object") return safeFallback;
  const candidate = "code" in value ? value.code : undefined;
  return typeof candidate === "string" && SAFE_ERROR_CODE.test(candidate) ? candidate : safeFallback;
}

export function isSafeErrorCode(value: unknown): value is string {
  return typeof value === "string" && SAFE_ERROR_CODE.test(value);
}
