import {
  objectiveRankingOutputSchema,
  type IcpCompositionOutput,
  type ObjectiveRankingOutput,
  type OrganizationDiscoveryOutput,
  type ProblemMappingOutput,
  type MarketInvestigationOutput,
} from "@outbound/contracts/product-research-v3";
import { v3ResearchStages } from "@outbound/domain/gtm/product-research";

export function projectV3ReportProposals(
  output: unknown,
): Readonly<Record<string, unknown>>[] | null {
  if (!output || typeof output !== "object" || !("proposals" in output)) return null;
  const proposals = (output as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals)) return null;
  return proposals.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const proposal = candidate as Record<string, unknown>;
    return [{
      id: proposal.candidateId,
      name: proposal.name,
      rank: proposal.rank,
      confidence: proposal.confidence,
      criteria: {
        buyerType: "end_customer",
        organizationType: proposal.organizationType,
        useCase: proposal.useCase,
        prospecting: proposal.prospecting,
        state: proposal.state,
        origin: proposal.origin,
        sourcingStatus: proposal.sourcingStatus,
        attractiveness: proposal.attractiveness,
        executability: proposal.executability,
        researchConfidence: proposal.researchConfidence,
      },
      buyingCommittee: proposal.buyingCommittee,
      problems: proposal.problems,
      signals: proposal.signals,
      exclusions: proposal.exclusions,
      unknowns: proposal.unknowns,
      evidenceIds: proposal.evidenceIds,
    }];
  });
}

export function resolveV3ReportRanking(
  stageOutputs: Readonly<Record<string, unknown>>,
  forcePartial = false,
): ObjectiveRankingOutput | null {
  const existing = objectiveRankingOutputSchema.safeParse(stageOutputs.objective_ranking);
  if (existing.success) return existing.data;
  if (!forcePartial && !v3ResearchStages.some((stage) => stage in stageOutputs)) return null;
  return projectV3PartialRanking(stageOutputs);
}

export function projectV3PartialRanking(
  stageOutputs: Readonly<Record<string, unknown>>,
): ObjectiveRankingOutput {
  const productTruth = record(stageOutputs.product_truth);
  const problemsOutput = record(stageOutputs.problem_mapping) as Partial<ProblemMappingOutput>;
  const discovery = record(stageOutputs.organization_discovery) as Partial<OrganizationDiscoveryOutput>;
  const market = record(stageOutputs.market_investigation) as Partial<MarketInvestigationOutput>;
  const composition = record(stageOutputs.icp_composition) as Partial<IcpCompositionOutput>;
  const problems = Array.isArray(problemsOutput.problems) ? problemsOutput.problems : [];
  const hypotheses = Array.isArray(discovery.hypotheses) ? discovery.hypotheses : [];
  const investigations = Array.isArray(market.investigations) ? market.investigations : [];
  const candidates = Array.isArray(composition.candidates) ? composition.candidates : [];
  const missingStages = v3ResearchStages.filter((stage) => !(stage in stageOutputs));
  const problemById = new Map(problems.map((problem) => [problem.problemId, problem]));
  const investigationByHypothesis = new Map(
    investigations.map((investigation) => [investigation.hypothesisId, investigation]),
  );
  const proposals = candidates.length
    ? candidates.map((candidate, index) => {
        const committee = unique([
          ...candidate.buyingContext.users,
          ...candidate.buyingContext.sponsors,
          ...candidate.buyingContext.economicBuyers,
        ]);
        return {
          candidateId: candidate.candidateId,
          rank: index + 1,
          name: candidate.name,
          state: candidate.state,
          origin: candidate.origin,
          confidence: candidate.researchConfidence.confidence,
          organizationType: candidate.organizationType,
          useCase: candidate.useCase,
          prospecting: candidate.prospecting,
          buyingCommittee: committee,
          problems: candidate.problems,
          signals: candidate.signals,
          exclusions: candidate.exclusions,
          unknowns: unique([...candidate.unknowns, "Final ranking not completed"]),
          sourcingStatus: candidate.sourcingStatus,
          attractiveness: candidate.attractiveness,
          executability: candidate.executability,
          researchConfidence: candidate.researchConfidence,
          evidenceIds: evidenceForHypothesis(candidate.hypothesisId, investigationByHypothesis),
        };
      })
    : hypotheses.map((hypothesis, index) => {
        const investigation = investigationByHypothesis.get(hypothesis.hypothesisId);
        const problemStatements = hypothesis.problemIds.flatMap((problemId) => {
          const problem = problemById.get(problemId);
          return problem ? [`${problem.actor}: ${problem.workflow}`] : [];
        });
        const axis = {
          value: investigation ? 1 : 0,
          confidence: investigation ? 0.3 : 0.15,
          rationale: investigation
            ? "Market evidence was collected, but buying and sourcing validation did not finish."
            : "The organization hypothesis was generated but not fully investigated.",
          claimIds: investigation?.claims.map((claim) => claim.claimId) ?? [],
        };
        return {
          candidateId: hypothesis.hypothesisId,
          rank: index + 1,
          name: hypothesis.organizationType,
          state: "insufficient" as const,
          origin: hypothesis.origin,
          confidence: axis.confidence,
          organizationType: hypothesis.organizationType,
          useCase: hypothesis.description,
          prospecting: {
            naceCodes: [],
            industries: [hypothesis.organizationType],
            companySizes: [],
            geographies: [],
            jobTitles: [],
            triggerSignals: [],
            exclusions: hypothesis.assumptions,
            searchKeywords: hypothesis.validationQueries,
          },
          buyingCommittee: [],
          problems: problemStatements,
          signals: [],
          exclusions: hypothesis.assumptions,
          unknowns: [
            "Buying context not completed",
            "Sourcing validation not completed",
            "Final ranking not completed",
          ],
          sourcingStatus: null,
          attractiveness: axis,
          executability: axis,
          researchConfidence: axis,
          evidenceIds: unique([
            ...hypothesis.evidenceIds,
            ...evidenceForHypothesis(hypothesis.hypothesisId, investigationByHypothesis),
          ]),
        };
      });
  const generated = Math.max(hypotheses.length, candidates.length);
  const investigated = investigations.length;
  const productSummary = typeof productTruth.productSummary === "string"
    ? productTruth.productSummary
    : "The research budget ended before the full ICP workflow completed.";

  return objectiveRankingOutputSchema.parse({
    objective: "qualified_conversations",
    status: "partial",
    summary: `${productSummary} Partial report: ${missingStages.join(", ")} did not complete.`,
    missingStages,
    coverage: {
      generated,
      scanned: generated,
      investigated,
      sourced: 0,
      skippedByBudget: Math.max(0, generated - investigated),
    },
    proposals: proposals.slice(0, 5),
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function evidenceForHypothesis(
  hypothesisId: string,
  investigations: ReadonlyMap<string, MarketInvestigationOutput["investigations"][number]>,
): string[] {
  const investigation = investigations.get(hypothesisId);
  if (!investigation) return [];
  return unique(
    investigation.claims.flatMap((claim) => claim.evidence.map((link) => link.evidenceId)),
  );
}
