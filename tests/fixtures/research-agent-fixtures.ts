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

const marketEvidence = [
  {
    evidenceId: "M01",
    url: "https://market.example.org/workflows",
    title: "Recurring market workflows",
    excerpt: "Knowledge-intensive firms repeatedly search proprietary documents.",
    sourceType: "public_web" as const,
    observedAt: "2026-07-24T10:00:00.000Z",
    contentHash: "1123456789abcdef0123456789abcdef",
  },
  {
    evidenceId: "M02",
    url: "https://competitor.example.org/customers",
    title: "Customer cases",
    excerpt: "Specialist firms buy governed document assistants.",
    sourceType: "public_web" as const,
    observedAt: "2026-07-24T10:00:00.000Z",
    contentHash: "2123456789abcdef0123456789abcdef",
  },
];

const claim = {
  statement: "Organizations need a structured AI governance workflow.",
  confidence: 0.8,
  evidenceIds: ["S01"],
  hypothesis: false,
};

const marketClaim = {
  statement: "Specialist firms repeatedly search proprietary documents.",
  confidence: 0.8,
  evidenceIds: ["M01", "M02"],
  hypothesis: false,
};

const prospecting = {
  naceCodes: ["M69.1"],
  industries: ["Legal services"],
  companySizes: ["10-100 employees"],
  geographies: ["France"],
  jobTitles: ["Managing Partner", "Knowledge Manager"],
  triggerSignals: ["Knowledge-management hiring"],
  exclusions: ["Internal AI engineering team"],
  searchKeywords: ["specialist firm proprietary knowledge"],
};

const buildVsBuy = {
  buildAbility: 20,
  willingnessToBuy: 85,
  rationale: "The segment owns valuable knowledge but has no internal AI team.",
  evidenceIds: ["M01", "M02"],
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
    case "buyer_landscape_discovery":
      return {
        buyerSegments: [
          {
            name: "Knowledge-intensive specialist firms",
            buyerType: "end_customer",
            description: "Firms reusing confidential proprietary knowledge.",
            industries: ["Legal services"],
            useCases: ["Research prior opinions and clauses"],
            recurringWorkflows: ["Search and synthesize prior work"],
            corpusTypes: ["Opinions", "Contracts"],
            buyingCommittee: ["Managing Partner", "Knowledge Manager"],
            demandSignals: [marketClaim],
            buildVsBuy,
            prospecting,
            confidence: 0.82,
            marketEvidenceIds: ["M01", "M02"],
            productFitEvidenceIds: ["S01"],
          },
        ],
        marketUnknowns: ["Validated budget"],
        evidence: marketEvidence,
      };
    case "segment_synthesis":
      return {
        segments: [
          {
            name: "AI-active mid-market",
            buyerType: "end_customer",
            description: "Organizations with active AI use and fragmented governance.",
            industries: ["Legal services"],
            recurringWorkflows: ["Search and synthesize prior work"],
            problems: [marketClaim],
            buyingSignals: [marketClaim],
            buildVsBuy,
            prospecting,
            marketEvidenceIds: ["M01", "M02"],
            confidence: 0.78,
          },
        ],
      };
    case "icp_synthesis":
      return {
        proposals: [
          {
            name: "AI-active mid-market",
            buyerType: "end_customer",
            rank: 1,
            confidence: 0.78,
            scorecard: {
              productFit: 85,
              painIntensity: 80,
              recurringNeed: 85,
              budgetFit: 65,
              urgency: 70,
              reachability: 80,
              buildAbility: 20,
              willingnessToBuy: 85,
              evidenceStrength: 75,
              total: 0,
            },
            companyCriteria: { employeeCount: { min: 50, max: 2_000 } },
            prospecting,
            buyingCommittee: ["CTO", "Head of AI", "DPO"],
            problems: ["Fragmented AI governance"],
            signals: ["Internal AI assistant launch"],
            exclusions: ["No active AI use"],
            unknowns: ["Available budget"],
            evidenceIds: ["S01", "M01", "M02"],
            marketEvidenceIds: ["M01", "M02"],
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
        commercialReadiness: {
          decision: "ready",
          rationale: "The ICP has external market evidence and searchable criteria.",
          blockedProposalRanks: [],
          missingEvidence: [],
        },
        executiveSummary: "The primary ICP is an AI-active mid-market organization.",
      };
  }
}
