import { z } from "zod";

export const researchStageSchema = z.enum([
  "product_analysis",
  "competitor_discovery",
  "competitor_analysis",
  "segment_synthesis",
  "icp_synthesis",
  "evidence_review",
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
  workspaceId: z.string().uuid(),
  brief: productResearchBriefSchema,
  previousOutputs: z.record(z.string(), z.unknown()),
  correlationId: z.string().min(1).max(200),
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

export const segmentSynthesisInputSchema = commonAgentInputSchema.extend({
  stage: z.literal("segment_synthesis"),
});
export const segmentSynthesisOutputSchema = z.object({
  segments: z
    .array(
      z.object({
        name: z.string().min(1).max(500),
        description: z.string().min(1).max(5_000),
        problems: z.array(claimSchema).max(30),
        buyingSignals: z.array(claimSchema).max(30),
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
        rank: z.number().int().positive(),
        confidence: z.number().min(0).max(1),
        companyCriteria: z.record(z.string(), z.unknown()),
        buyingCommittee: z.array(z.string().min(1).max(500)).max(30),
        problems: z.array(z.string().min(1).max(2_000)).max(50),
        signals: z.array(z.string().min(1).max(2_000)).max(50),
        exclusions: z.array(z.string().min(1).max(2_000)).max(50),
        unknowns: z.array(z.string().min(1).max(2_000)).max(50),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .min(1)
    .max(10),
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
        replacement: z.string().max(5_000).nullable(),
        evidenceIds: z.array(z.string()),
      }),
    )
    .max(500),
  unresolvedContradictions: z.array(z.string().min(1).max(3_000)).max(100),
  executiveSummary: z.string().min(1).max(15_000),
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
} as const;

export type ResearchAgentRole = (typeof agentContracts)[keyof typeof agentContracts]["role"];
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
