import { and, eq, notInArray } from "drizzle-orm";
import {
  parseAgentOutput,
  type AgentStageOutput,
  type CompetitorDiscoveryOutput,
  type IcpSynthesisOutput,
} from "@outbound/contracts/product-research";
import type { ObjectiveRankingOutput } from "@outbound/contracts/product-research-v3";
import type { ResearchStage } from "@outbound/domain/gtm/product-research";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  competitorCandidates,
  icpProposals,
  marketEvidence,
  researchFindingEvidence,
  researchFindings,
} from "@outbound/infrastructure/database/schema";

type ProjectionExecutor = Pick<Database, "select" | "insert" | "update" | "delete">;
type Claim = {
  statement: string;
  confidence: number;
  evidenceIds: string[];
  hypothesis: boolean;
};

export async function projectResearchStage(input: {
  executor: ProjectionExecutor;
  workspaceId: string;
  runId: string;
  stage: ResearchStage;
  output: unknown;
}): Promise<void> {
  const output = parseAgentOutput(input.stage, input.output);
  await projectEvidence(input.executor, input.workspaceId, input.runId, input.stage, output);
  const evidenceMap = await loadEvidenceMap(input.executor, input.workspaceId, input.runId);

  if (input.stage === "competitor_discovery") {
    const discovery = output as CompetitorDiscoveryOutput;
    await input.executor
      .delete(competitorCandidates)
      .where(
        and(
          eq(competitorCandidates.workspaceId, input.workspaceId),
          eq(competitorCandidates.runId, input.runId),
        ),
      );
    if (discovery.candidates.length) {
      await input.executor.insert(competitorCandidates).values(
        discovery.candidates.map((candidate) => ({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          runId: input.runId,
          name: candidate.name,
          url: candidate.url,
          relation: candidate.relation,
          rationale: candidate.rationale,
          confidence: String(candidate.confidence),
        })),
      );
    }
  }

  for (const finding of extractFindings(input.stage, output)) {
    await upsertFinding({
      executor: input.executor,
      workspaceId: input.workspaceId,
      runId: input.runId,
      stage: input.stage,
      ...finding,
      evidenceMap,
    });
  }

  if (input.stage === "icp_synthesis") {
    const synthesis = output as IcpSynthesisOutput;
    await input.executor
      .delete(icpProposals)
      .where(
        and(
          eq(icpProposals.workspaceId, input.workspaceId),
          eq(icpProposals.runId, input.runId),
          eq(icpProposals.humanEdited, false),
          notInArray(
            icpProposals.rank,
            synthesis.proposals.map((proposal) => proposal.rank),
          ),
        ),
      );
    for (const proposal of synthesis.proposals) {
      const existing = await input.executor
        .select({ id: icpProposals.id, humanEdited: icpProposals.humanEdited })
        .from(icpProposals)
        .where(
          and(
            eq(icpProposals.workspaceId, input.workspaceId),
            eq(icpProposals.runId, input.runId),
            eq(icpProposals.rank, proposal.rank),
          ),
        )
        .limit(1);
      // A human correction is never overwritten by a machine re-run.
      if (existing[0]?.humanEdited) continue;
      await input.executor
        .insert(icpProposals)
        .values({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          runId: input.runId,
          name: proposal.name,
          rank: proposal.rank,
          confidence: String(proposal.confidence),
          criteria: proposalCriteria(proposal),
          buyingCommittee: proposal.buyingCommittee,
          problems: proposal.problems,
          signals: proposal.signals,
          exclusions: proposal.exclusions,
          unknowns: proposal.unknowns,
        })
        .onConflictDoUpdate({
          target: [icpProposals.workspaceId, icpProposals.runId, icpProposals.rank],
          set: {
            name: proposal.name,
            confidence: String(proposal.confidence),
            criteria: proposalCriteria(proposal),
            buyingCommittee: proposal.buyingCommittee,
            problems: proposal.problems,
            signals: proposal.signals,
            exclusions: proposal.exclusions,
            unknowns: proposal.unknowns,
            updatedAt: new Date(),
          },
        });
    }
  }

  if (input.stage === "objective_ranking") {
    await projectV3IcpProposals(
      input.executor,
      input.workspaceId,
      input.runId,
      output as ObjectiveRankingOutput,
    );
  }

  if (input.stage === "evidence_review") {
    const review = output as Extract<AgentStageOutput, { reviewedFindings: unknown }>;
    for (const item of review.reviewedFindings) {
      await input.executor
        .update(researchFindings)
        .set({
          reviewStatus: item.decision,
          ...(item.replacement ? { statement: item.replacement } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(researchFindings.workspaceId, input.workspaceId),
            eq(researchFindings.runId, input.runId),
            eq(researchFindings.findingPath, item.findingPath),
            eq(researchFindings.humanEdited, false),
          ),
        );
    }
  }
}

async function projectV3IcpProposals(
  executor: ProjectionExecutor,
  workspaceId: string,
  runId: string,
  ranking: ObjectiveRankingOutput,
): Promise<void> {
  const ranks = ranking.proposals.map((proposal) => proposal.rank);
  const removable = and(
    eq(icpProposals.workspaceId, workspaceId),
    eq(icpProposals.runId, runId),
    eq(icpProposals.humanEdited, false),
  );
  await executor
    .delete(icpProposals)
    .where(ranks.length ? and(removable, notInArray(icpProposals.rank, ranks)) : removable);

  for (const proposal of ranking.proposals) {
    await executor
      .insert(icpProposals)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        runId,
        name: proposal.name,
        rank: proposal.rank,
        confidence: String(proposal.confidence),
        criteria: v3ProposalCriteria(proposal),
        buyingCommittee: proposal.buyingCommittee,
        problems: proposal.problems,
        signals: proposal.signals,
        exclusions: proposal.exclusions,
        unknowns: proposal.unknowns,
        reviewStatus: "approved",
        reviewReason: "Automatically ranked by ICP V3",
        reviewedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [icpProposals.workspaceId, icpProposals.runId, icpProposals.rank],
        set: {
          name: proposal.name,
          confidence: String(proposal.confidence),
          criteria: v3ProposalCriteria(proposal),
          buyingCommittee: proposal.buyingCommittee,
          problems: proposal.problems,
          signals: proposal.signals,
          exclusions: proposal.exclusions,
          unknowns: proposal.unknowns,
          reviewStatus: "approved",
          reviewReason: "Automatically ranked by ICP V3",
          reviewedBy: null,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }
}

function v3ProposalCriteria(
  proposal: ObjectiveRankingOutput["proposals"][number],
): Readonly<Record<string, unknown>> {
  return {
    buyerType: "end_customer",
    candidateId: proposal.candidateId,
    organizationType: proposal.organizationType,
    useCase: proposal.useCase,
    state: proposal.state,
    origin: proposal.origin,
    sourcingStatus: proposal.sourcingStatus,
    prospecting: proposal.prospecting,
    industries: proposal.prospecting.industries,
    naceCodes: proposal.prospecting.naceCodes,
    companySizes: proposal.prospecting.companySizes,
    geography: proposal.prospecting.geographies[0] ?? null,
    geographies: proposal.prospecting.geographies,
    searchKeywords: proposal.prospecting.searchKeywords,
    attractiveness: proposal.attractiveness,
    executability: proposal.executability,
    researchConfidence: proposal.researchConfidence,
    evidenceIds: proposal.evidenceIds,
  };
}

async function projectEvidence(
  executor: ProjectionExecutor,
  workspaceId: string,
  runId: string,
  stage: ResearchStage,
  output: AgentStageOutput,
): Promise<void> {
  if (!("evidence" in output)) return;
  for (const source of output.evidence) {
    await executor
      .insert(marketEvidence)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        runId,
        sourceType: source.sourceType,
        url: source.url,
        title: source.title,
        excerpt: source.excerpt,
        contentHash: source.contentHash,
        observedAt: new Date(source.observedAt),
        metadata: evidenceMetadata(source, stage),
      })
      .onConflictDoUpdate({
        target: [marketEvidence.workspaceId, marketEvidence.runId, marketEvidence.contentHash],
        set: {
          title: source.title,
          excerpt: source.excerpt,
          observedAt: new Date(source.observedAt),
          metadata: evidenceMetadata(source, stage),
        },
      });
  }
}

