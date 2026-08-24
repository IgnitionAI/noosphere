import { describe, expect, test } from "bun:test";
import { scoreProspect } from "@outbound/domain/campaigns/population-scoring";

const facts = {
  firstName: "Ada",
  lastName: "Lovelace",
  preferredChannel: "email",
  status: "active",
  source: "manual",
  identities: { email: ["ada@example.com"] },
  company: { sector: "legal", employeeCountMin: 100, location: "France" },
  employment: { title: "Partner" },
};

describe("campaign population scoring", () => {
  test("is deterministic and separates facts from missing data", () => {
    const criteria = [
      { id: "sector", dimension: "company.sector", operator: "equals", expectedValue: "legal", weight: 2, required: true, exclusion: false },
      { id: "location", dimension: "company.location", operator: "equals", expectedValue: "France", weight: 1, required: false, exclusion: false },
      { id: "title", dimension: "employment.level", operator: "equals", expectedValue: "partner", weight: 1, required: false, exclusion: false },
    ];
    const first = scoreProspect(criteria, facts);
    const second = scoreProspect(criteria, facts);
    expect(second).toEqual(first);
    expect(first.eligible).toBe(true);
    expect(first.explanation.facts).toHaveLength(2);
    expect(first.explanation.missing.map((item) => item.dimension)).toEqual(["employment.level"]);
  });

  test("an exclusion criterion wins over a high positive score", () => {
    const result = scoreProspect([
      { id: "positive", dimension: "company.sector", operator: "equals", expectedValue: "legal", weight: 10, required: true, exclusion: false },
      { id: "excluded", dimension: "company.employeeCountMin", operator: "gte", expectedValue: 50, weight: 0, required: false, exclusion: true },
    ], facts);
    expect(result.score).toBe(100);
    expect(result.eligible).toBe(false);
    expect(result.explanation.exclusions[0]?.reason).toBe("exclusion_criterion_matched");
  });
});
