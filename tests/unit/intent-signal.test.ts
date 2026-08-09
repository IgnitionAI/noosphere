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

test("crawler adapter scopes searches to the target and rejects evidence about another company", async () => {
  const queries: string[] = [];
  const source = new CrawlerSignalSource({
    async search(input) {
      queries.push(input.query);
      return [
        { url: "https://unrelated.test/careers", canonicalUrl: null, title: "Unrelated Corp is hiring engineers", description: "Join their team", markdown: null, contentHash: "unrelated", collectedAt: "2026-01-01T00:00:00.000Z", provider: "fake" },
        { url: "https://directory.test/companies", canonicalUrl: null, title: "Company directory", description: "Business updates", markdown: "Unrelated Corp is hiring engineers.\n\nAcme Legal publishes its annual report.", contentHash: "aggregator", collectedAt: "2026-01-01T00:00:00.000Z", provider: "fake" },
        { url: "https://acme.test/careers", canonicalUrl: null, title: "Acme Legal is hiring engineers", description: "Join Acme Legal", markdown: null, contentHash: "target", collectedAt: "2026-01-01T00:00:00.000Z", provider: "fake" },
      ];
    },
  });
  const observations = await source.collect({
    workspaceId: "workspace", entityType: "company", entityId: "company", companyId: "company", contactId: null,
    target: { displayName: "Acme Legal", aliases: ["Acme Legal"], domains: ["acme.test"] },
    signalTypes: ["hiring", "competitor"], correlationId: "correlation", requestKey: "request",
  });
  expect(queries).toHaveLength(1);
  expect(queries[0]).toContain('"Acme Legal"');
  expect(queries[0]).toContain("acme.test");
  expect(observations).toHaveLength(1);
  expect(observations[0]?.signalType).toBe("hiring");
  expect(observations[0]?.evidenceUrl).toBe("https://acme.test/careers");
});

test("contact signals require the contact name even when the employer matches", async () => {
  const source = new CrawlerSignalSource({
    async search() {
      return [
        { url: "https://news.test/acme-leadership", canonicalUrl: null, title: "Acme Legal appoints a new CTO", description: "Leadership update at Acme Legal", markdown: null, contentHash: "company-only", collectedAt: "2026-01-01T00:00:00.000Z", provider: "fake" },
        { url: "https://news.test/jane-doe", canonicalUrl: null, title: "Jane Doe joins Acme Legal as CTO", description: "Jane Doe starts a new role", markdown: null, contentHash: "person", collectedAt: "2026-01-01T00:00:00.000Z", provider: "fake" },
      ];
    },
  });
  const observations = await source.collect({
    workspaceId: "workspace", entityType: "contact", entityId: "contact", companyId: null, contactId: "contact",
    target: { displayName: "Jane Doe", aliases: ["Jane Doe"], domains: ["acme.test"], contextTerms: ["Acme Legal", "CTO"] },
    signalTypes: ["job_change", "funding"], correlationId: "correlation", requestKey: "request",
  });
  expect(observations).toHaveLength(1);
  expect(observations[0]?.evidenceUrl).toBe("https://news.test/jane-doe");
  expect(observations[0]?.signalType).toBe("job_change");
});