function evidenceMetadata(
  source: Record<string, unknown>,
  stage: ResearchStage,
): Readonly<Record<string, unknown>> {
  return {
    sourceKey: source.evidenceId,
    stage,
    ...(typeof source.sourceRelation === "string"
      ? { sourceRelation: source.sourceRelation }
      : {}),
    ...(typeof source.evidenceKind === "string"
      ? { evidenceKind: source.evidenceKind }
      : {}),
    ...(typeof source.originFamily === "string"
      ? { originFamily: source.originFamily }
      : {}),
    ...(typeof source.context === "string" ? { context: source.context } : {}),
  };
}

async function loadEvidenceMap(
  executor: ProjectionExecutor,
  workspaceId: string,
  runId: string,
): Promise<Map<string, string>> {
  const rows = await executor
    .select({ id: marketEvidence.id, metadata: marketEvidence.metadata })
    .from(marketEvidence)
    .where(and(eq(marketEvidence.workspaceId, workspaceId), eq(marketEvidence.runId, runId)));
  return new Map(
    rows.flatMap((row) => {
      const sourceKey =
        row.metadata &&
        typeof row.metadata === "object" &&
        "sourceKey" in row.metadata &&
        typeof row.metadata.sourceKey === "string"
          ? row.metadata.sourceKey
          : null;
      return sourceKey ? [[sourceKey, row.id] as const] : [];
    }),
  );
}

