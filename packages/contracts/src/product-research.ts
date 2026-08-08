import { z } from "zod";
import {
  adversarialReviewOutputSchema,
  buyingContextOutputSchema,
  icpCompositionOutputSchema,
  marketInvestigationOutputSchema,
  objectiveRankingOutputSchema,
  organizationDiscoveryOutputSchema,
  problemMappingOutputSchema,
  productTruthOutputSchema,
  sourcingValidationOutputSchema,
} from "./product-research-v3";

export * from "./product-research-v3";

export const researchStageSchema = z.enum([
  "product_analysis",
  "competitor_discovery",
  "competitor_analysis",
  "buyer_landscape_discovery",
  "segment_synthesis",
  "icp_synthesis",
  "evidence_review",
  "product_truth",
  "problem_mapping",
  "organization_discovery",
  "market_investigation",
  "buying_context",
  "sourcing_validation",
  "icp_composition",
  "adversarial_review",
  "objective_ranking",
]);

export const productResearchBriefSchema = z
  .object({
    productUrl: z.string().url().or(z.literal("")),
    productName: z.string().trim().min(1).max(200),
    description: z.string().trim().max(20_000),
    geography: z.string().trim().min(1).max(200),
    languages: z.array(z.string().trim().min(2).max(20)).min(1).max(10),
    salesMotion: z.enum(["service", "saas", "license", "hybrid"]),
    knownCompetitors: z.array(z.string().trim().min(1).max(300)).max(50),
    internalDocumentIds: z.array(z.string().uuid()).max(100),
    depth: z.enum(["quick", "standard", "deep"]),
    audienceGoal: z
      .enum(["end_customers", "channel_partners", "both"])
      .default("end_customers"),
    buyerConstraints: z.string().trim().max(5_000).default(""),
    researchObjective: z
      .enum(["qualified_conversations", "fast_revenue", "strategic_market"])
      .optional(),
    researchVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(3),
  })
  .strict()
  .refine((brief) => Boolean(brief.productUrl || brief.description), {
    message: "A product URL or description is required",
    path: ["productUrl"],
  });

export const researchStageJobPayloadSchema = z.object({
  workspaceId: z.string().uuid(),
  runId: z.string().uuid(),
  stage: researchStageSchema,
  workItemKey: z.string().min(1).max(160).default("main"),
  hypothesisId: z.string().min(1).max(100).nullable().default(null),
  fanoutSize: z.number().int().min(1).max(4).nullable().default(null),
  finalizeFanout: z.boolean().default(false),
});

export type ResearchStageJobPayload = z.infer<typeof researchStageJobPayloadSchema>;

const sourceReferenceSchema = z.object({
  evidenceId: z.string().min(1).max(100),
  url: z.string().url().nullable(),
  title: z.string().min(1).max(500),
  excerpt: z.string().min(1).max(5_000),
  sourceType: z.enum(["public_web", "internal_document"]),
  observedAt: z.string().datetime(),
  contentHash: z.string().min(16).max(128),
});

const claimSchema = z
  .object({
    statement: z.string().min(1).max(5_000),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().min(1).max(100)),
    hypothesis: z.boolean(),
  })
  .refine((claim) => claim.hypothesis || claim.evidenceIds.length > 0, {
    message: "A non-hypothesis claim requires evidence",
    path: ["evidenceIds"],
  });

const commonAgentInputSchema = z.object({
  runId: z.string().uuid(),
  researchStageRunId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  brief: productResearchBriefSchema,
  previousOutputs: z.record(z.string(), z.unknown()),
  correlationId: z.string().min(1).max(200),
  deadlineAt: z.string().datetime().nullable().default(null),
  workItemKey: z.string().min(1).max(160).default("main"),
  externalDlpTerms: z.array(z.string().min(8).max(1_000)).max(200).default([]),
});

