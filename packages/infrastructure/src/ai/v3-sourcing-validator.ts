import {
  sourcingValidationOutputSchema,
  type AgentStageInput,
  type SourcingValidationOutput,
} from "@outbound/contracts/product-research";
import {
  ProviderUnavailableError,
  type ProspectSource,
} from "@outbound/infrastructure/crm/unipile-prospect-source";

export class V3SourcingValidator {
  constructor(private readonly source: ProspectSource | null) {}

  async validate(input: AgentStageInput): Promise<SourcingValidationOutput> {
    const hypotheses = arrayAt(input.previousOutputs.organization_discovery, "hypotheses")
      .slice(0, 3);
    const contexts = arrayAt(input.previousOutputs.buying_context, "contexts");
    const tests: SourcingValidationOutput["tests"] = [];

    for (const hypothesis of hypotheses) {
      const hypothesisId = text(hypothesis.hypothesisId);
      if (!hypothesisId) continue;
      const organizationType = text(hypothesis.organizationType);
      const context = contexts.find((candidate) => text(candidate.hypothesisId) === hypothesisId);
      const jobTitles = unique([
        ...strings(context?.economicBuyers),
        ...strings(context?.sponsors),
        ...strings(context?.users),
      ]).slice(0, 8);
      const keywords = unique([organizationType, ...jobTitles.slice(0, 3)]).join(" ").trim();
      const accountQuery = {
        naceCodes: [],
        industries: organizationType ? [organizationType] : [],
        companySizes: [],
        geographies: [input.brief.geography],
        jobTitles,
        triggerSignals: strings(context?.purchaseTriggers).slice(0, 10),
        exclusions: [],
        searchKeywords: keywords ? [keywords] : [],
      };

      if (!keywords || jobTitles.length === 0) {
        tests.push({
          hypothesisId,
          status: "query_invalid",
          accountQuery,
          accountsFound: 0,
          accountsSampled: 0,
          peopleFound: 0,
          providerCalls: 0,
          representativeAccounts: [],
          limitations: ["Organization type and at least one buying role are required."],
        });
        continue;
      }
      if (!this.source) {
        tests.push({
          hypothesisId,
          status: "account_unavailable",
          accountQuery,
          accountsFound: 0,
          accountsSampled: 0,
          peopleFound: 0,
          providerCalls: 0,
          representativeAccounts: [],
          limitations: ["No read-only LinkedIn sourcing account is configured on the worker."],
        });
        continue;
      }

      try {
        const people = await this.source.searchPeople({
          api: "classic",
          category: "people",
          keywords,
          limit: 10,
        });
        const accounts = unique(
          people.map((person) => person.companyName).filter((value): value is string => Boolean(value)),
        );
        tests.push({
          hypothesisId,
          status:
            people.length === 0
              ? "no_matches"
              : accounts.length === 0
                ? "insufficient_coverage"
                : "verified",
          accountQuery,
          accountsFound: accounts.length,
          accountsSampled: Math.min(accounts.length, 10),
          peopleFound: people.length,
          providerCalls: 1,
          representativeAccounts: accounts.slice(0, 10).map((name) => {
            const person = people.find((candidate) => candidate.companyName === name);
            return {
              name,
              domain: null,
              geography: person?.location ?? null,
              matchedCriteria: unique([
                organizationType,
                ...(person?.headline ? [person.headline] : []),
              ]),
            };
          }),
          limitations:
            accounts.length > 0
              ? ["LinkedIn people search validates discoverability, not market demand or budget."]
              : ["People results did not expose enough company names to validate account sourcing."],
        });
      } catch (error) {
        const accountUnavailable =
          error instanceof ProviderUnavailableError &&
          error.message.includes("No healthy LinkedIn account");
        tests.push({
          hypothesisId,
          status: accountUnavailable ? "account_unavailable" : "provider_limited",
          accountQuery,
          accountsFound: 0,
          accountsSampled: 0,
          peopleFound: 0,
          providerCalls: 1,
          representativeAccounts: [],
          limitations: [
            error instanceof Error ? error.message : "The sourcing provider was unavailable.",
          ],
        });
      }
    }

    return sourcingValidationOutputSchema.parse({ tests, readOnlyAttestation: true });
  }
}

function arrayAt(value: unknown, key: string): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || !(key in value)) return [];
  const list = (value as Record<string, unknown>)[key];
  return Array.isArray(list)
    ? list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
