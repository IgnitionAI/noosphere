import { describe, expect, test } from "bun:test";
import { emptyProspectChannels } from "@outbound/domain/crm/prospect-channels";
import type { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";
import { CrawlerCompanyProspectSource } from "@outbound/infrastructure/crm/crawler-company-prospect-source";
import type { ProspectSource } from "@outbound/infrastructure/crm/unipile-prospect-source";

describe("CrawlerCompanyProspectSource", () => {
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
