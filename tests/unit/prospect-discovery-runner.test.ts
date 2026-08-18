import { describe, expect, test } from "bun:test";
import { searchLinkedinCampaignCandidates } from "@outbound/infrastructure/crm/prospect-discovery-runner";
import { AUTONOMOUS_SOURCING_VERSION } from "@outbound/application/campaigns/autonomous-prospecting";
import type {
  ProspectSearchFilters,
  ProspectSource,
} from "@outbound/infrastructure/crm/unipile-prospect-source";

describe("campaign LinkedIn discovery", () => {
  test("runs several small ICP-aligned searches and deduplicates their candidates", async () => {
    const calls: ProspectSearchFilters[] = [];
    const source: ProspectSource = {
      async searchPeople(filters) {
        calls.push(filters);
        return [{
          fullName: "Alice Martin",
          headline: "Direction juridique",
          linkedinUrl: "https://www.linkedin.com/in/alice-martin",
          location: "Paris, France",
          companyName: "Example",
          providerData: { providerId: "alice" },
        }];
      },
    };

    const candidates = await searchLinkedinCampaignCandidates(source, {
      channel: "linkedin",
      api: "classic",
      category: "people",
      keywords: 'site:linkedin.com/in ("Directeur juridique" OR DPO) France -ESN',
      limit: 50,
      exhaustive: true,
      enrichContacts: false,
      sourcingVersion: AUTONOMOUS_SOURCING_VERSION,
    }, {
      criteria: { industries: ["Direction juridique"], geographies: ["France"] },
      buyingCommittee: ["Directeur juridique", "DPO"],
    });

    expect(calls.map((call) => call.keywords)).toEqual([
      "Directeur juridique Direction juridique France",
      "DPO Direction juridique France",
    ]);
    expect(calls.every((call) => call.exhaustive === false && call.limit === 25)).toBe(true);
    expect(candidates).toHaveLength(1);
  });
});