export const productAnalystInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("product_analysis"),
});
export const productAnalystOutputSchema = z.object({
  productSummary: z.string().min(1).max(10_000),
  valuePropositions: z.array(claimSchema).max(50),
  targetHints: z.array(z.string().min(1).max(1_000)).max(50),
  unknowns: z.array(z.string().min(1).max(1_000)).max(50),
  evidence: z.array(sourceReferenceSchema).max(200),
});

export const competitorDiscoveryInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("competitor_discovery"),
});
export const competitorDiscoveryOutputSchema = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        url: z.string().url().nullable(),
        relation: z.enum(["direct", "adjacent", "alternative"]),
        rationale: z.string().min(1).max(3_000),
        confidence: z.number().min(0).max(1),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .max(100),
  evidence: z.array(sourceReferenceSchema).max(500),
});

export const competitorAnalysisInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("competitor_analysis"),
});
export const competitorAnalysisOutputSchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        positioning: z.string().min(1).max(5_000),
        apparentSegments: z.array(z.string().min(1).max(500)).max(30),
        strengths: z.array(z.string().min(1).max(1_000)).max(30),
        gaps: z.array(claimSchema).max(30),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .max(100),
});

const buyerTypeSchema = z.enum(["end_customer", "channel_partner", "internal_builder"]);

const prospectingPlanSchema = z.object({
  naceCodes: z.array(z.string().min(1).max(30)).max(30),
  industries: z.array(z.string().min(1).max(300)).min(1).max(30),
  companySizes: z.array(z.string().min(1).max(200)).min(1).max(20),
  geographies: z.array(z.string().min(1).max(200)).min(1).max(20),
  jobTitles: z.array(z.string().min(1).max(300)).min(1).max(30),
  triggerSignals: z.array(z.string().min(1).max(1_000)).min(1).max(30),
  exclusions: z.array(z.string().min(1).max(1_000)).min(1).max(30),
  searchKeywords: z.array(z.string().min(1).max(500)).min(1).max(30),
});

const buildVsBuySchema = z.object({
  buildAbility: z.number().min(0).max(100),
  willingnessToBuy: z.number().min(0).max(100),
  rationale: z.string().min(1).max(3_000),
  evidenceIds: z.array(z.string().min(1).max(100)).min(1).max(30),
});

export const buyerLandscapeInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("buyer_landscape_discovery"),
});
export const buyerLandscapeOutputSchema = z.object({
  buyerSegments: z
    .array(
      z.object({
        name: z.string().min(1).max(500),
        buyerType: buyerTypeSchema,
        description: z.string().min(1).max(5_000),
        industries: z.array(z.string().min(1).max(500)).min(1).max(30),
        useCases: z.array(z.string().min(1).max(1_000)).min(1).max(30),
        recurringWorkflows: z.array(z.string().min(1).max(1_000)).min(1).max(30),
        corpusTypes: z.array(z.string().min(1).max(500)).min(1).max(30),
        buyingCommittee: z.array(z.string().min(1).max(500)).min(1).max(30),
        demandSignals: z.array(claimSchema).min(1).max(30),
        buildVsBuy: buildVsBuySchema,
        prospecting: prospectingPlanSchema,
        confidence: z.number().min(0).max(1),
        marketEvidenceIds: z.array(z.string().min(1).max(100)).min(2).max(50),
        productFitEvidenceIds: z.array(z.string().min(1).max(100)).min(1).max(50),
      }),
    )
    .min(1)
    .max(20),
  marketUnknowns: z.array(z.string().min(1).max(1_000)).max(50),
  evidence: z.array(sourceReferenceSchema).max(500),
});

