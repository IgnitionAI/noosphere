import { expect, test } from "bun:test";
import { assertSignal, expirationForSignalType, signalIsCurrent } from "@outbound/domain/crm/intent-signal";
import { CrawlerSignalSource } from "@outbound/infrastructure/crm/crawler-signal-source";

test("signal expiration is deterministic and current status excludes expired history", () => {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const expiresAt = expirationForSignalType("hiring", observedAt);
  expect(expiresAt.toISOString()).toBe("2026-02-15T00:00:00.000Z");
  expect(signalIsCurrent({ expiresAt }, new Date("2026-02-14T23:59:59.000Z"))).toBe(true);
  expect(signalIsCurrent({ expiresAt }, new Date("2026-02-15T00:00:00.000Z"))).toBe(false);
});
test("competitor signals require an authorized source", () => {
  expect(() => assertSignal({ signalType: "competitor", entityType: "company", evidenceUrl: "https://example.test", observedAt: new Date(), expiresAt: new Date(Date.now() + 1000), confidence: "low", deduplicationKey: "key", legalBasis: "public", sourceAuthorized: false })).toThrow("SIGNAL_SOURCE_NOT_AUTHORIZED");
});

test("crawler adapter only emits observations backed by matching public evidence", async () => {
  const source = new CrawlerSignalSource({
    async search() {
      return [{ url: "https://example.test/careers", canonicalUrl: null, title: "We are hiring engineers", description: "Join our team", markdown: null, contentHash: "hash", collectedAt: "2026-01-01T00:00:00.000Z", provider: "fake" }];
    },
  });
  const observations = await source.collect({ workspaceId: "workspace", entityType: "company", entityId: "company", companyId: "company", contactId: null, signalTypes: ["hiring", "competitor"], correlationId: "correlation", requestKey: "request" });
  expect(observations).toHaveLength(1);
  expect(observations[0]?.signalType).toBe("hiring");
  expect(observations[0]?.evidenceUrl).toBe("https://example.test/careers");
});
