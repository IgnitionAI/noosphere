import { describe, expect, test } from "bun:test";
import {
  PostgresExternalEffectFactsReader,
  connectedAccountCapability,
  enrollmentDigest,
  quotaAvailability,
} from "@outbound/infrastructure/mcp/postgres-external-effect-facts-reader";

describe("PostgresExternalEffectFactsReader", () => {
  test("exposes both facts reader method names and stable enrollment fingerprints", () => {
    const reader = new PostgresExternalEffectFactsReader({} as never);
    expect(typeof reader.read).toBe("function");
    expect(typeof reader.readFacts).toBe("function");
    expect(typeof reader.readPrepare).toBe("function");
    const rows = [
      { id: "enrollment-b", status: "active", sequenceVersionId: "sequence-1", enrolledAt: new Date("2026-08-29T10:00:00.000Z"), completedAt: null, createdAt: new Date("2026-08-29T10:00:00.000Z") },
      { id: "enrollment-a", status: "active", sequenceVersionId: "sequence-1", enrolledAt: new Date("2026-08-29T09:00:00.000Z"), completedAt: null, createdAt: new Date("2026-08-29T09:00:00.000Z") },
    ];
    expect(enrollmentDigest(rows)).toBe(enrollmentDigest([...rows].reverse()));
    expect(enrollmentDigest(rows)).not.toBe(enrollmentDigest(rows.map((row) => ({ ...row, status: "completed" }))));
  });

  test("requires the exact effect capability and fails closed for absent or false values", () => {
    expect(connectedAccountCapability({ messaging: true }, "messaging", "linkedin")).toBe(true);
    expect(connectedAccountCapability({ messaging: false }, "messaging", "linkedin")).toBe(false);
    expect(connectedAccountCapability({ linkedin: true }, "messaging", "linkedin")).toBe(true);
    expect(connectedAccountCapability({ messaging: { linkedin: true } }, "messaging", "linkedin")).toBe(true);
    expect(connectedAccountCapability({}, "messaging", "linkedin")).toBe(false);
  });

  test("supports provider channel capability snapshots without borrowing another effect or channel", () => {
    expect(connectedAccountCapability({ linkedin: { sending: true } }, "messaging", "linkedin")).toBe(true);
    expect(connectedAccountCapability({ linkedin: { messaging: false }, email: { sending: true } }, "messaging", "linkedin")).toBe(false);
    expect(connectedAccountCapability({ linkedin: { messaging: false }, email: { sending: true } }, "content", "linkedin")).toBe(false);
    expect(connectedAccountCapability({ linkedin: true }, "messaging", "linkedin")).toBe(true);
    expect(connectedAccountCapability({ linkedin: { unknown: true } }, "messaging", "linkedin")).toBe(false);
  });

  test("recognizes daily/channel quota shapes and fails closed when unavailable", () => {
    expect(quotaAvailability({ daily: { limit: 10, remaining: 3 } }, "linkedin")).toBe(true);
    expect(quotaAvailability({ daily: { limit: 10, remaining: 0 } }, "linkedin")).toBe(false);
    expect(quotaAvailability({ linkedin: { exceeded: true } }, "linkedin")).toBe(false);
    expect(quotaAvailability({}, "linkedin")).toBe(false);
    expect(quotaAvailability(null, "linkedin")).toBe(false);
  });

  test("supports repository root daily/limit and channel remaining/exceeded quota shapes", () => {
    expect(quotaAvailability({ daily: 10 }, "linkedin")).toBe(true);
    expect(quotaAvailability({ limit: 10 }, "linkedin")).toBe(true);
    expect(quotaAvailability({ daily: 0 }, "linkedin")).toBe(false);
    expect(quotaAvailability({ linkedin: { remaining: 2 } }, "linkedin")).toBe(true);
    expect(quotaAvailability({ linkedin: { remaining: 0 } }, "linkedin")).toBe(false);
    expect(quotaAvailability({ linkedin: { exceeded: false } }, "linkedin")).toBe(true);
    expect(quotaAvailability({ linkedin: { exceeded: true }, daily: 10 }, "linkedin")).toBe(false);
    expect(quotaAvailability({ daily: { remaining: 0 }, limit: 10 }, "linkedin")).toBe(false);
  });
});
