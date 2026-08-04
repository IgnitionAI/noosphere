import { describe, expect, test } from "bun:test";
import type { ChannelStrategy } from "@outbound/application/campaigns/channel-assessment";
import {
  buildLinkedinSearchQueries,
  compactLinkedinKeywords,
  RoutedChannelObservationSource,
} from "@outbound/infrastructure/campaigns/channel-observation-source";
import type { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";
import type { ProspectSource } from "@outbound/infrastructure/crm/unipile-prospect-source";

const version = { criteria: {}, buyingCommittee: [] };

describe("routed channel observation", () => {
  test("uses LinkedIn people search only for a LinkedIn assessment", async () => {
    let crawlerCalls = 0;
    let linkedinKeywords = "";
    const crawler = {
      async search() { crawlerCalls += 1; return []; },
      async readPages() { crawlerCalls += 1; return []; },
    } as unknown as CrawlerClient;
    const source: ProspectSource = {
      async searchPeople(filters) {
        linkedinKeywords = filters.keywords;
        return [
          {
            fullName: "Alice Martin",
            headline: "Managing Partner",
            linkedinUrl: "https://www.linkedin.com/in/alice-martin/",
            location: "Paris",
            companyName: "Cabinet Martin",
            providerData: {},
            channels: {
              linkedin: { value: "https://www.linkedin.com/in/alice-martin/", normalizedValue: "linkedin.com/in/alice-martin", status: "verified", confidence: "high", source: "unipile" },
              email: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
              whatsapp: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
            },
          },
        ];
      },
    };
    const observer = new RoutedChannelObservationSource(crawler, () => source);
    const result = await observer.observe({
      workspaceId: crypto.randomUUID(),
      assessmentId: crypto.randomUUID(),
      channel: "linkedin",
      strategy: strategy("linkedin"),
      version,
    });
    expect(result.metrics.peopleFound).toBe(1);
    expect(result.metrics.eligibleIdentities).toBe(1);
    expect(crawlerCalls).toBe(0);
    expect(linkedinKeywords).toBe("cabinets juridiques France");
  });

  test("compacts a large Boolean strategy into balanced provider-safe keywords", () => {
    const compact = compactLinkedinKeywords(
      '("Associé" OR "Managing Partner" OR "Directeur juridique") AND ("M&A" OR "due diligence" OR fiscalité) AND France AND (SharePoint OR OneDrive) NOT (Harvey OR Legora)',
    );
    expect(compact).toBe(
      "Associé M&A France SharePoint Managing Partner due diligence OneDrive Directeur juridique fiscalité",
    );
    expect(compact.length).toBeLessThanOrEqual(180);
    expect(compact).not.toContain("Harvey");
  });

  test("turns the buying committee into several small LinkedIn searches", () => {
    expect(
      buildLinkedinSearchQueries(strategy("linkedin"), {
        buyingCommittee: [
          "Directeur juridique",
          "Responsable legal operations",
          "DPO",
          "CISO",
          "DAF",
        ],
        criteria: {
          industries: ["Direction juridique"],
          geographies: ["France", "Paris"],
        },
      }),
    ).toEqual([
      "Directeur juridique Direction juridique France",
      "Responsable legal operations Direction juridique France",
      "DPO Direction juridique France",
      "CISO Direction juridique France",
    ]);
  });

  test("uses public company pages for email and never calls LinkedIn search", async () => {
    let linkedinCalls = 0;
    const crawler = {
      async search() {
        return [{
          url: "https://cabinet-martin.fr",
          canonicalUrl: "https://cabinet-martin.fr",
          title: "Cabinet Martin",
          description: "Cabinet juridique à Paris",
          provider: "searxng",
        }];
      },
      async readPages() {
        return [{
          url: "https://cabinet-martin.fr/equipe",
          canonicalUrl: "https://cabinet-martin.fr/equipe",
          title: "Équipe",
          markdown: "Alice Martin — alice.martin@cabinet-martin.fr",
          metadata: {},
        }];
      },
    } as unknown as CrawlerClient;
    const source: ProspectSource = {
      async searchPeople() { linkedinCalls += 1; return []; },
    };
    const observer = new RoutedChannelObservationSource(crawler, () => source);
    const result = await observer.observe({
      workspaceId: crypto.randomUUID(),
      assessmentId: crypto.randomUUID(),
      channel: "email",
      strategy: strategy("web"),
      version,
    });
    expect(result.metrics.accountsFound).toBe(1);
    expect(result.metrics.eligibleIdentities).toBe(1);
    expect(result.metrics.verifiedIdentities).toBe(1);
    expect(linkedinCalls).toBe(0);
  });
});

function strategy(source: "linkedin" | "web"): ChannelStrategy {
  return {
    query: "cabinets juridiques France",
    sourceKinds: [source],
    rationale: "fixture",
    sampleSize: 10,
  };
}