export const segmentSynthesisInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("segment_synthesis"),
});
export const segmentSynthesisOutputSchema = z.object({
  segments: z
    .array(
      z.object({
        name: z.string().min(1).max(500),
        buyerType: buyerTypeSchema,
        description: z.string().min(1).max(5_000),
        industries: z.array(z.string().min(1).max(500)).min(1).max(30),
        recurringWorkflows: z.array(z.string().min(1).max(1_000)).min(1).max(30),
        problems: z.array(claimSchema).max(30),
        buyingSignals: z.array(claimSchema).max(30),
        buildVsBuy: buildVsBuySchema,
        prospecting: prospectingPlanSchema,
        marketEvidenceIds: z.array(z.string().min(1).max(100)).min(2).max(50),
        confidence: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(30),
});

export const icpSynthesisInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("icp_synthesis"),
});
export const icpSynthesisOutputSchema = z.object({
  proposals: z
    .array(
      z.object({
        name: z.string().min(1).max(500),
        buyerType: buyerTypeSchema,
        rank: z.number().int().positive(),
        confidence: z.number().min(0).max(1),
        scorecard: z.object({
          productFit: z.number().min(0).max(100),
          painIntensity: z.number().min(0).max(100),
          recurringNeed: z.number().min(0).max(100),
          budgetFit: z.number().min(0).max(100),
          urgency: z.number().min(0).max(100),
          reachability: z.number().min(0).max(100),
          buildAbility: z.number().min(0).max(100),
          willingnessToBuy: z.number().min(0).max(100),
          evidenceStrength: z.number().min(0).max(100),
          total: z.number().min(0).max(100),
        }),
        companyCriteria: z.record(z.string(), z.unknown()),
        prospecting: prospectingPlanSchema,
        buyingCommittee: z.array(z.string().min(1).max(500)).max(30),
        problems: z.array(z.string().min(1).max(2_000)).max(50),
        signals: z.array(z.string().min(1).max(2_000)).max(50),
        exclusions: z.array(z.string().min(1).max(2_000)).max(50),
        unknowns: z.array(z.string().min(1).max(2_000)).max(50),
        evidenceIds: z.array(z.string()).min(1),
        marketEvidenceIds: z.array(z.string()).min(2),
      }),
    )
    .min(1)
    .max(5),
});

export const evidenceReviewInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("evidence_review"),
});
export const evidenceReviewOutputSchema = z.object({
  reviewedFindings: z
    .array(
      z.object({
        findingPath: z.string().min(1).max(500),
        decision: z.enum(["accepted", "reworded", "rejected", "hypothesis"]),
        rationale: z.string().min(1).max(3_000),
        replacement: z.string().max(5_000).nullable().optional().default(null),
        evidenceIds: z.array(z.string()),
      }),
    )
    .max(500),
  unresolvedContradictions: z.array(z.string().min(1).max(3_000)).max(100),
  commercialReadiness: z.object({
    decision: z.enum(["ready", "needs_more_research"]),
    rationale: z.string().min(1).max(5_000),
    blockedProposalRanks: z.array(z.number().int().positive()).max(5),
    missingEvidence: z.array(z.string().min(1).max(2_000)).max(50),
  }),
  executiveSummary: z.string().min(1).max(15_000),
});

export const productTruthInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("product_truth"),
});
export const problemMappingInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("problem_mapping"),
});
export const organizationDiscoveryInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("organization_discovery"),
});
export const marketInvestigationInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("market_investigation"),
});
export const buyingContextInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("buying_context"),
});
export const sourcingValidationInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("sourcing_validation"),
});
export const icpCompositionInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("icp_composition"),
});
export const adversarialReviewInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("adversarial_review"),
});
export const objectiveRankingInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("objective_ranking"),
});

