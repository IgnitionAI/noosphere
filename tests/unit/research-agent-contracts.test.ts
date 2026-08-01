import { describe, expect, test } from "bun:test";
import {
  parseAgentOutput,
  productResearchBriefSchema,
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
      researchVersion: 2,
    });
  });

  test("accepts a prospectable buyer-landscape output", () => {
    expect(() =>
      parseAgentOutput("buyer_landscape_discovery" as never, {
        buyerSegments: [
          {
            name: "Independent law firms",
            buyerType: "end_customer",
            description: "Firms reusing confidential legal knowledge.",
            industries: ["Legal services"],
            useCases: ["Contract research"],
            recurringWorkflows: ["Search prior opinions and clauses"],
            corpusTypes: ["Opinions", "Contracts"],
            buyingCommittee: ["Managing partner", "Knowledge manager"],
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
              naceCodes: ["M69.1"],
              industries: ["Legal services"],
              companySizes: ["10-100 employees"],
              geographies: ["France"],
              jobTitles: ["Managing Partner", "Knowledge Manager"],
              triggerSignals: ["Knowledge-management hiring"],
              exclusions: ["Internal AI engineering team"],
              searchKeywords: ["cabinet avocat droit des affaires"],
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