function extractFindings(
  stage: ResearchStage,
  output: AgentStageOutput,
): { path: string; claim: Claim }[] {
  if (stage === "product_analysis" && "valuePropositions" in output) {
    return output.valuePropositions.map((claim, index) => ({
      path: `product_analysis.valuePropositions.${index}`,
      claim,
    }));
  }
  if (stage === "competitor_discovery" && "candidates" in output) {
    return (output as CompetitorDiscoveryOutput).candidates.map((candidate, index) => ({
      path: `competitor_discovery.candidates.${index}.rationale`,
      claim: {
        statement: candidate.rationale,
        confidence: candidate.confidence,
        evidenceIds: candidate.evidenceIds,
        hypothesis: false,
      },
    }));
  }
  if (stage === "competitor_analysis" && "competitors" in output) {
    return output.competitors.flatMap((competitor, competitorIndex) =>
      competitor.gaps.map((claim, claimIndex) => ({
        path: `competitor_analysis.competitors.${competitorIndex}.gaps.${claimIndex}`,
        claim,
      })),
    );
  }
  if (stage === "buyer_landscape_discovery" && "buyerSegments" in output) {
    return output.buyerSegments.flatMap((segment, segmentIndex) =>
      segment.demandSignals.map((claim, claimIndex) => ({
        path: `buyer_landscape_discovery.buyerSegments.${segmentIndex}.demandSignals.${claimIndex}`,
        claim,
      })),
    );
  }
  if (stage === "segment_synthesis" && "segments" in output) {
    return output.segments.flatMap((segment, segmentIndex) => [
      ...segment.problems.map((claim, claimIndex) => ({
        path: `segment_synthesis.segments.${segmentIndex}.problems.${claimIndex}`,
        claim,
      })),
      ...segment.buyingSignals.map((claim, claimIndex) => ({
        path: `segment_synthesis.segments.${segmentIndex}.buyingSignals.${claimIndex}`,
        claim,
      })),
    ]);
  }
  return [];
}

function proposalCriteria(
  proposal: IcpSynthesisOutput["proposals"][number],
): Readonly<Record<string, unknown>> {
  return {
    ...proposal.companyCriteria,
    buyerType: proposal.buyerType,
    scorecard: proposal.scorecard,
    prospecting: proposal.prospecting,
    industries: proposal.prospecting.industries,
    naceCodes: proposal.prospecting.naceCodes,
    companySizes: proposal.prospecting.companySizes,
    geography: proposal.prospecting.geographies[0] ?? null,
    geographies: proposal.prospecting.geographies,
    searchKeywords: proposal.prospecting.searchKeywords,
    marketEvidenceIds: proposal.marketEvidenceIds,
  };
}

async function upsertFinding(input: {
  executor: ProjectionExecutor;
  workspaceId: string;
  runId: string;
  stage: ResearchStage;
  path: string;
  claim: Claim;
  evidenceMap: ReadonlyMap<string, string>;
}): Promise<void> {
  const existing = await input.executor
    .select({ id: researchFindings.id, humanEdited: researchFindings.humanEdited })
    .from(researchFindings)
    .where(
      and(
        eq(researchFindings.workspaceId, input.workspaceId),
        eq(researchFindings.runId, input.runId),
        eq(researchFindings.findingPath, input.path),
      ),
    )
    .limit(1);
  // A human-corrected finding keeps its statement, confidence, review status
  // and evidence links across machine re-runs.
  if (existing[0]?.humanEdited) return;
  const rows = await input.executor
    .insert(researchFindings)
    .values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      runId: input.runId,
      stage: input.stage,
      findingPath: input.path,
      statement: input.claim.statement,
      confidence: String(input.claim.confidence),
      hypothesis: input.claim.hypothesis,
    })
    .onConflictDoUpdate({
      target: [
        researchFindings.workspaceId,
        researchFindings.runId,
        researchFindings.findingPath,
      ],
      set: {
        statement: input.claim.statement,
        confidence: String(input.claim.confidence),
        hypothesis: input.claim.hypothesis,
        reviewStatus: "unreviewed",
        updatedAt: new Date(),
      },
    })
    .returning({ id: researchFindings.id });
  const findingId = rows[0]?.id;
  if (!findingId) throw new Error("RESEARCH_FINDING_UPSERT_FAILED");
  await input.executor
    .delete(researchFindingEvidence)
    .where(
      and(
        eq(researchFindingEvidence.workspaceId, input.workspaceId),
        eq(researchFindingEvidence.findingId, findingId),
      ),
    );
  const evidenceIds = input.claim.evidenceIds.flatMap((key) => {
    const id = input.evidenceMap.get(key);
    return id ? [id] : [];
  });
  if (evidenceIds.length) {
    await input.executor.insert(researchFindingEvidence).values(
      evidenceIds.map((evidenceId) => ({
        workspaceId: input.workspaceId,
        findingId,
        evidenceId,
      })),
    );
  }
  if (!input.claim.hypothesis && evidenceIds.length === 0) {
    throw new Error(`UNRESOLVED_EVIDENCE_KEY:${input.path}`);
  }
}
