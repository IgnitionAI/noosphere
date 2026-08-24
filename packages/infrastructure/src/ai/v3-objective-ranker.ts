import {
  adversarialReviewOutputSchema,
  icpCompositionOutputSchema,
  objectiveRankingOutputSchema,
  type AgentStageInput,
  type ObjectiveRankingOutput,
} from "@outbound/contracts/product-research";

export class V3ObjectiveRanker {
  rank(input: AgentStageInput): ObjectiveRankingOutput {
    const objective = input.brief.researchObjective ?? "qualified_conversations";
    const composition = icpCompositionOutputSchema.parse(input.previousOutputs.icp_composition);
    const review = adversarialReviewOutputSchema.parse(input.previousOutputs.adversarial_review);
    const reviews = new Map(review.reviews.map((item) => [item.candidateId, item]));
    const candidates = composition.candidates
      .flatMap((candidate) => {
        const decision = reviews.get(candidate.candidateId);
        if (!decision || decision.decision === "reject") return [];
        const state = deterministicState(candidate, decision.decision);
        if (state === "insufficient") return [];
        const claims = candidate.buyingContext.claims;
        return [{
          candidateId: candidate.candidateId,
          rank: 1,
          name: candidate.name,
          state,
          origin: candidate.origin,
          confidence: Math.min(
            candidate.attractiveness.confidence,
            candidate.executability.confidence,
            candidate.researchConfidence.confidence,
          ),
          organizationType: candidate.organizationType,
          useCase: candidate.useCase,
          prospecting: candidate.prospecting,
          buyingCommittee: unique([
            ...candidate.buyingContext.economicBuyers,
            ...candidate.buyingContext.sponsors,
            ...candidate.buyingContext.users,
          ]),
          problems: candidate.problems,
          signals: candidate.signals,
          exclusions: candidate.exclusions,
          unknowns: candidate.unknowns,
          sourcingStatus: candidate.sourcingStatus,
          attractiveness: candidate.attractiveness,
          executability: candidate.executability,
          researchConfidence: candidate.researchConfidence,
          evidenceIds: unique(claims.flatMap((claim) =>
            claim.evidence.map((link) => link.evidenceId),
          )),
        }];
      })
      .sort((left, right) => compareForObjective(objective, left, right))
      .slice(0, 5)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    return objectiveRankingOutputSchema.parse({
      objective,
      status: "complete",
      summary:
        candidates.length === 0
          ? "No candidate satisfied the evidence, adversarial-review and sourcing gates."
          : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} passed the deterministic evidence and sourcing gates.`,
      missingStages: [],
      coverage: review.coverage,
      proposals: candidates,
    });
  }
}

function compareForObjective(
  objective: "qualified_conversations" | "fast_revenue" | "strategic_market",
  left: RankedCandidate,
  right: RankedCandidate,
): number {
  const order = objective === "strategic_market"
    ? ["attractiveness", "researchConfidence", "executability"] as const
    : objective === "fast_revenue"
      ? ["executability", "attractiveness", "researchConfidence"] as const
      : ["executability", "researchConfidence", "attractiveness"] as const;
  for (const axis of order) {
    const difference = right[axis].value - left[axis].value;
    if (difference !== 0) return difference;
  }
  return right.confidence - left.confidence || left.candidateId.localeCompare(right.candidateId);
}

type RankedCandidate = {
  readonly candidateId: string;
  readonly confidence: number;
  readonly attractiveness: { readonly value: number };
  readonly executability: { readonly value: number };
  readonly researchConfidence: { readonly value: number };
};

function deterministicState(
  candidate: ReturnType<typeof icpCompositionOutputSchema.parse>["candidates"][number],
  reviewDecision: "keep" | "downgrade" | "reject",
): "priority_for_test" | "adjacent_experiment" | "insufficient" {
  if (reviewDecision === "reject") return "insufficient";
  if (
    reviewDecision === "keep" &&
    candidate.sourcingStatus === "verified" &&
    candidate.researchConfidence.value >= 2
  ) {
    return "priority_for_test";
  }
  if (candidate.attractiveness.value >= 2) return "adjacent_experiment";
  return "insufficient";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
