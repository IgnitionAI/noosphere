import { describe, expect, test } from "bun:test";
import {
  icpCompositionOutputSchema,
  objectiveRankingOutputSchema,
  parseAgentOutput,
  productResearchBriefSchema,
  v3ClaimSchema,
} from "@outbound/contracts/product-research";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

describe("research agent contracts", () => {
  test("new briefs default to end-customer discovery", () => {
    const parsed = productResearchBriefSchema.parse({
      productUrl: "https://example.com",
      productName: "Example",
      description: "",
      geography: "France",
      languages: ["fr"],
      salesMotion: "saas",
      knownCompetitors: [],
      internalDocumentIds: [],
      depth: "standard",
    });
    expect(parsed).toMatchObject({
      audienceGoal: "end_customers",
      buyerConstraints: "",
      researchVersion: 3,
    });
  });

  test("accepts a prospectable buyer-landscape output", () => {
    expect(() =>
      parseAgentOutput("buyer_landscape_discovery" as never, {
        buyerSegments: [
          {
            name: "Distributed service operators",
            buyerType: "end_customer",
            description: "Operators reusing controlled operational knowledge.",
            industries: ["Distributed services"],
            useCases: ["Procedure research"],
            recurringWorkflows: ["Search procedures and incident records"],
            corpusTypes: ["Procedures", "Incident records"],
            buyingCommittee: ["Operations director", "Knowledge manager"],
            demandSignals: [
              {
                statement: "The workflow is repeated across matters.",
                confidence: 0.8,
                evidenceIds: ["M01"],
                hypothesis: false,
              },
            ],
            buildVsBuy: {
              buildAbility: 20,
              willingnessToBuy: 85,
              rationale: "No internal AI team and valuable proprietary corpus.",
              evidenceIds: ["M01", "M02"],
            },
            prospecting: {
              naceCodes: [],
              industries: ["Distributed services"],
              companySizes: ["200-5000 employees"],
              geographies: ["France"],
              jobTitles: ["Operations Director", "Knowledge Manager"],
              triggerSignals: ["Knowledge-management hiring"],
              exclusions: ["Internal AI engineering team"],
              searchKeywords: ["distributed operations knowledge management"],
            },
            confidence: 0.82,
            marketEvidenceIds: ["M01", "M02"],
            productFitEvidenceIds: ["P01"],
          },
        ],
        marketUnknowns: ["Validated budget"],
        evidence: [],
      }),
    ).not.toThrow();
  });

  test("accepts a sourced output for every agent stage", () => {
    for (const stage of [
      "product_analysis",
      "competitor_discovery",
      "competitor_analysis",
      "segment_synthesis",
      "icp_synthesis",
      "evidence_review",
    ] as const) {
      expect(parseAgentOutput(stage, validOutputFor(stage))).toBeDefined();
    }
  });

  test("accepts every V3 stage output, including a zero-proposal report", () => {
    for (const stage of [
      "product_truth",
      "problem_mapping",
      "organization_discovery",
      "market_investigation",
      "buying_context",
      "sourcing_validation",
      "icp_composition",
      "adversarial_review",
      "objective_ranking",
    ] as const) {
      expect(parseAgentOutput(stage, validOutputFor(stage))).toBeDefined();
    }
    expect(
      objectiveRankingOutputSchema.parse({
        ...validOutputFor("objective_ranking"),
        proposals: [],
        coverage: { generated: 0, scanned: 0, investigated: 0, sourced: 0, skippedByBudget: 0 },
      }).proposals,
    ).toEqual([]);
  });

  test("does not promote an unsourceable candidate", () => {
    const output = structuredClone(validOutputFor("icp_composition")) as Record<string, any>;
    output.candidates[0].sourcingStatus = "provider_limited";
    expect(() => icpCompositionOutputSchema.parse(output)).toThrow(
      "requires verified sourcing",
    );
  });

  test("does not label weak indirect evidence as observed", () => {
    const claim = {
      claimId: "C01",
      dimension: "urgency",
      statement: "Purchase is urgent.",
      status: "observed",
      confidence: 0.9,
      evidence: [{
        evidenceId: "E01",
        relation: "supports",
        directness: 1,
        specificity: 1,
        rationale: "A generic industry page mentions transformation.",
      }],
    };
    expect(() => v3ClaimSchema.parse(claim)).toThrow("direct, specific");
  });

  test("requires partial reports to state the missing work", () => {
    expect(() => objectiveRankingOutputSchema.parse({
      ...validOutputFor("objective_ranking"),
      status: "partial",
      missingStages: [],
    })).toThrow("must explain its missing work");
  });

  test("normalizes an omitted audit replacement to null", () => {
    const output = validOutputFor("evidence_review") as {
      reviewedFindings: Array<Record<string, unknown>>;
    };
    delete output.reviewedFindings[0]!.replacement;

    const parsed = parseAgentOutput("evidence_review", output) as {
      reviewedFindings: Array<{ replacement: string | null }>;
    };

    expect(parsed.reviewedFindings[0]?.replacement).toBeNull();
  });

  test("rejects an unsupported product claim without an explicit evidence decision", () => {
    const output = validOutputFor("product_analysis") as Record<string, unknown>;
    output.valuePropositions = [
      {
        statement: "Unsupported market claim",
        confidence: 0.9,
        evidenceIds: [],
        hypothesis: false,
      },
    ];
    expect(() => parseAgentOutput("product_analysis", output)).toThrow();
  });
});
