import type { AgentStageOutput } from "@outbound/contracts/product-research";
import type { ResearchStage } from "@outbound/domain/gtm/product-research";

const evidence = {
  evidenceId: "S01",
  url: "https://example.com/product",
  title: "Official product page",
  excerpt: "The product helps organizations govern operational AI usage.",
  sourceType: "public_web" as const,
  observedAt: "2026-07-24T10:00:00.000Z",
  contentHash: "0123456789abcdef0123456789abcdef",
};

const claim = {
  statement: "Organizations need a structured AI governance workflow.",
  confidence: 0.8,
  evidenceIds: ["S01"],
  hypothesis: false,
};

export function validOutputFor(stage: ResearchStage): AgentStageOutput {
  switch (stage) {
    case "product_analysis":
      return {
        productSummary: "An operational AI governance product.",
        valuePropositions: [claim],
        targetHints: ["Mid-market organizations using generative AI"],
        unknowns: ["Validated budget"],
        evidence: [evidence],
      };
    case "competitor_discovery":
      return {
        candidates: [
          {
            name: "Example Governance",
            url: "https://example.com",
            relation: "direct",
            rationale: "Targets the same operational governance workflow.",
            confidence: 0.75,
            evidenceIds: ["S01"],
          },
        ],
        evidence: [evidence],
      };
    case "competitor_analysis":
      return {
        competitors: [
          {
            name: "Example Governance",
            positioning: "Enterprise AI governance platform.",
            apparentSegments: ["Enterprise"],
            strengths: ["Broad controls"],
            gaps: [claim],
            evidenceIds: ["S01"],
          },
        ],
      };
    case "segment_synthesis":
      return {
        segments: [
          {
            name: "AI-active mid-market",
            description: "Organizations with active AI use and fragmented governance.",
            problems: [claim],
            buyingSignals: [claim],
            confidence: 0.78,
          },
        ],
      };
    case "icp_synthesis":
      return {
        proposals: [
          {
            name: "AI-active mid-market",
            rank: 1,
            confidence: 0.78,
            companyCriteria: { employeeCount: { min: 50, max: 2_000 } },
            buyingCommittee: ["CTO", "Head of AI", "DPO"],
            problems: ["Fragmented AI governance"],
            signals: ["Internal AI assistant launch"],
            exclusions: ["No active AI use"],
            unknowns: ["Available budget"],
            evidenceIds: ["S01"],
          },
        ],
      };
    case "evidence_review":
      return {
        reviewedFindings: [
          {
            findingPath: "proposals.0",
            decision: "accepted",
            rationale: "The claim is supported by the cited source.",
            replacement: null,
            evidenceIds: ["S01"],
          },
        ],
        unresolvedContradictions: [],
        executiveSummary: "The primary ICP is an AI-active mid-market organization.",
      };
  }
}
