import { describe, expect, test } from "bun:test";
import type { AgentStageInput } from "@outbound/contracts/product-research";
import { V3SourcingValidator } from "@outbound/infrastructure/ai/v3-sourcing-validator";
import type {
  ProspectSearchFilters,
  ProspectSource,
} from "@outbound/infrastructure/crm/unipile-prospect-source";

class FakeSource implements ProspectSource {
  readonly calls: ProspectSearchFilters[] = [];

  async searchPeople(filters: ProspectSearchFilters) {
    this.calls.push(filters);
    return [
      {
        fullName: "A. Operator",
        headline: "Operations Director",
        linkedinUrl: "https://linkedin.com/in/a-operator",
        location: "Paris, France",
        companyName: "Example Operations",
        providerData: {},
      },
    ];
  }
}

function input(): AgentStageInput {
  return {
    stage: "sourcing_validation",
    workspaceId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    researchStageRunId: crypto.randomUUID(),
    correlationId: "test",
    deadlineAt: null,
    workItemKey: "main",
    externalDlpTerms: [],
    brief: {
      productUrl: "https://product.example",
      productName: "Example",
      description: "",
      geography: "France",
      languages: ["fr"],
      salesMotion: "saas",
      knownCompetitors: [],
      internalDocumentIds: [],
      depth: "standard",
      audienceGoal: "end_customers",
      buyerConstraints: "",
      researchVersion: 3,
    },
    previousOutputs: {
      organization_discovery: {
        hypotheses: [{ hypothesisId: "H01", organizationType: "Distributed operators" }],
      },
      buying_context: {
        contexts: [{
          hypothesisId: "H01",
          users: ["Knowledge Manager"],
          sponsors: ["Operations Director"],
          economicBuyers: ["COO"],
          purchaseTriggers: ["New controlled-document programme"],
        }],
      },
    },
  };
}

describe("V3 sourcing validator", () => {
  test("uses Unipile read-only people search and reports observed discoverability", async () => {
    const source = new FakeSource();
    const output = await new V3SourcingValidator(source).validate(input());

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]).toMatchObject({ api: "classic", category: "people", limit: 10 });
    expect(output.readOnlyAttestation).toBe(true);
    expect(output.tests[0]).toMatchObject({
      hypothesisId: "H01",
      status: "verified",
      accountsFound: 1,
      peopleFound: 1,
      providerCalls: 1,
    });
  });

  test("keeps missing provider configuration separate from market attractiveness", async () => {
    const output = await new V3SourcingValidator(null).validate(input());
    expect(output.tests[0]).toMatchObject({
      status: "account_unavailable",
      accountsFound: 0,
      providerCalls: 0,
    });
  });

  test("bounds generated LinkedIn filters without invalidating the durable stage output", async () => {
    const source = new FakeSource();
    const longInput = input();
    longInput.previousOutputs.organization_discovery = {
      hypotheses: [{ hypothesisId: "H01", organizationType: `Enterprise ${"operations ".repeat(40)}` }],
    };
    longInput.previousOutputs.buying_context = {
      contexts: [{
        hypothesisId: "H01",
        users: [`Knowledge ${"manager ".repeat(50)}`],
        sponsors: [`Operations ${"director ".repeat(50)}`],
        economicBuyers: [`Chief ${"officer ".repeat(50)}`],
        purchaseTriggers: [`Transformation ${"programme ".repeat(120)}`],
      }],
    };

    const output = await new V3SourcingValidator(source).validate(longInput);

    expect(source.calls[0]?.keywords.length).toBeLessThanOrEqual(500);
    expect(output.tests[0]?.accountQuery.searchKeywords[0]?.length).toBeLessThanOrEqual(500);
    expect(output.tests[0]?.accountQuery.industries[0]?.length).toBeLessThanOrEqual(300);
    expect(output.tests[0]?.accountQuery.jobTitles.every((value) => value.length <= 300)).toBe(true);
    expect(output.tests[0]?.accountQuery.triggerSignals[0]?.length).toBeLessThanOrEqual(1_000);
  });
});
