import { and, asc, desc, eq, gt, inArray, ne, notInArray, or } from "drizzle-orm";
import {
  ProductResearchRun,
  type ProductResearchBrief,
  type ProductResearchEvent,
  type ProductResearchRunSnapshot,
  type ResearchCheckpoint,
  type ResearchStage,
} from "@outbound/domain/gtm/product-research";
import type { NewJob } from "@outbound/application/jobs/job-queue";
import { PROSPECTING_CHANNELS } from "@outbound/domain/campaigns/prospecting-plan";
import type {
  ProductResearchRepository,
  ProductResearchViewRepository,
  MarketEvidenceView,
  ResearchStageRunView,
  ResearchAIRun,
  ResearchWorkItem,
} from "@outbound/application/gtm/product-research-ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  aiRuns,
  channelAssessments,
  competitorCandidates,
  icpProposals,
  icpVersions,
  jobs,
  marketEvidence,
  outboxEvents,
  productResearchRunDocuments,
  productResearchRuns,
  prospectingPlans,
  researchDocuments,
  researchFindingEvidence,
  researchFindings,
  researchStageRuns,
  researchWorkItems,
} from "@outbound/infrastructure/database/schema";
import { CHANNEL_ASSESSMENT_JOB_TYPE } from "@outbound/infrastructure/campaigns/channel-assessment-runner";
import { projectResearchStage } from "@outbound/infrastructure/gtm/research-stage-projection";
import {
  projectV3ReportProposals,
  resolveV3ReportRanking,
} from "@outbound/application/gtm/v3-report-projection";

type DbExecutor = Pick<Database, "insert" | "update">;
type ReadWriteExecutor = Pick<Database, "select" | "insert" | "update">;

