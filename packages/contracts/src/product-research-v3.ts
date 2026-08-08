import { z } from "zod";

export const v3ClaimStatusSchema = z.enum([
  "observed",
  "inferred",
  "unknown",
  "contradicted",
]);

export const v3HypothesisOriginSchema = z.enum([
  "user_content_hint",
  "external_signal",
  "adjacent_transfer",
]);

export const v3CandidateStateSchema = z.enum([
  "priority_for_test",
  "adjacent_experiment",
  "insufficient",
  "not_investigated",
]);

export const v3SourcingStatusSchema = z.enum([
  "verified",
  "query_invalid",
  "provider_limited",
  "insufficient_coverage",
  "no_matches",
  "account_unavailable",
  "budget_exhausted",
]);

export const v3EvidenceSourceSchema = z.object({
  evidenceId: z.string().min(1).max(100),
  url: z.string().url().nullable(),
  title: z.string().min(1).max(500),
  excerpt: z.string().min(1).max(5_000),
  context: z.string().min(1).max(10_000),
  sourceType: z.enum(["public_web", "internal_document"]),
  sourceRelation: z.enum([
    "product",
    "competitor",
    "buyer",
    "independent",
    "internal",
  ]),
  evidenceKind: z.enum([
    "product_claim",
    "competitor_positioning",
    "named_customer_adoption",
    "buyer_signal",
    "independent_research",
    "regulatory_context",
    "other",
  ]),
  originFamily: z.string().min(1).max(500),
  observedAt: z.string().datetime(),
  contentHash: z.string().min(16).max(128),
});

export const v3EvidenceLinkSchema = z.object({
  evidenceId: z.string().min(1).max(100),
  relation: z.enum(["supports", "contradicts", "context_only"]),
  directness: z.number().int().min(0).max(4),
  specificity: z.number().int().min(0).max(4),
  rationale: z.string().min(1).max(1_500),
});

export const v3ClaimSchema = z.object({
  claimId: z.string().min(1).max(100),
  dimension: z.enum([
    "product_fit",
    "problem_recurrence",
    "problem_impact",
    "urgency",
    "acquisition_behavior",
    "build_propensity",
    "buyer_access",
    "competitive_pressure",
    "budget",
    "sales_cycle",
  ]),
  statement: z.string().min(1).max(5_000),
  status: v3ClaimStatusSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(v3EvidenceLinkSchema).max(30),
}).superRefine((claim, context) => {
  if (
    claim.status === "observed" &&
    !claim.evidence.some(
      (link) =>
        link.relation === "supports" && link.directness >= 3 && link.specificity >= 2,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "An observed claim requires direct, specific supporting evidence",
      path: ["evidence"],
    });
  }
  if (claim.status === "unknown" && claim.confidence > 0.25) {
    context.addIssue({
      code: "custom",
      message: "An unknown claim cannot have confidence above 0.25",
      path: ["confidence"],
    });
  }
});

const prospectingPlanSchema = z.object({
  naceCodes: z.array(z.string().min(1).max(30)).max(30),
  industries: z.array(z.string().min(1).max(300)).max(30),
  companySizes: z.array(z.string().min(1).max(200)).max(20),
  geographies: z.array(z.string().min(1).max(200)).max(20),
  jobTitles: z.array(z.string().min(1).max(300)).max(30),
  triggerSignals: z.array(z.string().min(1).max(1_000)).max(30),
  exclusions: z.array(z.string().min(1).max(1_000)).max(30),
  searchKeywords: z.array(z.string().min(1).max(500)).max(30),
});

export const productTruthOutputSchema = z.object({
  productSummary: z.string().min(1).max(10_000),
  facts: z.array(z.object({
    factId: z.string().min(1).max(100),
    statement: z.string().min(1).max(5_000),
    category: z.enum(["capability", "constraint", "workflow", "positioning", "unknown"]),
    status: z.enum(["available", "planned", "claimed", "unknown", "contradicted"]),
    authority: z.number().int().min(0).max(4),
    evidenceIds: z.array(z.string().min(1).max(100)).max(30),
  })).max(30),
  unknowns: z.array(z.string().min(1).max(1_000)).max(20),
  evidence: z.array(v3EvidenceSourceSchema).max(300),
});

export const problemMappingOutputSchema = z.object({
  problems: z.array(z.object({
    problemId: z.string().min(1).max(100),
    actor: z.string().min(1).max(500),
    workflow: z.string().min(1).max(2_000),
    frequency: z.string().min(1).max(1_000),
    dataOrCorpus: z.array(z.string().min(1).max(500)).max(30),
    failureCostOrRisk: z.string().min(1).max(2_000),
    currentAlternative: z.string().min(1).max(2_000),
    constraints: z.array(z.string().min(1).max(1_000)).max(30),
    compatibleProductFactIds: z.array(z.string().min(1).max(100)).min(1).max(30),
    status: v3ClaimStatusSchema,
    confidence: z.number().min(0).max(1),
  })).min(1).max(20),
});

