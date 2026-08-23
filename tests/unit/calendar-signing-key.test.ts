import { describe, expect, test } from "bun:test";
import { resolveCalendarSigningKey } from "@outbound/infrastructure/calendar/calendar-signing-key";

describe("resolveCalendarSigningKey", () => {
  test("uses Better Auth when the optional calendar key is blank", () => {
    expect(resolveCalendarSigningKey({
      CALENDAR_WEBHOOK_SIGNING_KEY: "  ",
      BETTER_AUTH_SECRET: "b".repeat(32),
    })).toBe("b".repeat(32));
  });

  test("prefers the dedicated calendar key", () => {
    expect(resolveCalendarSigningKey({
      CALENDAR_WEBHOOK_SIGNING_KEY: `  ${"c".repeat(32)}  `,
      BETTER_AUTH_SECRET: "b".repeat(32),
    })).toBe("c".repeat(32));
  });

  test("rejects a missing or weak effective key", () => {
    expect(() => resolveCalendarSigningKey({})).toThrow(
      "CALENDAR_WEBHOOK_SIGNING_KEY_OR_BETTER_AUTH_SECRET_REQUIRED",
    );
    expect(() => resolveCalendarSigningKey({ BETTER_AUTH_SECRET: "weak" })).toThrow(
      "CALENDAR_WEBHOOK_SIGNING_KEY_TOO_SHORT",
    );
  });
});