export class PostgresProductResearchRepository
  implements ProductResearchRepository, ProductResearchViewRepository
{
  constructor(private readonly db: Database) {}

  async insert(run: ProductResearchRun): Promise<void> {
    await this.db.transaction(async (tx) => {
      const documentIds = run.snapshot.brief.internalDocumentIds;
      if (documentIds.length) {
        const ready = await tx
          .select({ id: researchDocuments.id })
          .from(researchDocuments)
          .where(
            and(
              eq(researchDocuments.workspaceId, run.snapshot.workspaceId),
              eq(researchDocuments.status, "ready"),
              inArray(researchDocuments.id, documentIds),
            ),
          );
        if (ready.length !== new Set(documentIds).size) {
          throw new Error("RESEARCH_DOCUMENT_NOT_READY");
        }
      }
      await tx.insert(productResearchRuns).values(toRunRow(run));
      if (documentIds.length) {
        await tx.insert(productResearchRunDocuments).values(
          documentIds.map((documentId) => ({
            workspaceId: run.snapshot.workspaceId,
            runId: run.snapshot.id,
            documentId,
          })),
        );
      }
    });
  }

  async findById(workspaceId: string, runId: string): Promise<ProductResearchRun | null> {
    const rows = await this.db
      .select()
      .from(productResearchRuns)
      .where(and(eq(productResearchRuns.workspaceId, workspaceId), eq(productResearchRuns.id, runId)))
      .limit(1);
    const row = rows[0];
    return row ? ProductResearchRun.restore(toRunSnapshot(row)) : null;
  }

  async listRecent(workspaceId: string, limit: number): Promise<readonly ProductResearchRun[]> {
    const rows = await this.db
      .select()
      .from(productResearchRuns)
      .where(eq(productResearchRuns.workspaceId, workspaceId))
      .orderBy(
        desc(productResearchRuns.updatedAt),
        desc(productResearchRuns.createdAt),
        desc(productResearchRuns.id),
      )
      .limit(limit);
    return rows.map((row) => ProductResearchRun.restore(toRunSnapshot(row)));
  }

  async findCompletedCheckpoint(
    workspaceId: string,
    runId: string,
    stage: ResearchStage,
  ): Promise<ResearchCheckpoint | null> {
    const rows = await this.db
      .select()
      .from(researchStageRuns)
      .where(
        and(
          eq(researchStageRuns.workspaceId, workspaceId),
          eq(researchStageRuns.runId, runId),
          eq(researchStageRuns.stage, stage),
          eq(researchStageRuns.workItemKey, "main"),
          eq(researchStageRuns.status, "completed"),
          eq(researchStageRuns.workItemKey, "main"),
        ),
      )
      .orderBy(desc(researchStageRuns.attempt))
      .limit(1);
    return rows[0] ? toCheckpoint(rows[0]) : null;
  }

  async listCompletedCheckpoints(
    workspaceId: string,
    runId: string,
  ): Promise<readonly ResearchCheckpoint[]> {
    const rows = await this.db
      .select()
      .from(researchStageRuns)
      .where(
        and(
          eq(researchStageRuns.workspaceId, workspaceId),
          eq(researchStageRuns.runId, runId),
          eq(researchStageRuns.status, "completed"),
        ),
      )
      .orderBy(researchStageRuns.startedAt);
    return rows.map(toCheckpoint);
  }

  async nextStageAttempt(
    workspaceId: string,
    runId: string,
    stage: ResearchStage,
    workItemKey = "main",
  ): Promise<number> {
    const rows = await this.db
      .select({ attempt: researchStageRuns.attempt })
      .from(researchStageRuns)
      .where(
        and(
          eq(researchStageRuns.workspaceId, workspaceId),
          eq(researchStageRuns.runId, runId),
          eq(researchStageRuns.stage, stage),
          eq(researchStageRuns.workItemKey, workItemKey),
        ),
      )
      .orderBy(desc(researchStageRuns.attempt))
      .limit(1);
    return (rows[0]?.attempt ?? 0) + 1;
  }

  async listFanoutCheckpoints(
    workspaceId: string,
    runId: string,
    stage: "market_investigation",
  ): Promise<readonly ResearchCheckpoint[]> {
    const rows = await this.db
      .select()
      .from(researchStageRuns)
      .where(
        and(
          eq(researchStageRuns.workspaceId, workspaceId),
          eq(researchStageRuns.runId, runId),
          eq(researchStageRuns.stage, stage),
          ne(researchStageRuns.workItemKey, "main"),
          eq(researchStageRuns.status, "completed"),
        ),
      )
      .orderBy(asc(researchStageRuns.startedAt));
    return rows.map(toCheckpoint);
  }

  async commitRunTransition(
    run: ProductResearchRun,
    job: NewJob | null,
    events: readonly ProductResearchEvent[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await updateRun(tx, run);
      if (job) await insertJob(tx, job);
      await insertEvents(tx, events);
    });
  }

  async commitStageStarted(
    run: ProductResearchRun,
    checkpoint: ResearchCheckpoint,
    events: readonly ProductResearchEvent[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await updateRun(tx, run);
      await tx
        .update(researchStageRuns)
        .set({
          status: "failed",
          errorCode: "SUPERSEDED_BY_RETRY",
          completedAt: checkpoint.startedAt,
        })
        .where(
          and(
            eq(researchStageRuns.workspaceId, checkpoint.workspaceId),
            eq(researchStageRuns.runId, checkpoint.runId),
            eq(researchStageRuns.stage, checkpoint.stage),
            eq(researchStageRuns.workItemKey, checkpoint.workItemKey ?? "main"),
            eq(researchStageRuns.status, "running"),
            eq(researchStageRuns.review, "machine"),
            ne(researchStageRuns.id, checkpoint.id),
          ),
        );
      await tx.insert(researchStageRuns).values(toCheckpointRow(checkpoint)).onConflictDoNothing();
      if ((checkpoint.workItemKey ?? "main") !== "main") {
        await tx
          .update(researchWorkItems)
          .set({ status: "running", updatedAt: checkpoint.startedAt })
          .where(
            and(
              eq(researchWorkItems.workspaceId, checkpoint.workspaceId),
              eq(researchWorkItems.runId, checkpoint.runId),
              eq(researchWorkItems.workItemKey, checkpoint.workItemKey ?? "main"),
            ),
          );
      }
      await insertEvents(tx, events);
    });
  }

  async commitStageCompleted(input: {
    run: ProductResearchRun;
    checkpoint: ResearchCheckpoint;
    aiRun: ResearchAIRun;
    nextJob: NewJob | null;
    events: readonly ProductResearchEvent[];
    fanout?: {
      readonly items: readonly ResearchWorkItem[];
      readonly jobs: readonly NewJob[];
    };
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await updateRun(tx, input.run);
      const updated = await tx
        .update(researchStageRuns)
        .set(toCheckpointUpdate(input.checkpoint))
        .where(
          and(
            eq(researchStageRuns.workspaceId, input.checkpoint.workspaceId),
            eq(researchStageRuns.id, input.checkpoint.id),
            ne(researchStageRuns.review, "human_reviewed"),
          ),
        )
        .returning({ id: researchStageRuns.id });
      if (updated.length !== 1) throw new Error("CHECKPOINT_HUMAN_REVIEW_LOCKED");
      await tx.insert(aiRuns).values(toAIRunRow(input.aiRun));
      await projectResearchStage({
        executor: tx,
        workspaceId: input.checkpoint.workspaceId,
        runId: input.checkpoint.runId,
        stage: input.checkpoint.stage,
        output: input.checkpoint.output,
      });
      if (
        input.run.snapshot.brief.researchVersion === 3 &&
        input.checkpoint.stage === "objective_ranking"
      ) {
        await autoCreateV3ProspectingPlans(tx, {
          workspaceId: input.checkpoint.workspaceId,
          runId: input.checkpoint.runId,
          publishedAt: input.checkpoint.completedAt ?? new Date(),
        });
      }
      if (input.fanout) {
        await tx
          .insert(researchWorkItems)
          .values(input.fanout.items.map(toWorkItemRow))
          .onConflictDoUpdate({
            target: [
              researchWorkItems.workspaceId,
              researchWorkItems.runId,
              researchWorkItems.stage,
              researchWorkItems.workItemKey,
            ],
            set: { status: "pending", errorCode: null, updatedAt: new Date() },
          });
        for (const job of input.fanout.jobs) await insertJob(tx, job);
      }
      if (input.nextJob) await insertJob(tx, input.nextJob);
      await insertEvents(tx, input.events);
    });
  }

  async commitFanoutItemCompleted(input: {
    checkpoint: ResearchCheckpoint;
    aiRun: ResearchAIRun;
    finalizerJob: NewJob;
  }): Promise<void> {
    await this.#commitFanoutTerminal({ ...input, status: "completed", errorCode: null });
  }

  async commitFanoutItemFailed(input: {
    checkpoint: ResearchCheckpoint;
    finalizerJob: NewJob;
  }): Promise<void> {
    await this.#commitFanoutTerminal({
      ...input,
      aiRun: null,
      status: "failed",
      errorCode: input.checkpoint.errorCode ?? "FANOUT_ITEM_FAILED",
    });
  }

  async #commitFanoutTerminal(input: {
    checkpoint: ResearchCheckpoint;
    aiRun: ResearchAIRun | null;
    finalizerJob: NewJob;
    status: "completed" | "failed";
    errorCode: string | null;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(researchStageRuns)
        .set(toCheckpointUpdate(input.checkpoint))
        .where(
          and(
            eq(researchStageRuns.workspaceId, input.checkpoint.workspaceId),
            eq(researchStageRuns.id, input.checkpoint.id),
            ne(researchStageRuns.review, "human_reviewed"),
          ),
        )
        .returning({ id: researchStageRuns.id });
      if (updated.length !== 1) throw new Error("CHECKPOINT_HUMAN_REVIEW_LOCKED");
      if (input.aiRun) await tx.insert(aiRuns).values(toAIRunRow(input.aiRun));
      await tx
        .update(researchWorkItems)
        .set({ status: input.status, errorCode: input.errorCode, updatedAt: new Date() })
        .where(
          and(
            eq(researchWorkItems.workspaceId, input.checkpoint.workspaceId),
            eq(researchWorkItems.runId, input.checkpoint.runId),
            eq(researchWorkItems.workItemKey, input.checkpoint.workItemKey ?? "main"),
          ),
        );
      const remaining = await tx
        .select({ id: researchWorkItems.id })
        .from(researchWorkItems)
        .where(
          and(
            eq(researchWorkItems.workspaceId, input.checkpoint.workspaceId),
            eq(researchWorkItems.runId, input.checkpoint.runId),
            eq(researchWorkItems.stage, "market_investigation"),
            notInArray(researchWorkItems.status, ["completed", "failed"]),
          ),
        )
        .limit(1);
      if (remaining.length === 0) await insertJob(tx, input.finalizerJob);
    });
  }

  async commitStageFailed(
    run: ProductResearchRun,
    checkpoint: ResearchCheckpoint,
    events: readonly ProductResearchEvent[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await updateRun(tx, run);
      const updated = await tx
        .update(researchStageRuns)
        .set(toCheckpointUpdate(checkpoint))
        .where(
          and(
            eq(researchStageRuns.workspaceId, checkpoint.workspaceId),
            eq(researchStageRuns.id, checkpoint.id),
            ne(researchStageRuns.review, "human_reviewed"),
          ),
        )
        .returning({ id: researchStageRuns.id });
      if (updated.length !== 1) throw new Error("CHECKPOINT_HUMAN_REVIEW_LOCKED");
      await insertEvents(tx, events);
    });
  }

  async commitResearchMore(input: {
    run: ProductResearchRun;
    fromStage: ResearchStage;
    reason: string;
    job: NewJob;
    events: readonly ProductResearchEvent[];
  }): Promise<void> {
    const workflowStages = input.run.workflowStages();
    const stagesToInvalidate = workflowStages.slice(workflowStages.indexOf(input.fromStage));
    await this.db.transaction(async (tx) => {
      await tx
        .delete(researchWorkItems)
        .where(
          and(
            eq(researchWorkItems.workspaceId, input.run.snapshot.workspaceId),
            eq(researchWorkItems.runId, input.run.snapshot.id),
            inArray(researchWorkItems.stage, stagesToInvalidate),
          ),
        );
      await tx
        .update(researchStageRuns)
        .set({ status: "invalidated" })
        .where(
          and(
            eq(researchStageRuns.workspaceId, input.run.snapshot.workspaceId),
            eq(researchStageRuns.runId, input.run.snapshot.id),
            eq(researchStageRuns.status, "completed"),
            eq(researchStageRuns.review, "machine"),
            inArray(researchStageRuns.stage, stagesToInvalidate),
          ),
        );
      await updateRun(tx, input.run);
      await insertJob(tx, input.job);
      await insertEvents(tx, input.events);
    });
  }

  async reviewIcpProposal(input: {
    workspaceId: string;
    runId: string;
    proposalId: string;
    userId: string;
    decision: "approved" | "rejected";
    reason: string | null;
    reviewedAt: Date;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (input.decision === "approved") {
        await tx
          .update(icpProposals)
          .set({
            reviewStatus: "rejected",
            reviewReason: "Another proposal was approved",
            reviewedBy: input.userId,
            reviewedAt: input.reviewedAt,
            updatedAt: input.reviewedAt,
          })
          .where(
            and(
              eq(icpProposals.workspaceId, input.workspaceId),
              eq(icpProposals.runId, input.runId),
              ne(icpProposals.id, input.proposalId),
            ),
          );
      }
      const rows = await tx
        .update(icpProposals)
        .set({
          reviewStatus: input.decision,
          reviewReason: input.reason,
          reviewedBy: input.userId,
          reviewedAt: input.reviewedAt,
          updatedAt: input.reviewedAt,
        })
        .where(
          and(
            eq(icpProposals.workspaceId, input.workspaceId),
            eq(icpProposals.runId, input.runId),
            eq(icpProposals.id, input.proposalId),
          ),
        )
        .returning({ id: icpProposals.id });
      if (rows.length !== 1) throw new Error("ICP_PROPOSAL_NOT_FOUND");
    });
  }

  async reviewFinding(input: {
    workspaceId: string;
    runId: string;
    findingId: string;
    userId: string;
    decision: "confirmed" | "corrected" | "rejected";
    statement: string | null;
    confidence: number | null;
    reason: string | null;
    reviewedAt: Date;
  }) {
    const rows = await this.db
      .update(researchFindings)
      .set({
        reviewStatus: input.decision,
        reviewReason: input.reason,
        reviewedBy: input.userId,
        reviewedAt: input.reviewedAt,
        humanEdited: true,
        updatedAt: input.reviewedAt,
        ...(input.statement !== null ? { statement: input.statement } : {}),
        ...(input.confidence !== null ? { confidence: String(input.confidence) } : {}),
      })
      .where(
        and(
          eq(researchFindings.workspaceId, input.workspaceId),
          eq(researchFindings.runId, input.runId),
          eq(researchFindings.id, input.findingId),
        ),
      )
      .returning();
    if (rows.length !== 1) throw new Error("RESEARCH_FINDING_NOT_FOUND");
    return rows[0]!;
  }

  async correctIcpProposal(input: {
    workspaceId: string;
    runId: string;
    proposalId: string;
    fields: {
      name?: string;
      criteria?: unknown;
      buyingCommittee?: unknown;
      problems?: unknown;
      signals?: unknown;
      exclusions?: unknown;
      unknowns?: unknown;
    };
    updatedAt: Date;
  }) {
    const rows = await this.db
      .update(icpProposals)
      .set({
        ...(input.fields.name !== undefined ? { name: input.fields.name } : {}),
        ...(input.fields.criteria !== undefined ? { criteria: input.fields.criteria } : {}),
        ...(input.fields.buyingCommittee !== undefined
          ? { buyingCommittee: input.fields.buyingCommittee }
          : {}),
        ...(input.fields.problems !== undefined ? { problems: input.fields.problems } : {}),
        ...(input.fields.signals !== undefined ? { signals: input.fields.signals } : {}),
        ...(input.fields.exclusions !== undefined
          ? { exclusions: input.fields.exclusions }
          : {}),
        ...(input.fields.unknowns !== undefined ? { unknowns: input.fields.unknowns } : {}),
        humanEdited: true,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(icpProposals.workspaceId, input.workspaceId),
          eq(icpProposals.runId, input.runId),
          eq(icpProposals.id, input.proposalId),
        ),
      )
      .returning();
    if (rows.length !== 1) throw new Error("ICP_PROPOSAL_NOT_FOUND");
    return rows[0]!;
  }

  async publishIcpVersion(input: {
    id: string;
    workspaceId: string;
    runId: string;
    proposalId: string;
    userId: string;
    publishedAt: Date;
  }) {
    return this.db.transaction(async (tx) => {
      const proposals = await tx
        .select()
        .from(icpProposals)
        .where(
          and(
            eq(icpProposals.workspaceId, input.workspaceId),
            eq(icpProposals.runId, input.runId),
            eq(icpProposals.id, input.proposalId),
          ),
        )
        .limit(1);
      const proposal = proposals[0];
      if (!proposal) throw new Error("ICP_PROPOSAL_NOT_FOUND");
      if (proposal.reviewStatus !== "approved") {
        throw new Error("ICP_PROPOSAL_NOT_APPROVED");
      }
      const reviewCheckpoints = await tx
        .select({ output: researchStageRuns.output })
        .from(researchStageRuns)
        .where(
          and(
            eq(researchStageRuns.workspaceId, input.workspaceId),
            eq(researchStageRuns.runId, input.runId),
            eq(researchStageRuns.stage, "evidence_review"),
            eq(researchStageRuns.status, "completed"),
          ),
        )
        .orderBy(desc(researchStageRuns.startedAt))
        .limit(1);
      const reviewOutput = reviewCheckpoints[0]?.output;
      const unresolvedContradictions =
        reviewOutput &&
        typeof reviewOutput === "object" &&
        "unresolvedContradictions" in reviewOutput &&
        Array.isArray(reviewOutput.unresolvedContradictions)
          ? reviewOutput.unresolvedContradictions
          : [];
      // An unresolved contradiction blocks the finding from the published ICP.
      const blocked = await tx
        .select({
          findingId: researchFindings.id,
          statement: researchFindings.statement,
          reason: researchFindings.reviewReason,
        })
        .from(researchFindings)
        .where(
          and(
            eq(researchFindings.workspaceId, input.workspaceId),
            eq(researchFindings.runId, input.runId),
            eq(researchFindings.reviewStatus, "rejected"),
          ),
        );
      const current = await tx
        .select({ version: icpVersions.version })
        .from(icpVersions)
        .where(eq(icpVersions.workspaceId, input.workspaceId))
        .orderBy(desc(icpVersions.version))
        .limit(1);
      const version = (current[0]?.version ?? 0) + 1;
      let inserted;
      try {
        inserted = await tx
          .insert(icpVersions)
          .values({
            id: input.id,
            workspaceId: input.workspaceId,
            runId: input.runId,
            proposalId: input.proposalId,
            version,
            name: proposal.name,
            confidence: proposal.confidence,
            criteria: proposal.criteria,
            buyingCommittee: proposal.buyingCommittee,
            problems: proposal.problems,
            signals: proposal.signals,
            exclusions: proposal.exclusions,
            unknowns: proposal.unknowns,
            unresolvedContradictions,
            blockedFindings: blocked,
            publishedBy: input.userId,
            publishedAt: input.publishedAt,
          })
          .returning();
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new Error("ICP_VERSION_ALREADY_PUBLISHED");
        }
        throw error;
      }
      if (inserted.length !== 1) throw new Error("ICP_VERSION_PUBLISH_FAILED");
      await insertEvents(tx, [
        {
          type: "ICPVersionPublished",
          runId: input.runId,
          workspaceId: input.workspaceId,
          versionId: input.id,
          proposalId: input.proposalId,
          version,
        },
      ]);
      return inserted[0]!;
    });
  }

  async listEvidence(input: {
    workspaceId: string;
    runId: string;
    after: { createdAt: Date; id: string } | null;
    limit: number;
  }): Promise<readonly MarketEvidenceView[]> {
    const afterCondition = input.after
      ? or(
          gt(marketEvidence.createdAt, input.after.createdAt),
          and(
            eq(marketEvidence.createdAt, input.after.createdAt),
            gt(marketEvidence.id, input.after.id),
          ),
        )
      : undefined;
    const rows = await this.db
      .select()
      .from(marketEvidence)
      .where(
        and(
          eq(marketEvidence.workspaceId, input.workspaceId),
          eq(marketEvidence.runId, input.runId),
          afterCondition,
        ),
      )
      .orderBy(asc(marketEvidence.createdAt), asc(marketEvidence.id))
      .limit(input.limit);
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      runId: row.runId,
      sourceType: row.sourceType as MarketEvidenceView["sourceType"],
      url: row.url,
      title: row.title,
      excerpt: row.excerpt,
      contentHash: row.contentHash,
      observedAt: row.observedAt,
      createdAt: row.createdAt,
    }));
  }

  async listStageRuns(
    workspaceId: string,
    runId: string,
  ): Promise<readonly ResearchStageRunView[]> {
    const rows = await this.db
      .select()
      .from(researchStageRuns)
      .where(
        and(
          eq(researchStageRuns.workspaceId, workspaceId),
          eq(researchStageRuns.runId, runId),
        ),
      )
      .orderBy(asc(researchStageRuns.startedAt), asc(researchStageRuns.attempt));
    return rows.map((row) => ({
      id: row.id,
      stage: row.stage,
      attempt: row.attempt,
      status: row.status,
      review: row.review,
      errorCode: row.errorCode,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    }));
  }

  async getReport(workspaceId: string, runId: string) {
    const [runs, stages, evidence, competitors, findings, proposals, versions] = await Promise.all([
      this.db
        .select({ status: productResearchRuns.status, brief: productResearchRuns.brief })
        .from(productResearchRuns)
        .where(
          and(
            eq(productResearchRuns.workspaceId, workspaceId),
            eq(productResearchRuns.id, runId),
          ),
        )
        .limit(1),
      this.db
        .select({ stage: researchStageRuns.stage, output: researchStageRuns.output })
        .from(researchStageRuns)
        .where(
          and(
            eq(researchStageRuns.workspaceId, workspaceId),
            eq(researchStageRuns.runId, runId),
            eq(researchStageRuns.status, "completed"),
          ),
        )
        .orderBy(asc(researchStageRuns.startedAt)),
      this.listEvidence({ workspaceId, runId, after: null, limit: 1_000 }),
      this.db
        .select()
        .from(competitorCandidates)
        .where(
          and(
            eq(competitorCandidates.workspaceId, workspaceId),
            eq(competitorCandidates.runId, runId),
          ),
        ),
      this.db
        .select()
        .from(researchFindings)
        .where(
          and(
            eq(researchFindings.workspaceId, workspaceId),
            eq(researchFindings.runId, runId),
          ),
        ),
      this.db
        .select()
        .from(icpProposals)
        .where(and(eq(icpProposals.workspaceId, workspaceId), eq(icpProposals.runId, runId)))
        .orderBy(asc(icpProposals.rank)),
      this.db
        .select()
        .from(icpVersions)
        .where(and(eq(icpVersions.workspaceId, workspaceId), eq(icpVersions.runId, runId)))
        .orderBy(asc(icpVersions.publishedAt)),
    ]);
    const findingEvidenceLinks = findings.length
      ? await this.db
          .select({
            findingId: researchFindingEvidence.findingId,
            evidenceId: researchFindingEvidence.evidenceId,
          })
          .from(researchFindingEvidence)
          .where(eq(researchFindingEvidence.workspaceId, workspaceId))
      : [];
    const evidenceByFinding = new Map<string, string[]>();
    for (const link of findingEvidenceLinks) {
      const list = evidenceByFinding.get(link.findingId) ?? [];
      list.push(link.evidenceId);
      evidenceByFinding.set(link.findingId, list);
    }
    const stageOutputs = Object.fromEntries(stages.map((stage) => [stage.stage, stage.output]));
    const run = runs[0];
    const brief = run?.brief as { researchVersion?: unknown } | undefined;
    const v3Ranking = resolveV3ReportRanking(
      stageOutputs,
      run?.status === "partial" && brief?.researchVersion === 3,
    );
    const reportStageOutputs = v3Ranking
      ? { ...stageOutputs, objective_ranking: v3Ranking }
      : stageOutputs;
    const v3Proposals = projectV3ReportProposals(v3Ranking);
    return {
      stageOutputs: reportStageOutputs,
      evidence,
      competitors,
      findings: findings.map((finding) => ({
        ...finding,
        evidenceIds: evidenceByFinding.get(finding.id) ?? [],
      })),
      proposals: v3Proposals ?? proposals,
      versions,
    };
  }
}