export const organizationDiscoveryOutputSchema = z.object({
  hypotheses: z.array(z.object({
    hypothesisId: z.string().min(1).max(100),
    problemIds: z.array(z.string().min(1).max(100)).min(1).max(20),
    organizationType: z.string().min(1).max(500),
    description: z.string().min(1).max(3_000),
    origin: v3HypothesisOriginSchema,
    discoveryRoute: z.enum(["adoption", "status_quo", "buyer_signal", "adjacent"]),
    assumptions: z.array(z.string().min(1).max(1_000)).max(20),
    validationQueries: z.array(z.string().min(3).max(500)).min(1).max(10),
    falsificationQueries: z.array(z.string().min(3).max(500)).min(1).max(10),
    evidenceIds: z.array(z.string().min(1).max(100)).max(30),
  })).max(8),
  routeCoverage: z.object({
    adoption: z.boolean(),
    statusQuo: z.boolean(),
    buyerSignals: z.boolean(),
    adjacent: z.boolean(),
  }),
  evidence: z.array(v3EvidenceSourceSchema).max(500),
});

export const marketInvestigationOutputSchema = z.object({
  investigations: z.array(z.object({
    hypothesisId: z.string().min(1).max(100),
    claims: z.array(v3ClaimSchema).max(50),
    recurringWorkflows: z.array(z.string().min(1).max(1_000)).max(30),
    currentAlternatives: z.array(z.string().min(1).max(1_000)).max(30),
    counterEvidence: z.array(z.string().min(1).max(2_000)).max(30),
    unknowns: z.array(z.string().min(1).max(1_000)).max(30),
  })).max(4),
  notInvestigatedHypothesisIds: z.array(z.string().min(1).max(100)).max(8),
  evidence: z.array(v3EvidenceSourceSchema).max(500),
});

const buyingContextSchema = z.object({
  hypothesisId: z.string().min(1).max(100),
  users: z.array(z.string().min(1).max(500)).max(20),
  sponsors: z.array(z.string().min(1).max(500)).max(20),
  economicBuyers: z.array(z.string().min(1).max(500)).max(20),
  purchaseTriggers: z.array(z.string().min(1).max(1_000)).max(30),
  objections: z.array(z.string().min(1).max(1_000)).max(30),
  claims: z.array(v3ClaimSchema).max(30),
  budget: z.object({ status: v3ClaimStatusSchema, value: z.string().max(500) }),
  salesCycle: z.object({ status: v3ClaimStatusSchema, value: z.string().max(500) }),
}).superRefine((buyingContext, context) => {
  for (const dimension of ["budget", "sales_cycle"] as const) {
    const field = dimension === "budget" ? buyingContext.budget : buyingContext.salesCycle;
    if (field.status !== "observed") continue;
    const observedClaim = buyingContext.claims.some(
      (claim) => claim.dimension === dimension && claim.status === "observed",
    );
    if (!observedClaim) {
      context.addIssue({
        code: "custom",
        message: `${dimension} cannot be observed without a direct observed claim`,
        path: [dimension === "budget" ? "budget" : "salesCycle"],
      });
    }
  }
});

export const buyingContextOutputSchema = z.object({
  contexts: z.array(buyingContextSchema).max(4),
});

export const sourcingValidationOutputSchema = z.object({
  tests: z.array(z.object({
    hypothesisId: z.string().min(1).max(100),
    status: v3SourcingStatusSchema,
    accountQuery: prospectingPlanSchema,
    accountsFound: z.number().int().nonnegative(),
    accountsSampled: z.number().int().nonnegative().max(10),
    peopleFound: z.number().int().nonnegative(),
    providerCalls: z.number().int().nonnegative().max(12),
    representativeAccounts: z.array(z.object({
      name: z.string().min(1).max(500),
      domain: z.string().max(300).nullable(),
      geography: z.string().max(300).nullable(),
      matchedCriteria: z.array(z.string().min(1).max(500)).max(20),
    })).max(10),
    limitations: z.array(z.string().min(1).max(1_000)).max(20),
  })).max(3),
  readOnlyAttestation: z.literal(true),
});

const axisSchema = z.object({
  value: z.number().min(0).max(4),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(2_000),
  claimIds: z.array(z.string().min(1).max(100)).max(30),
});

export const icpCompositionOutputSchema = z.object({
  candidates: z.array(z.object({
    candidateId: z.string().min(1).max(100),
    hypothesisId: z.string().min(1).max(100),
    name: z.string().min(1).max(500),
    state: v3CandidateStateSchema,
    origin: v3HypothesisOriginSchema,
    organizationType: z.string().min(1).max(500),
    useCase: z.string().min(1).max(2_000),
    buyingContext: buyingContextSchema,
    prospecting: prospectingPlanSchema,
    problems: z.array(z.string().min(1).max(2_000)).max(30),
    signals: z.array(z.string().min(1).max(2_000)).max(30),
    exclusions: z.array(z.string().min(1).max(2_000)).max(30),
    unknowns: z.array(z.string().min(1).max(2_000)).max(30),
    sourcingStatus: v3SourcingStatusSchema.nullable(),
    attractiveness: axisSchema,
    executability: axisSchema,
    researchConfidence: axisSchema,
  })).max(5),
}).superRefine((output, context) => {
  for (const [index, candidate] of output.candidates.entries()) {
    if (
      candidate.state === "priority_for_test" &&
      candidate.sourcingStatus !== "verified"
    ) {
      context.addIssue({
        code: "custom",
        message: "A priority_for_test candidate requires verified sourcing",
        path: ["candidates", index, "sourcingStatus"],
      });
    }
  }
});

