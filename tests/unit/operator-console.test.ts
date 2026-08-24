import { describe, expect, test } from "bun:test";
import { consoleJobRecoveryDisposition, sanitizeOperationalPayload } from "@outbound/domain/operations/operator-console";

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

  test("separates automatic retries from safe manual recovery and unknown provider effects", () => {
    expect(consoleJobRecoveryDisposition({ type: "prospecting.channel.assess", status: "retry", lastErrorCode: "CHANNEL_ASSESSMENT_FAILED" })).toBe("automatic");
    expect(consoleJobRecoveryDisposition({ type: "outreach.dispatch", status: "dead_lettered", lastErrorCode: "CAMPAIGN_JIT_GENERATION_FAILED" })).toBe("manual");
    expect(consoleJobRecoveryDisposition({ type: "outreach.dispatch", status: "dead_lettered", lastErrorCode: "ACTION_EXECUTION_STATE_UNKNOWN" })).toBe("blocked");
    expect(consoleJobRecoveryDisposition({ type: "outreach.dispatch", status: "dead_lettered", lastErrorCode: "OUTSIDE_SENDING_WINDOW" })).toBe("automatic");
  });
});
