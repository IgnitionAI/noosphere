import { and, eq } from "drizzle-orm";
import { parseAgentOutput, type AgentStageOutput } from "@outbound/contracts/product-research";
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
    const discovery = output as Extract<AgentStageOutput, { candidates: unknown }>;
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
    const synthesis = output as Extract<AgentStageOutput, { proposals: unknown }>;
    for (const proposal of synthesis.proposals) {
      await input.executor
        .insert(icpProposals)
        .values({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          runId: input.runId,
          name: proposal.name,
          rank: proposal.rank,
          confidence: String(proposal.confidence),
          criteria: proposal.companyCriteria,
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
            criteria: proposal.companyCriteria,
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
          ),
        );
    }
  }
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
        metadata: { sourceKey: source.evidenceId, stage },
      })
      .onConflictDoUpdate({
        target: [marketEvidence.workspaceId, marketEvidence.runId, marketEvidence.contentHash],
        set: {
          title: source.title,
          excerpt: source.excerpt,
          observedAt: new Date(source.observedAt),
          metadata: { sourceKey: source.evidenceId, stage },
        },
      });
  }
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
    return output.candidates.map((candidate, index) => ({
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

async function upsertFinding(input: {
  executor: ProjectionExecutor;
  workspaceId: string;
  runId: string;
  stage: ResearchStage;
  path: string;
  claim: Claim;
  evidenceMap: ReadonlyMap<string, string>;
}): Promise<void> {
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
