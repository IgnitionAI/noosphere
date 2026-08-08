import { describe, expect, test } from "bun:test";
import { emptyProspectChannels } from "@outbound/domain/crm/prospect-channels";
import {
  CrawlerProspectEnricher,
  extractNamedContactEvidence,
  selectOfficialWebsite,
  type ProspectEnrichmentCrawler,
} from "@outbound/infrastructure/crm/crawler-prospect-enricher";

const collectedAt = "2026-08-02T12:00:00.000Z";

describe("CrawlerProspectEnricher", () => {
  test("finds the official website and only nominative professional coordinates", async () => {
    const crawler: ProspectEnrichmentCrawler = {
      async search() {
        return [
          {
            url: "https://www.linkedin.com/in/marion-delacroix",
            title: "Marion Delacroix | LinkedIn",
            description: "Associée Cabinet Delacroix",
            provider: "searxng",
          },
          {
            url: "https://cabinet-delacroix.fr/equipe/marion-delacroix",
            canonicalUrl: "https://cabinet-delacroix.fr/equipe/marion-delacroix",
            title: "Marion Delacroix - Cabinet Delacroix",
            description: "Associée du Cabinet Delacroix",
            provider: "searxng",
          },
        ];
      },
      async discover() {
        return [
          {
            url: "https://cabinet-delacroix.fr/equipe/marion-delacroix",
            title: "Marion Delacroix",
            depth: 1,
            path: "/equipe/marion-delacroix",
          },
        ];
      },
      async readPages() {
        return [
          {
            url: "https://cabinet-delacroix.fr/equipe/marion-delacroix",
            canonicalUrl: "https://cabinet-delacroix.fr/equipe/marion-delacroix",
            title: "Marion Delacroix",
            markdown: [
              "# Marion Delacroix",
              "Associée",
              "marion.delacroix@cabinet-delacroix.fr",
              "Mobile : +33 6 12 34 56 78",
            ].join("\n"),
            collectedAt,
            contentHash: "hash-1",
            metadata: {},
          },
        ];
      },
    };
    const result = await new CrawlerProspectEnricher(crawler).enrich({
      fullName: "Marion Delacroix",
      companyName: "Cabinet Delacroix",
      location: "Paris, France",
      linkedinUrl: "https://www.linkedin.com/in/marion-delacroix",
      channels: emptyProspectChannels(),
      correlationId: "prospect:run:candidate",
      requestKey: "prospect-enrichment:run:candidate",
    });

    expect(result.companyWebsite).toBe("https://cabinet-delacroix.fr");
    expect(result.companyDomain).toBe("cabinet-delacroix.fr");
    expect(result.channels.email).toMatchObject({
      value: "marion.delacroix@cabinet-delacroix.fr",
      status: "found",
      source: "public_web",
      evidenceUrl: "https://cabinet-delacroix.fr/equipe/marion-delacroix",
    });
    expect(result.channels.whatsapp).toMatchObject({
      value: "+33 6 12 34 56 78",
      normalizedValue: "+33612345678",
      status: "unverified",
      source: "public_web",
    });
    expect(result.evidence.map((item) => item.kind)).toEqual([
      "company_website",
      "email",
      "phone",
    ]);
  });

  test("does not attach a generic inbox or company switchboard to a person", () => {
    const evidence = extractNamedContactEvidence(
      [{
        url: "https://cabinet.example/contact",
        canonicalUrl: "https://cabinet.example/contact",
        title: "Contact",
        markdown: [
          "# Marion Delacroix",
          "Associée",
          "contact@cabinet.example",
          "Standard : 01 23 45 67 89",
        ].join("\n"),
        collectedAt,
        contentHash: "hash-2",
        metadata: {},
      }],
      "Marion Delacroix",
    );
    expect(evidence.emails).toEqual([]);
    expect(evidence.phones).toEqual([]);
  });

  test("rejects social networks and corporate directories as official websites", () => {
    expect(
      selectOfficialWebsite(
        [
          {
            url: "https://www.linkedin.com/company/cabinet-delacroix",
            title: "Cabinet Delacroix",
            description: "LinkedIn",
            provider: "searxng",
          },
          {
            url: "https://www.pappers.fr/entreprise/cabinet-delacroix-123",
            title: "Cabinet Delacroix",
            description: "Informations légales",
            provider: "searxng",
          },
          {
            url: "https://cabinet-delacroix.fr/notre-cabinet",
            title: "Cabinet Delacroix",
            description: "Notre cabinet",
            provider: "searxng",
          },
        ],
        "Cabinet Delacroix",
      ),
    ).toBe("https://cabinet-delacroix.fr");
  });
});
