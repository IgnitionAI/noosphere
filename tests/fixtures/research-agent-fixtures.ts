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

const v3Evidence = {
  evidenceId: "V3E01",
  url: "https://market.example.org/customer-operations",
  title: "Customer operations workflow study",
  excerpt: "Distributed operations teams repeatedly reconcile controlled documents.",
  context: "The study describes a recurring controlled-document reconciliation workflow.",
  sourceType: "public_web" as const,
  sourceRelation: "independent" as const,
  evidenceKind: "independent_research" as const,
  originFamily: "market.example.org/customer-operations",
  observedAt: "2026-08-02T10:00:00.000Z",
  contentHash: "3123456789abcdef0123456789abcdef",
};

const v3Claim = {
  claimId: "CL01",
  dimension: "problem_recurrence" as const,
  statement: "Distributed operations teams reconcile controlled documents every week.",
  status: "observed" as const,
  confidence: 0.82,
  evidence: [
    {
      evidenceId: "V3E01",
      relation: "supports" as const,
      directness: 3,
      specificity: 3,
      rationale: "The independent study describes the same workflow and actor.",
    },
  ],
};

const v3BuyingContext = {
  hypothesisId: "H01",
  users: ["Operations analysts"],
  sponsors: ["Operations director"],
  economicBuyers: ["Chief operating officer"],
  purchaseTriggers: ["New controlled-document programme"],
  objections: ["Existing internal workflow"],
  claims: [v3Claim],
  budget: { status: "unknown" as const, value: "" },
  salesCycle: { status: "unknown" as const, value: "" },
};