function toAIRunRow(aiRun: ResearchAIRun): typeof aiRuns.$inferInsert {
  return {
    id: aiRun.id,
    workspaceId: aiRun.workspaceId,
    productResearchRunId: aiRun.productResearchRunId,
    researchStageRunId: aiRun.researchStageRunId,
    purpose: aiRun.purpose,
    provider: aiRun.provider,
    model: aiRun.model,
    promptVersion: aiRun.promptVersion,
    inputHash: aiRun.inputHash,
    parameters: aiRun.parameters,
    output: aiRun.output,
    status: aiRun.status,
    cost: aiRun.cost === null ? null : String(aiRun.cost),
    latencyMs: aiRun.latencyMs,
    createdAt: aiRun.createdAt,
  };
}

function toRunRow(run: ProductResearchRun): typeof productResearchRuns.$inferInsert {
  const snapshot = run.snapshot;
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    brief: snapshot.brief,
    status: snapshot.status,
    activeStage: snapshot.activeStage,
    completedStages: snapshot.completedStages,
    version: snapshot.version,
    executionStartedAt: snapshot.executionStartedAt,
    deadlineAt: snapshot.deadlineAt,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function toRunSnapshot(row: typeof productResearchRuns.$inferSelect): ProductResearchRunSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    brief: row.brief as ProductResearchBrief,
    status: row.status,
    activeStage: row.activeStage,
    completedStages: row.completedStages as ResearchStage[],
    version: row.version,
    executionStartedAt: row.executionStartedAt,
    deadlineAt: row.deadlineAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCheckpoint(row: typeof researchStageRuns.$inferSelect): ResearchCheckpoint {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runId: row.runId,
    stage: row.stage,
    workItemKey: row.workItemKey,
    attempt: row.attempt,
    status: row.status,
    review: row.review,
    inputHash: row.inputHash,
    outputHash: row.outputHash,
    output: row.output,
    errorCode: row.errorCode,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function toCheckpointRow(checkpoint: ResearchCheckpoint): typeof researchStageRuns.$inferInsert {
  return {
    id: checkpoint.id,
    workspaceId: checkpoint.workspaceId,
    runId: checkpoint.runId,
    stage: checkpoint.stage,
    workItemKey: checkpoint.workItemKey ?? "main",
    attempt: checkpoint.attempt,
    status: checkpoint.status,
    review: checkpoint.review,
    inputHash: checkpoint.inputHash,
    outputHash: checkpoint.outputHash,
    output: checkpoint.output,
    errorCode: checkpoint.errorCode,
    startedAt: checkpoint.startedAt,
    completedAt: checkpoint.completedAt,
  };
}

function toWorkItemRow(item: ResearchWorkItem): typeof researchWorkItems.$inferInsert {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    runId: item.runId,
    stage: item.stage,
    workItemKey: item.workItemKey,
    subjectArtifactKey: item.subjectArtifactKey,
    ordinal: item.ordinal,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toCheckpointUpdate(checkpoint: ResearchCheckpoint) {
  return {
    status: checkpoint.status,
    review: checkpoint.review,
    outputHash: checkpoint.outputHash,
    output: checkpoint.output,
    errorCode: checkpoint.errorCode,
    completedAt: checkpoint.completedAt,
  };
}

async function autoCreateV3ProspectingPlans(
  executor: ReadWriteExecutor,
  input: { workspaceId: string; runId: string; publishedAt: Date },
): Promise<void> {
  const proposals = await executor
    .select()
    .from(icpProposals)
    .where(
      and(
        eq(icpProposals.workspaceId, input.workspaceId),
        eq(icpProposals.runId, input.runId),
      ),
    )
    .orderBy(asc(icpProposals.rank));
  if (!proposals.length) return;

  const [current] = await executor
    .select({ version: icpVersions.version })
    .from(icpVersions)
    .where(eq(icpVersions.workspaceId, input.workspaceId))
    .orderBy(desc(icpVersions.version))
    .limit(1);
  const [review] = await executor
    .select({ output: researchStageRuns.output })
    .from(researchStageRuns)
    .where(
      and(
        eq(researchStageRuns.workspaceId, input.workspaceId),
        eq(researchStageRuns.runId, input.runId),
        eq(researchStageRuns.stage, "adversarial_review"),
        eq(researchStageRuns.status, "completed"),
      ),
    )
    .orderBy(desc(researchStageRuns.startedAt))
    .limit(1);
  const reviewOutput = review?.output;
  const unresolvedContradictions =
    reviewOutput &&
    typeof reviewOutput === "object" &&
    "unresolvedContradictions" in reviewOutput &&
    Array.isArray(reviewOutput.unresolvedContradictions)
      ? reviewOutput.unresolvedContradictions
      : [];
  let nextVersion = (current?.version ?? 0) + 1;

  for (const proposal of proposals) {
    const [existingVersion] = await executor
      .select()
      .from(icpVersions)
      .where(
        and(
          eq(icpVersions.workspaceId, input.workspaceId),
          eq(icpVersions.proposalId, proposal.id),
        ),
      )
      .limit(1);

    let versionRow = existingVersion;
    if (!versionRow) {
      const versionId = crypto.randomUUID();
      const [created] = await executor
        .insert(icpVersions)
        .values({
          id: versionId,
          workspaceId: input.workspaceId,
          runId: input.runId,
          proposalId: proposal.id,
          version: nextVersion,
          name: proposal.name,
          confidence: proposal.confidence,
          criteria: proposal.criteria,
          buyingCommittee: proposal.buyingCommittee,
          problems: proposal.problems,
          signals: proposal.signals,
          exclusions: proposal.exclusions,
          unknowns: proposal.unknowns,
          unresolvedContradictions,
          blockedFindings: [],
          publishedBy: null,
          publishedAt: input.publishedAt,
        })
        .returning();
      versionRow = created;
      await insertEvents(executor, [
        {
          type: "ICPVersionPublished",
          runId: input.runId,
          workspaceId: input.workspaceId,
          versionId,
          proposalId: proposal.id,
          version: nextVersion,
        },
      ]);
      nextVersion += 1;
    }
    if (!versionRow) continue;

    const [existingPlan] = await executor
      .select({ id: prospectingPlans.id })
      .from(prospectingPlans)
      .where(
        and(
          eq(prospectingPlans.workspaceId, input.workspaceId),
          eq(prospectingPlans.icpVersionId, versionRow.id),
        ),
      )
      .limit(1);
    if (existingPlan) continue;

    const planId = crypto.randomUUID();
    await executor.insert(prospectingPlans).values({
      id: planId,
      workspaceId: input.workspaceId,
      icpVersionId: versionRow.id,
      name: `Plan — ${proposal.name}`.slice(0, 300),
      status: "assessing",
      createdAt: input.publishedAt,
      updatedAt: input.publishedAt,
    });
    for (const channel of PROSPECTING_CHANNELS) {
      const assessmentId = crypto.randomUUID();
      await executor.insert(channelAssessments).values({
        id: assessmentId,
        workspaceId: input.workspaceId,
        planId,
        channel,
        status: "pending",
        createdAt: input.publishedAt,
        updatedAt: input.publishedAt,
      });
      await insertJob(executor, {
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        type: CHANNEL_ASSESSMENT_JOB_TYPE,
        payload: { workspaceId: input.workspaceId, assessmentId },
        idempotencyKey: `${assessmentId}:initial`,
        correlationId: `prospecting-plan:${planId}`,
        maxAttempts: 3,
        availableAt: input.publishedAt,
      });
    }
    await executor.insert(outboxEvents).values({
      workspaceId: input.workspaceId,
      aggregateType: "ProspectingPlan",
      aggregateId: planId,
      eventType: "ProspectingPlanAssessmentStarted",
      payload: {
        planId,
        icpVersionId: versionRow.id,
        channels: PROSPECTING_CHANNELS,
      },
    });
  }
}

async function updateRun(executor: DbExecutor, run: ProductResearchRun): Promise<void> {
  const snapshot = run.snapshot;
  await executor
    .update(productResearchRuns)
    .set({
      status: snapshot.status,
      activeStage: snapshot.activeStage,
      completedStages: snapshot.completedStages,
      version: snapshot.version,
      executionStartedAt: snapshot.executionStartedAt,
      deadlineAt: snapshot.deadlineAt,
      updatedAt: snapshot.updatedAt,
    })
    .where(
      and(
        eq(productResearchRuns.workspaceId, snapshot.workspaceId),
        eq(productResearchRuns.id, snapshot.id),
      ),
    );
}

async function insertJob(executor: DbExecutor, job: NewJob): Promise<void> {
  await executor
    .insert(jobs)
    .values({
      id: job.id,
      workspaceId: job.workspaceId,
      type: job.type,
      payload: job.payload,
      idempotencyKey: job.idempotencyKey,
      correlationId: job.correlationId,
      maxAttempts: job.maxAttempts,
      availableAt: job.availableAt,
    })
    .onConflictDoNothing({
      target: [jobs.workspaceId, jobs.type, jobs.idempotencyKey],
    });
}

async function insertEvents(executor: DbExecutor, events: readonly ProductResearchEvent[]): Promise<void> {
  if (!events.length) return;
  await executor.insert(outboxEvents).values(
    events.map((event) => ({
      workspaceId: event.workspaceId,
      aggregateType: "ProductResearchRun",
      aggregateId: event.runId,
      eventType: event.type,
      payload: event,
    })),
  );
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
