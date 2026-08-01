import { describe, expect, test } from "bun:test";
import {
  auditIcpStructurally,
  finalizeIcpSynthesis,
  synthesizeIcpFromSegments,
  validateBuyerLandscape,
} from "@outbound/application/gtm/icp-prospectability-policy";

const brief = {
  productUrl: "https://product.example.com",
  productName: "Example",
  description: "",
  geography: "France",
  languages: ["fr"],
  salesMotion: "saas" as const,
  knownCompetitors: [],
  internalDocumentIds: [],
  depth: "deep" as const,
  audienceGoal: "end_customers" as const,
  buyerConstraints: "Exclude organizations that prefer to build internally.",
  researchVersion: 2 as const,
};

const prospecting = {
  naceCodes: ["M69.1"],
  industries: ["Legal services"],
  companySizes: ["10-100 employees"],
  geographies: ["France"],
  jobTitles: ["Managing Partner"],
  triggerSignals: ["Knowledge management hiring"],
  exclusions: ["Internal AI engineering team"],
  searchKeywords: ["cabinet avocat droit affaires"],
};

function proposal(input: {
  name: string;
  buyerType: "end_customer" | "channel_partner" | "internal_builder";
  score: number;
  marketEvidenceIds?: string[];
}) {
  return {
    name: input.name,
    buyerType: input.buyerType,
    rank: 99,
    confidence: 0.8,
    scorecard: {
      productFit: input.score,
      painIntensity: input.score,
      recurringNeed: input.score,
      budgetFit: input.score,
      urgency: input.score,
      reachability: input.score,
      buildAbility: input.buyerType === "end_customer" ? 20 : 90,
      willingnessToBuy: input.score,
      evidenceStrength: input.score,
      total: 0,
    },
    companyCriteria: { employees: "10-100" },
    prospecting,
    buyingCommittee: ["Managing Partner"],
    problems: ["Slow reuse of prior work"],
    signals: ["Knowledge management hiring"],
    exclusions: ["Internal AI team"],
    unknowns: ["Budget"],
    evidenceIds: ["P01", "M01", "M02"],
    marketEvidenceIds: input.marketEvidenceIds ?? ["M01", "M02"],
  };
}

function segment(name: string, confidence: number, willingnessToBuy: number) {
  return {
    name,
    buyerType: "end_customer" as const,
    description: `${name} reuse proprietary documents.`,
    industries: [name],
    recurringWorkflows: ["Search and synthesize proprietary documents"],
    problems: [
      {
        statement: "Manual document research is recurrent.",
        confidence,
        evidenceIds: ["M01", "M02"],
        hypothesis: false,
      },
    ],
    buyingSignals: [
      {
        statement: "The segment buys specialist document software.",
        confidence,
        evidenceIds: ["M01", "M02"],
        hypothesis: false,
      },
    ],
    buildVsBuy: {
      buildAbility: 25,
      willingnessToBuy,
      rationale: "The segment lacks a dedicated AI engineering team.",
      evidenceIds: ["M01", "M02"],
    },
    prospecting: {
      ...prospecting,
      industries: [name],
      jobTitles: ["Decision maker"],
      searchKeywords: [name],
    },
    marketEvidenceIds: ["M01", "M02"],
    confidence,
  };
}

const previousOutputs = {
  product_analysis: {
    evidence: [
      {
        evidenceId: "P01",
        url: "https://product.example.com/solutions",
        title: "Product positioning",
        excerpt: "Product capabilities",
        sourceType: "public_web",
        observedAt: "2026-08-01T10:00:00.000Z",
        contentHash: "0123456789abcdef0123456789abcdef",
      },
    ],
  },
  buyer_landscape_discovery: {
    evidence: [
      {
        evidenceId: "M01",
        url: "https://market.example.org/legal-workflows",
        title: "Legal workflows",
        excerpt: "Recurring research workflows",
        sourceType: "public_web",
        observedAt: "2026-08-01T10:00:00.000Z",
        contentHash: "1123456789abcdef0123456789abcdef",
      },
      {
        evidenceId: "M02",
        url: "https://competitor.example.com/customers/law-firms",
        title: "Law-firm customer stories",
        excerpt: "Law firms buy document assistants",
        sourceType: "public_web",
        observedAt: "2026-08-01T10:00:00.000Z",
        contentHash: "2123456789abcdef0123456789abcdef",
      },
    ],
  },
};

