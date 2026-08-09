import { describe, expect, test } from "bun:test";
import { sanitizeOperationalPayload } from "@outbound/domain/operations/operator-console";

describe("F-003 operator console payload safety", () => {
  test("redacts secrets and unnecessary personal coordinates recursively", () => {
    const result = sanitizeOperationalPayload({
      authorization: "Bearer super-secret",
      nested: { apiKey: "secret-key", email: "person@example.com", phone: "+33 6 12 34 56 78" },
      harmless: "PROVIDER_UNAVAILABLE",
    });
    expect(result).toEqual({
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", email: "[EMAIL_REDACTED]", phone: "[PHONE_REDACTED]" },
      harmless: "PROVIDER_UNAVAILABLE",
    });
  });

  test("returns a bounded preview for oversized payloads", () => {
    const result = sanitizeOperationalPayload({ content: "x".repeat(4_000) }, 100) as { truncated: boolean; preview: string };
    expect(result.truncated).toBe(true);
    expect(result.preview.length).toBeLessThanOrEqual(100);
  });
});