const v3Axis = {
  value: 3,
  confidence: 0.75,
  rationale: "Direct workflow evidence supports this dimension.",
  claimIds: ["CL01"],
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
    case "product_truth":
      return {
        productSummary: "A governed assistant for controlled operational documents.",
        facts: [
          {
            factId: "PF01",
            statement: "The product retrieves and cites controlled documents.",
            category: "capability",
            status: "available",
            authority: 4,
            evidenceIds: ["V3E01"],
          },
        ],
        unknowns: ["Current commercial adoption"],
        evidence: [v3Evidence],
      };
    case "problem_mapping":
      return {
        problems: [
          {
            problemId: "PR01",
            actor: "Operations analysts",
            workflow: "Reconcile controlled documents before operational decisions.",
            frequency: "Weekly",
            dataOrCorpus: ["Controlled procedures", "Operational records"],
            failureCostOrRisk: "Slow decisions and inconsistent execution.",
            currentAlternative: "Manual search and spreadsheet tracking.",
            constraints: ["Access control", "Traceable citations"],
            compatibleProductFactIds: ["PF01"],
            status: "inferred",
            confidence: 0.65,
          },
        ],
      };
    case "organization_discovery":
      return {
        hypotheses: [
          {
            hypothesisId: "H01",
            problemIds: ["PR01"],
            organizationType: "Distributed regulated operations teams",
            description: "Organizations coordinating controlled procedures across locations.",
            origin: "external_signal",
            discoveryRoute: "buyer_signal",
            assumptions: ["The workflow is frequent enough to justify a purchase."],
            validationQueries: ["distributed operations controlled documents workflow study"],
            falsificationQueries: ["distributed operations document workflow internal build"],
            evidenceIds: ["V3E01"],
          },
        ],
        routeCoverage: {
          adoption: true,
          statusQuo: true,
          buyerSignals: true,
          adjacent: true,
        },
        evidence: [v3Evidence],
      };
    case "market_investigation":
      return {
        investigations: [
          {
            hypothesisId: "H01",
            claims: [v3Claim],
            recurringWorkflows: ["Weekly controlled-document reconciliation"],
            currentAlternatives: ["Manual search", "Shared drives"],
            counterEvidence: ["Some organizations maintain internal search teams."],
            unknowns: ["Budget", "Sales cycle"],
          },
        ],
        notInvestigatedHypothesisIds: [],
        evidence: [v3Evidence],
      };
    case "buying_context":
      return { contexts: [v3BuyingContext] };
    case "sourcing_validation":
      return {
        tests: [
          {
            hypothesisId: "H01",
            status: "verified",
            accountQuery: {
              naceCodes: [],
              industries: ["Distributed operations"],
              companySizes: ["200-5000 employees"],
              geographies: ["France"],
              jobTitles: ["Operations director", "Knowledge manager"],
              triggerSignals: ["Controlled-document programme"],
              exclusions: ["Dedicated internal AI product team"],
              searchKeywords: ["controlled operations documents"],
            },
            accountsFound: 18,
            accountsSampled: 10,
            peopleFound: 16,
            providerCalls: 8,
            representativeAccounts: [
              {
                name: "Representative Operations Group",
                domain: "operations.example",
                geography: "France",
                matchedCriteria: ["Distributed operations", "Controlled documents"],
              },
            ],
            limitations: [],
          },
        ],
        readOnlyAttestation: true,
      };
    case "icp_composition":
      return {
        candidates: [
          {
            candidateId: "ICP01",
            hypothesisId: "H01",
            name: "Distributed operations teams with controlled-document workflows",
            state: "priority_for_test",
            origin: "external_signal",
            organizationType: "Distributed regulated operations teams",
            useCase: "Retrieve and reconcile controlled procedures with citations.",
            buyingContext: v3BuyingContext,
            prospecting: {
              naceCodes: [],
              industries: ["Distributed operations"],
              companySizes: ["200-5000 employees"],
              geographies: ["France"],
              jobTitles: ["Operations director", "Knowledge manager"],
              triggerSignals: ["Controlled-document programme"],
              exclusions: ["Dedicated internal AI product team"],
              searchKeywords: ["controlled operations documents"],
            },
            problems: ["Slow controlled-document reconciliation"],
            signals: ["New controlled-document programme"],
            exclusions: ["Dedicated internal AI product team"],
            unknowns: ["Budget", "Sales cycle"],
            sourcingStatus: "verified",
            attractiveness: v3Axis,
            executability: v3Axis,
            researchConfidence: v3Axis,
          },
        ],
      };
    case "adversarial_review":
      return {
        reviews: [
          {
            candidateId: "ICP01",
            decision: "keep",
            rationale: "No blocking contradiction was found.",
            blockingContradictions: [],
            evidenceIds: ["V3E01"],
          },
        ],
        coverage: { generated: 1, scanned: 1, investigated: 1, sourced: 1, skippedByBudget: 0 },
        unresolvedContradictions: [],
      };
    case "objective_ranking":
      return {
        objective: "qualified_conversations",
        status: "complete",
        summary: "One externally discovered and sourceable ICP is ready for a prospecting test.",
        missingStages: [],
        coverage: { generated: 1, scanned: 1, investigated: 1, sourced: 1, skippedByBudget: 0 },
        proposals: [
          {
            candidateId: "ICP01",
            rank: 1,
            name: "Distributed operations teams with controlled-document workflows",
            state: "priority_for_test",
            origin: "external_signal",
            confidence: 0.75,
            organizationType: "Distributed regulated operations teams",
            useCase: "Retrieve and reconcile controlled procedures with citations.",
            prospecting: {
              naceCodes: [],
              industries: ["Distributed operations"],
              companySizes: ["200-5000 employees"],
              geographies: ["France"],
              jobTitles: ["Operations director", "Knowledge manager"],
              triggerSignals: ["Controlled-document programme"],
              exclusions: ["Dedicated internal AI product team"],
              searchKeywords: ["controlled operations documents"],
            },
            buyingCommittee: ["Operations director", "Knowledge manager"],
            problems: ["Slow controlled-document reconciliation"],
            signals: ["New controlled-document programme"],
            exclusions: ["Dedicated internal AI product team"],
            unknowns: ["Budget", "Sales cycle"],
            sourcingStatus: "verified",
            attractiveness: v3Axis,
            executability: v3Axis,
            researchConfidence: v3Axis,
            evidenceIds: ["V3E01"],
          },
        ],
      };
  }
}