describe("ICP prospectability policy", () => {
  test("rejects a buyer landscape that treats product positioning as market proof", () => {
    const output = {
      ...previousOutputs.buyer_landscape_discovery,
      buyerSegments: [
        {
          name: "Small law firms",
          buyerType: "end_customer",
          description: "Firms reusing proprietary knowledge.",
          industries: ["Legal services"],
          useCases: ["Contract research"],
          recurringWorkflows: ["Reuse prior clauses"],
          corpusTypes: ["Contracts"],
          buyingCommittee: ["Managing Partner"],
          demandSignals: [
            {
              statement: "Research is recurring.",
              confidence: 0.8,
              evidenceIds: ["M01"],
              hypothesis: false,
            },
          ],
          buildVsBuy: {
            buildAbility: 20,
            willingnessToBuy: 85,
            rationale: "No internal AI team.",
            evidenceIds: ["M01", "M02"],
          },
          prospecting,
          confidence: 0.8,
          marketEvidenceIds: ["P01", "M01"],
          productFitEvidenceIds: ["P01"],
        },
      ],
      marketUnknowns: [],
    };
    expect(() =>
      validateBuyerLandscape({ brief, previousOutputs, output }),
    ).toThrow("OWN_PRODUCT_SOURCE_AS_MARKET_EVIDENCE");
  });

  test("keeps only the requested audience, computes scores and ranks the strongest buyer first", () => {
    const result = finalizeIcpSynthesis({
      brief,
      previousOutputs,
      output: {
        proposals: [
          proposal({ name: "Systems integrators", buyerType: "channel_partner", score: 95 }),
          proposal({ name: "Small law firms", buyerType: "end_customer", score: 82 }),
          proposal({ name: "Compliance teams", buyerType: "end_customer", score: 68 }),
        ],
      },
    });

    expect(result.proposals.map((item) => item.name)).toEqual([
      "Small law firms",
      "Compliance teams",
    ]);
    expect(result.proposals.map((item) => item.rank)).toEqual([1, 2]);
    expect(result.proposals[0]!.scorecard.total).toBeGreaterThan(
      result.proposals[1]!.scorecard.total,
    );
  });

  test("rejects the product landing page as market-demand evidence", () => {
    expect(() =>
      finalizeIcpSynthesis({
        brief,
        previousOutputs,
        output: {
          proposals: [
            proposal({
              name: "Small law firms",
              buyerType: "end_customer",
              score: 82,
              marketEvidenceIds: ["P01", "M01"],
            }),
          ],
        },
      }),
    ).toThrow("OWN_PRODUCT_SOURCE_AS_MARKET_EVIDENCE");
  });

  test("fails closed when the model returns no proposal for the requested audience", () => {
    expect(() =>
      finalizeIcpSynthesis({
        brief,
        previousOutputs,
        output: {
          proposals: [
            proposal({ name: "Systems integrators", buyerType: "channel_partner", score: 95 }),
          ],
        },
      }),
    ).toThrow("ICP_AUDIENCE_MISMATCH");
  });

  test("builds a diverse five-ICP portfolio from evidenced segments without a model", () => {
    const result = synthesizeIcpFromSegments({
      brief: { ...brief, description: "Assistant for legal and compliance documents" },
      previousOutputs: {
        ...previousOutputs,
        segment_synthesis: {
          segments: [
            segment("Pharmaceutical companies", 0.95, 90),
            segment("Banking institutions", 0.92, 88),
            {
              ...segment("Mid-size law firms", 0.84, 85),
              marketEvidenceIds: ["P01", "M01", "M02"],
            },
            segment("Corporate in-house legal departments", 0.82, 78),
            segment("Management consulting firms", 0.72, 74),
            segment("SME compliance teams", 0.68, 72),
          ],
        },
      },
    });

    expect(result.proposals).toHaveLength(5);
    const names = result.proposals.map((item) => item.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Mid-size law firms",
        "Corporate in-house legal departments",
        "Management consulting firms",
        "SME compliance teams",
      ]),
    );
    expect(result.proposals.every((item) => item.buyerType === "end_customer")).toBe(true);
    expect(result.proposals.every((item) => item.scorecard.total > 0)).toBe(true);
    expect(
      result.proposals.find((item) => item.name === "Mid-size law firms")?.marketEvidenceIds,
    ).toEqual(["M01", "M02"]);
  });

  test("marks a quota fallback audit as requiring human semantic review", () => {
    const synthesis = finalizeIcpSynthesis({
      brief,
      previousOutputs,
      output: {
        proposals: [proposal({ name: "Small law firms", buyerType: "end_customer", score: 82 })],
      },
    });

    const audit = auditIcpStructurally({
      previousOutputs: { ...previousOutputs, icp_synthesis: synthesis },
    });

    expect(audit.commercialReadiness.decision).toBe("needs_more_research");
    expect(audit.commercialReadiness.blockedProposalRanks).toEqual([1]);
    expect(audit.reviewedFindings[0]).toMatchObject({
      findingPath: "proposals.0",
      decision: "hypothesis",
    });
  });
});