export const adversarialReviewOutputSchema = z.object({
  reviews: z.array(z.object({
    candidateId: z.string().min(1).max(100),
    decision: z.enum(["keep", "downgrade", "reject"]),
    rationale: z.string().min(1).max(3_000),
    blockingContradictions: z.array(z.string().min(1).max(2_000)).max(20),
    evidenceIds: z.array(z.string().min(1).max(100)).max(30),
  })).max(5),
  coverage: z.object({
    generated: z.number().int().nonnegative(),
    scanned: z.number().int().nonnegative(),
    investigated: z.number().int().nonnegative(),
    sourced: z.number().int().nonnegative(),
    skippedByBudget: z.number().int().nonnegative(),
  }),
  unresolvedContradictions: z.array(z.string().min(1).max(2_000)).max(50),
});

export const objectiveRankingOutputSchema = z.object({
  objective: z.enum(["qualified_conversations", "fast_revenue", "strategic_market"]),
  status: z.enum(["complete", "partial"]),
  summary: z.string().min(1).max(15_000),
  missingStages: z.array(z.string().min(1).max(100)).max(20),
  coverage: adversarialReviewOutputSchema.shape.coverage,
  proposals: z.array(z.object({
    candidateId: z.string().min(1).max(100),
    rank: z.number().int().positive().max(5),
    name: z.string().min(1).max(500),
    state: v3CandidateStateSchema,
    origin: v3HypothesisOriginSchema,
    confidence: z.number().min(0).max(1),
    organizationType: z.string().min(1).max(500),
    useCase: z.string().min(1).max(2_000),
    prospecting: prospectingPlanSchema,
    buyingCommittee: z.array(z.string().min(1).max(500)).max(30),
    problems: z.array(z.string().min(1).max(2_000)).max(50),
    signals: z.array(z.string().min(1).max(2_000)).max(50),
    exclusions: z.array(z.string().min(1).max(2_000)).max(50),
    unknowns: z.array(z.string().min(1).max(2_000)).max(50),
    sourcingStatus: v3SourcingStatusSchema.nullable(),
    attractiveness: axisSchema,
    executability: axisSchema,
    researchConfidence: axisSchema,
    evidenceIds: z.array(z.string().min(1).max(100)).max(100),
  })).max(5),
}).superRefine((output, context) => {
  const ranks = output.proposals.map((proposal) => proposal.rank);
  if (new Set(ranks).size !== ranks.length) {
    context.addIssue({ code: "custom", message: "Proposal ranks must be unique", path: ["proposals"] });
  }
  for (const [index, proposal] of output.proposals.entries()) {
    if (proposal.rank !== index + 1) {
      context.addIssue({
        code: "custom",
        message: "Proposal ranks must be contiguous and ordered",
        path: ["proposals", index, "rank"],
      });
    }
    if (proposal.state === "priority_for_test" && proposal.sourcingStatus !== "verified") {
      context.addIssue({
        code: "custom",
        message: "A priority_for_test proposal requires verified sourcing",
        path: ["proposals", index, "sourcingStatus"],
      });
    }
  }
  if (output.status === "complete" && output.missingStages.length > 0) {
    context.addIssue({
      code: "custom",
      message: "A complete ranking cannot list missing stages",
      path: ["missingStages"],
    });
  }
  if (output.status === "partial" && output.missingStages.length === 0) {
    context.addIssue({
      code: "custom",
      message: "A partial ranking must explain its missing work",
      path: ["missingStages"],
    });
  }
});

export type ProductTruthOutput = z.infer<typeof productTruthOutputSchema>;
export type ProblemMappingOutput = z.infer<typeof problemMappingOutputSchema>;
export type OrganizationDiscoveryOutput = z.infer<typeof organizationDiscoveryOutputSchema>;
export type MarketInvestigationOutput = z.infer<typeof marketInvestigationOutputSchema>;
export type BuyingContextOutput = z.infer<typeof buyingContextOutputSchema>;
export type SourcingValidationOutput = z.infer<typeof sourcingValidationOutputSchema>;
export type IcpCompositionOutput = z.infer<typeof icpCompositionOutputSchema>;
export type AdversarialReviewOutput = z.infer<typeof adversarialReviewOutputSchema>;
export type ObjectiveRankingOutput = z.infer<typeof objectiveRankingOutputSchema>;
