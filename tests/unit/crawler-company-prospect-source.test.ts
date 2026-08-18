import { describe, expect, test } from "bun:test";
import { emptyProspectChannels } from "@outbound/domain/crm/prospect-channels";
import type { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";
import { CrawlerCompanyProspectSource } from "@outbound/infrastructure/crm/crawler-company-prospect-source";
import type { ProspectSource } from "@outbound/infrastructure/crm/unipile-prospect-source";

describe("CrawlerCompanyProspectSource", () => {
  test("compiles a long Boolean ICP policy into short company-discovery queries", async () => {
    const queries: string[] = [];
    const limits: number[] = [];
    const crawler = {
      async search(input: { query: string; limit: number }) {
        queries.push(input.query);
        limits.push(input.limit);
        return [];
      },
      async readPages() { return []; },
      async discover() { return []; },
    } as unknown as CrawlerClient;
    const source = new CrawlerCompanyProspectSource(crawler, () => noLinkedinSource());

    await source.searchCompanies({
      workspaceId: crypto.randomUUID(),
      channel: "email",
      query: 'France (Paris OR Lyon OR Marseille) ("expertise comptable" OR "audit légal" OR "commissariat aux comptes") (NAF 69.20Z OR 70.10Z) (200+ employés) ("programme IA" OR "transformation digitale") -Harvey -Luminance -ESN',
      sourceKinds: ["web"],
      limit: null,
      correlationId: "campaign:test-query-compiler",
    });

    expect(queries).toEqual([
      "France Paris expertise comptable site officiel entreprise équipe",
      "France Lyon audit légal site officiel entreprise équipe",
      "France Marseille commissariat aux comptes site officiel entreprise équipe",
    ]);
    expect(queries.every((query) => query.length <= 220)).toBe(true);
    expect(queries.join(" ")).not.toContain("Harvey");
    expect(queries.join(" ")).not.toContain("NAF");
    expect(limits.every((limit) => limit <= 10)).toBe(true);
  });

  test("sources professional email candidates from company websites without LinkedIn", async () => {
    const source = new CrawlerCompanyProspectSource(
      fakeCrawler("Équipe\nmarie.durand@cabinet-durand.fr\ncontact@cabinet-durand.fr"),
      () => noLinkedinSource(),
    );

    const { candidates } = await source.searchCompanies({
      workspaceId: crypto.randomUUID(),
      channel: "email",
      query: "cabinet avocat conformité",
      sourceKinds: ["web", "professional_directory"],
      limit: 10,
      correlationId: "campaign:test",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      fullName: "Marie Durand",
      companyDomain: "cabinet-durand.fr",
      channels: {
        linkedin: { status: "unavailable" },
        email: {
          normalizedValue: "marie.durand@cabinet-durand.fr",
          source: "public_web",
        },
        whatsapp: { status: "unavailable" },
      },
    });
  });

  test("rejects external-directory, asset-like and role-based email addresses", async () => {
    const source = new CrawlerCompanyProspectSource(
      fakeCrawler([
        "someone@external-directory.org",
        "image@2x.png",
        "service.commercial@cabinet-durand.fr",
        "communication@cabinet-durand.fr",
      ].join("\n")),
      () => noLinkedinSource(),
    );

    const result = await source.searchCompanies({
      workspaceId: crypto.randomUUID(),
      channel: "email",
      query: "cabinet avocat conformité",
      sourceKinds: ["web"],
      limit: 10,
      correlationId: "campaign:test-rejected-emails",
    });

    expect(result.candidates).toHaveLength(0);
  });

  test("finds team pages with a targeted same-domain search instead of crawling a whole site", async () => {
    let discoverCalls = 0;
    const crawler = {
      async search(input: { query: string }) {
        return input.query.startsWith("site:")
          ? [{ url: "https://cabinet-durand.fr/equipe", canonicalUrl: "https://cabinet-durand.fr/equipe", title: "Équipe", description: "Notre équipe", provider: "searxng" }]
          : [{ url: "https://cabinet-durand.fr", canonicalUrl: "https://cabinet-durand.fr", title: "Cabinet Durand", description: "Cabinet", provider: "searxng" }];
      },
      async readPages(input: { urls: readonly string[] }) {
        return input.urls.map((url) => ({
          url,
          canonicalUrl: url,
          title: url.endsWith("/equipe") ? "Équipe" : "Accueil",
          markdown: url.endsWith("/equipe") ? "Marie Durand — marie.durand@cabinet-durand.fr" : "Bienvenue",
          contentHash: "hash",
          collectedAt: "2026-08-02T10:00:00.000Z",
          metadata: {},
        }));
      },
      async discover() { discoverCalls += 1; return []; },
    } as unknown as CrawlerClient;
    const source = new CrawlerCompanyProspectSource(crawler, () => noLinkedinSource());

    const result = await source.searchCompanies({
      workspaceId: crypto.randomUUID(),
      channel: "email",
      query: "cabinet avocat conformité",
      sourceKinds: ["web"],
      limit: 10,
      correlationId: "campaign:test-targeted-pages",
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.channels.email.normalizedValue).toBe("marie.durand@cabinet-durand.fr");
    expect(discoverCalls).toBe(0);
  });

  test("keeps sourcing after one company page is rejected by the crawler", async () => {
    const crawler = {
      async search(input: { query: string }) {
        if (input.query.startsWith("site:broken.example")) return [];
        if (input.query.startsWith("site:cabinet-durand.fr")) {
          return [{ url: "https://cabinet-durand.fr/equipe", canonicalUrl: "https://cabinet-durand.fr/equipe", title: "Équipe", description: "Équipe", provider: "searxng" }];
        }
        return [
          { url: "https://broken.example", canonicalUrl: "https://broken.example", title: "Broken", description: "Broken", provider: "searxng" },
          { url: "https://cabinet-durand.fr", canonicalUrl: "https://cabinet-durand.fr", title: "Cabinet Durand", description: "Cabinet", provider: "searxng" },
        ];
      },
      async readPages(input: { urls: readonly string[] }) {
        if (input.urls.some((url) => url.includes("broken.example"))) throw new Error("Crawler returned 422");
        return [{
          url: "https://cabinet-durand.fr/equipe",
          canonicalUrl: "https://cabinet-durand.fr/equipe",
          title: "Équipe",
          markdown: "Marie Durand — marie.durand@cabinet-durand.fr",
          contentHash: "hash",
          collectedAt: "2026-08-02T10:00:00.000Z",
          metadata: {},
        }];
      },
      async discover() { return []; },
    } as unknown as CrawlerClient;
    const source = new CrawlerCompanyProspectSource(crawler, () => noLinkedinSource());

    const result = await source.searchCompanies({
      workspaceId: crypto.randomUUID(),
      channel: "email",
      query: "cabinet avocat conformité",
      sourceKinds: ["web"],
      limit: null,
      correlationId: "campaign:test-partial-crawl",
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.channels.email.normalizedValue).toBe("marie.durand@cabinet-durand.fr");
    expect(result.metrics.pageAttemptCount).toBeGreaterThanOrEqual(2);
  });

  test("keeps only phone numbers verified as WhatsApp by the channel provider", async () => {
    const source = new CrawlerCompanyProspectSource(
      fakeCrawler("Portable : +33 6 12 34 56 78"),
      () => ({
        async searchPeople() { return []; },
        async verifyWhatsappNumber(phone) {
          return {
            ...emptyProspectChannels().whatsapp,
            value: phone,
            normalizedValue: "+33612345678",
            status: "verified",
            confidence: "high",
            source: "unipile_whatsapp_profile",
          };
        },
      }),
    );

    const { candidates, observations } = await source.searchCompanies({
      workspaceId: crypto.randomUUID(),
      channel: "whatsapp",
      query: "cabinet avocat conformité",
      sourceKinds: ["maps"],
      limit: 10,
      correlationId: "campaign:test",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.channels.whatsapp).toMatchObject({
      status: "verified",
      source: "unipile_whatsapp_profile",
      evidenceUrl: "https://cabinet-durand.fr/contact",
    });
    expect(observations[0]).toMatchObject({
      attributionStatus: "strong",
      reachabilityStatus: "verified",
      evidenceSnippet: expect.stringContaining("Portable"),
    });
  });
});

function fakeCrawler(markdown: string): CrawlerClient {
  return {
    async search() {
      return [{
        url: "https://cabinet-durand.fr/contact",
        canonicalUrl: "https://cabinet-durand.fr/contact",
        title: "Cabinet Durand — Avocats",
        description: "Cabinet d’avocats",
        provider: "searxng",
      }];
    },
    async readPages() {
      return [{
        url: "https://cabinet-durand.fr/contact",
        canonicalUrl: "https://cabinet-durand.fr/contact",
        title: "Contact",
        markdown,
        contentHash: "hash",
        collectedAt: "2026-08-02T10:00:00.000Z",
        metadata: {},
      }];
    },
    async discover() {
      return [{
        url: "https://cabinet-durand.fr/contact",
        title: "Contact",
        depth: 1,
        path: "/contact",
      }];
    },
  } as unknown as CrawlerClient;
}
function noLinkedinSource(): ProspectSource {
  return {
    async searchPeople() {
      throw new Error("LinkedIn must not be used for company-first sourcing");
    },
  };
}