export const agentContracts = {
  product_analysis: {
    role: "ProductAnalyst",
    input: productAnalystInputSchema,
    output: productAnalystOutputSchema,
  },
  competitor_discovery: {
    role: "CompetitorResearcher",
    input: competitorDiscoveryInputSchema,
    output: competitorDiscoveryOutputSchema,
  },
  competitor_analysis: {
    role: "CompetitorResearcher",
    input: competitorAnalysisInputSchema,
    output: competitorAnalysisOutputSchema,
  },
  buyer_landscape_discovery: {
    role: "BuyerResearcher",
    input: buyerLandscapeInputSchema,
    output: buyerLandscapeOutputSchema,
  },
  segment_synthesis: {
    role: "ICPStrategist",
    input: segmentSynthesisInputSchema,
    output: segmentSynthesisOutputSchema,
  },
  icp_synthesis: {
    role: "ICPStrategist",
    input: icpSynthesisInputSchema,
    output: icpSynthesisOutputSchema,
  },
  evidence_review: {
    role: "EvidenceReviewer",
    input: evidenceReviewInputSchema,
    output: evidenceReviewOutputSchema,
  },
  product_truth: {
    role: "ProductInterpreter",
    input: productTruthInputSchema,
    output: productTruthOutputSchema,
  },
  problem_mapping: {
    role: "ProblemMapper",
    input: problemMappingInputSchema,
    output: problemMappingOutputSchema,
  },
  organization_discovery: {
    role: "OrganizationDiscoverer",
    input: organizationDiscoveryInputSchema,
    output: organizationDiscoveryOutputSchema,
  },
  market_investigation: {
    role: "MarketInvestigator",
    input: marketInvestigationInputSchema,
    output: marketInvestigationOutputSchema,
  },
  buying_context: {
    role: "BuyingContextAnalyst",
    input: buyingContextInputSchema,
    output: buyingContextOutputSchema,
  },
  sourcing_validation: {
    role: "SourcingValidator",
    input: sourcingValidationInputSchema,
    output: sourcingValidationOutputSchema,
  },
  icp_composition: {
    role: "ICPComposer",
    input: icpCompositionInputSchema,
    output: icpCompositionOutputSchema,
  },
  adversarial_review: {
    role: "AdversarialReviewer",
    input: adversarialReviewInputSchema,
    output: adversarialReviewOutputSchema,
  },
  objective_ranking: {
    role: "ObjectiveRanker",
    input: objectiveRankingInputSchema,
    output: objectiveRankingOutputSchema,
  },
} as const;

export type ResearchAgentRole = (typeof agentContracts)[keyof typeof agentContracts]["role"];
export type CompetitorDiscoveryOutput = z.infer<typeof competitorDiscoveryOutputSchema>;
export type BuyerLandscapeOutput = z.infer<typeof buyerLandscapeOutputSchema>;
export type SegmentSynthesisOutput = z.infer<typeof segmentSynthesisOutputSchema>;
export type IcpSynthesisOutput = z.infer<typeof icpSynthesisOutputSchema>;
export type EvidenceReviewOutput = z.infer<typeof evidenceReviewOutputSchema>;
export type AgentStageInput = z.infer<(typeof agentContracts)[keyof typeof agentContracts]["input"]>;
export type AgentStageOutput = z.infer<(typeof agentContracts)[keyof typeof agentContracts]["output"]>;
export const agentExecutionMetadataSchema = z.object({
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(120),
  parameters: z.record(z.string(), z.unknown()),
  cost: z.number().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative(),
});
export type AgentExecutionMetadata = z.infer<typeof agentExecutionMetadataSchema>;
export interface AgentExecutionResult {
  readonly output: AgentStageOutput;
  readonly metadata: AgentExecutionMetadata;
}

export function parseAgentInput(stage: keyof typeof agentContracts, input: unknown): AgentStageInput {
  return agentContracts[stage].input.parse(input) as AgentStageInput;
}

export function parseAgentOutput(stage: keyof typeof agentContracts, output: unknown): AgentStageOutput {
  return agentContracts[stage].output.parse(output) as AgentStageOutput;
}

export function parseAgentExecutionResult(
  stage: keyof typeof agentContracts,
  result: unknown,
): AgentExecutionResult {
  const envelope = z
    .object({
      output: z.unknown(),
      metadata: agentExecutionMetadataSchema,
    })
    .parse(result);
  return {
    output: parseAgentOutput(stage, envelope.output),
    metadata: envelope.metadata,
  };
}
