import {
  ProductResearchRun,
  type ProductResearchEvent,
  type ProductResearchRunSnapshot,
  type ResearchCheckpoint,
  type ResearchStage,
} from "@outbound/domain/gtm/product-research";
import type {
  DeferJobRequest,
  JobQueue,
  LeaseJobsRequest,
  LeasedJob,
  NewJob,
  QuarantineJobRequest,
  RetryJobRequest,
} from "@outbound/application/jobs/job-queue";
import type {
  ProductResearchRepository,
  ProductResearchViewRepository,
  MarketEvidenceView,
  ResearchStageRunView,
  ResearchAIRun,
  ResearchWorkItem,
  IcpVersionView,
} from "@outbound/application/gtm/product-research-ports";
import {
  projectV3ReportProposals,
  resolveV3ReportRanking,
} from "@outbound/application/gtm/v3-report-projection";

type StoredJob = Omit<NewJob, "availableAt"> & {
  availableAt: Date;
  status: "pending" | "running" | "retry" | "completed" | "dead_lettered";
  attempts: number;
  lockedBy: string | null;
  lockedUntil: Date | null;
  completedAt: Date | null;
  lastErrorCode: string | null;
};

export class InMemoryResearchBackend
  implements ProductResearchRepository, ProductResearchViewRepository, JobQueue
{
  readonly #runs = new Map<string, ProductResearchRunSnapshot>();
  readonly #checkpoints = new Map<string, ResearchCheckpoint>();
  readonly #jobs = new Map<string, StoredJob>();
  readonly #jobKeys = new Map<string, string>();
  readonly outbox: ProductResearchEvent[] = [];
  readonly aiRuns: ResearchAIRun[] = [];
  readonly #evidence: MarketEvidenceView[] = [];
  readonly #workItems = new Map<string, ResearchWorkItem & { errorCode?: string | null }>();
  readonly proposalReviews: Record<string, unknown>[] = [];

  async insert(run: ProductResearchRun): Promise<void> {
    const key = runKey(run.snapshot.workspaceId, run.snapshot.id);
    if (this.#runs.has(key)) throw new Error("PRODUCT_RESEARCH_RUN_ALREADY_EXISTS");
    this.#runs.set(key, clone(run.snapshot));
  }

  async findById(workspaceId: string, runId: string): Promise<ProductResearchRun | null> {
    const snapshot = this.#runs.get(runKey(workspaceId, runId));
    return snapshot ? ProductResearchRun.restore(clone(snapshot)) : null;
  }

  async listRecent(workspaceId: string, limit: number): Promise<readonly ProductResearchRun[]> {
    return [...this.#runs.values()]
      .filter((snapshot) => snapshot.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      )
      .slice(0, limit)
      .map((snapshot) => ProductResearchRun.restore(clone(snapshot)));
  }

  async findCompletedCheckpoint(
    workspaceId: string,
    runId: string,
    stage: ResearchStage,
  ): Promise<ResearchCheckpoint | null> {
    const matches = [...this.#checkpoints.values()]
      .filter(
        (checkpoint) =>
          checkpoint.workspaceId === workspaceId &&
          checkpoint.runId === runId &&
          checkpoint.stage === stage &&
          checkpoint.status === "completed" &&
          (checkpoint.workItemKey ?? "main") === "main",
      )
      .sort((left, right) => right.attempt - left.attempt);
    return matches[0] ? clone(matches[0]) : null;
  }

  async listCompletedCheckpoints(
    workspaceId: string,
    runId: string,
  ): Promise<readonly ResearchCheckpoint[]> {
    return [...this.#checkpoints.values()]
      .filter(
        (checkpoint) =>
          checkpoint.workspaceId === workspaceId &&
          checkpoint.runId === runId &&
          checkpoint.status === "completed" &&
          (checkpoint.workItemKey ?? "main") === "main",
      )
      .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime())
      .map(clone);
  }

  async nextStageAttempt(
    workspaceId: string,
    runId: string,
    stage: ResearchStage,
    workItemKey = "main",
  ): Promise<number> {
    const attempts = [...this.#checkpoints.values()]
      .filter(
        (checkpoint) =>
          checkpoint.workspaceId === workspaceId &&
          checkpoint.runId === runId &&
          checkpoint.stage === stage &&
          (checkpoint.workItemKey ?? "main") === workItemKey,
      )
      .map((checkpoint) => checkpoint.attempt);
    return Math.max(0, ...attempts) + 1;
  }

  async listFanoutCheckpoints(
    workspaceId: string,
    runId: string,
    stage: "market_investigation",
  ): Promise<readonly ResearchCheckpoint[]> {
    return [...this.#checkpoints.values()]
      .filter((checkpoint) =>
        checkpoint.workspaceId === workspaceId &&
        checkpoint.runId === runId &&
        checkpoint.stage === stage &&
        (checkpoint.workItemKey ?? "main") !== "main" &&
        checkpoint.status === "completed")
      .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime())
      .map(clone);
  }

  async commitRunTransition(
    run: ProductResearchRun,
    job: NewJob | null,
    events: readonly ProductResearchEvent[],
  ): Promise<void> {
    this.#saveRun(run);
    if (job) await this.enqueue(job);
    this.outbox.push(...events.map(clone));
  }

  async commitStageStarted(
    run: ProductResearchRun,
    checkpoint: ResearchCheckpoint,
    events: readonly ProductResearchEvent[],
  ): Promise<void> {
    this.#saveRun(run);
    for (const [id, previous] of this.#checkpoints) {
      if (
        previous.workspaceId === checkpoint.workspaceId &&
        previous.runId === checkpoint.runId &&
        previous.stage === checkpoint.stage &&
        (previous.workItemKey ?? "main") === (checkpoint.workItemKey ?? "main") &&
        previous.status === "running" &&
        previous.review === "machine" &&
        id !== checkpoint.id
      ) {
        this.#checkpoints.set(id, {
          ...previous,
          status: "failed",
          errorCode: "SUPERSEDED_BY_RETRY",
          completedAt: checkpoint.startedAt,
        });
      }
    }
    if (!this.#checkpoints.has(checkpoint.id)) this.#checkpoints.set(checkpoint.id, clone(checkpoint));
    if ((checkpoint.workItemKey ?? "main") !== "main") {
      const key = workItemStorageKey(
        checkpoint.workspaceId,
        checkpoint.runId,
        checkpoint.workItemKey ?? "main",
      );
      const item = this.#workItems.get(key);
      if (item) this.#workItems.set(key, { ...item, status: "running", updatedAt: checkpoint.startedAt });
    }
    this.outbox.push(...events.map(clone));
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
    const existing = this.#checkpoints.get(input.checkpoint.id);
    if (existing?.review === "human_reviewed") throw new Error("CHECKPOINT_HUMAN_REVIEW_LOCKED");
    this.#saveRun(input.run);
    this.#checkpoints.set(input.checkpoint.id, clone(input.checkpoint));
    this.aiRuns.push(clone(input.aiRun));
    if (
      input.run.snapshot.brief.researchVersion === 3 &&
      input.checkpoint.stage === "objective_ranking"
    ) {
      const [top] = projectV3ReportProposals(input.checkpoint.output) ?? [];
      const alreadyPublished = this.publishedVersions.some((candidate) => {
        const version = candidate as Record<string, unknown>;
        return version.workspaceId === input.checkpoint.workspaceId &&
          version.runId === input.checkpoint.runId;
      });
      if (top && !alreadyPublished) {
        const version = this.publishedVersions.length + 1;
        const versionId = crypto.randomUUID();
        const proposalId = String(top.id ?? crypto.randomUUID());
        this.publishedVersions.push(clone({
          id: versionId,
          workspaceId: input.checkpoint.workspaceId,
          runId: input.checkpoint.runId,
          proposalId,
          userId: null,
          version,
          name: top.name,
          confidence: top.confidence,
          criteria: top.criteria,
          buyingCommittee: top.buyingCommittee,
          problems: top.problems,
          signals: top.signals,
          exclusions: top.exclusions,
          unknowns: top.unknowns,
          unresolvedContradictions: [],
          blockedFindings: [],
          publishedAt: input.checkpoint.completedAt ?? new Date(),
        }));
        this.outbox.push({
          type: "ICPVersionPublished",
          runId: input.checkpoint.runId,
          workspaceId: input.checkpoint.workspaceId,
          icpId: proposalId,
          actorUserId: null,
          versionId,
          proposalId,
          version,
        });
      }
    }
    if (input.fanout) {
      for (const item of input.fanout.items) {
        this.#workItems.set(workItemStorageKey(item.workspaceId, item.runId, item.workItemKey), clone(item));
      }
      for (const job of input.fanout.jobs) await this.enqueue(job);
    }
    if (input.nextJob) await this.enqueue(input.nextJob);
    this.outbox.push(...input.events.map(clone));
  }

  async commitFanoutItemCompleted(input: {
    checkpoint: ResearchCheckpoint;
    aiRun: ResearchAIRun;
    finalizerJob: NewJob;
  }): Promise<void> {
    this.#checkpoints.set(input.checkpoint.id, clone(input.checkpoint));
    this.aiRuns.push(clone(input.aiRun));
    await this.#finishWorkItem(input.checkpoint, "completed", null, input.finalizerJob);
  }

  async commitFanoutItemFailed(input: {
    checkpoint: ResearchCheckpoint;
    finalizerJob: NewJob;
  }): Promise<void> {
    this.#checkpoints.set(input.checkpoint.id, clone(input.checkpoint));
    await this.#finishWorkItem(
      input.checkpoint,
      "failed",
      input.checkpoint.errorCode,
      input.finalizerJob,
    );
  }

  async #finishWorkItem(
    checkpoint: ResearchCheckpoint,
    status: "completed" | "failed",
    errorCode: string | null,
    finalizerJob: NewJob,
  ): Promise<void> {
    const key = workItemStorageKey(
      checkpoint.workspaceId,
      checkpoint.runId,
      checkpoint.workItemKey ?? "main",
    );
    const item = this.#workItems.get(key);
    if (!item) throw new Error("RESEARCH_WORK_ITEM_NOT_FOUND");
    this.#workItems.set(key, { ...item, status, errorCode, updatedAt: new Date() });
    const remaining = [...this.#workItems.values()].some((candidate) =>
      candidate.workspaceId === checkpoint.workspaceId &&
      candidate.runId === checkpoint.runId &&
      !["completed", "failed"].includes(candidate.status));
    if (!remaining) await this.enqueue(finalizerJob);
  }

  async commitStageFailed(
    run: ProductResearchRun,
    checkpoint: ResearchCheckpoint,
    events: readonly ProductResearchEvent[],
  ): Promise<void> {
    const existing = this.#checkpoints.get(checkpoint.id);
    if (existing?.review === "human_reviewed") throw new Error("CHECKPOINT_HUMAN_REVIEW_LOCKED");
    this.#saveRun(run);
    this.#checkpoints.set(checkpoint.id, clone(checkpoint));
    this.outbox.push(...events.map(clone));
  }

  async commitResearchMore(input: {
    run: ProductResearchRun;
    fromStage: ResearchStage;
    reason: string;
    job: NewJob;
    events: readonly ProductResearchEvent[];
  }): Promise<void> {
    const workflowStages = input.run.workflowStages();
    const fromIndex = workflowStages.indexOf(input.fromStage);
    for (const [key, item] of this.#workItems) {
      if (
        item.workspaceId === input.run.snapshot.workspaceId &&
        item.runId === input.run.snapshot.id &&
        workflowStages.indexOf(item.stage) >= fromIndex
      ) {
        this.#workItems.delete(key);
      }
    }
    for (const [id, checkpoint] of this.#checkpoints) {
      if (
        checkpoint.workspaceId === input.run.snapshot.workspaceId &&
        checkpoint.runId === input.run.snapshot.id &&
        checkpoint.review === "machine" &&
        checkpoint.status === "completed" &&
        workflowStages.indexOf(checkpoint.stage) >= fromIndex
      ) {
        this.#checkpoints.set(id, { ...checkpoint, status: "invalidated" });
      }
    }
    this.#saveRun(input.run);
    await this.enqueue(input.job);
    this.outbox.push(...input.events.map(clone));
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
    this.proposalReviews.push(clone(input));
  }

  readonly findingReviews: unknown[] = [];
  readonly proposalCorrections: unknown[] = [];
  readonly publishedVersions: Record<string, unknown>[] = [];

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
  }): Promise<unknown> {
    this.findingReviews.push(clone(input));
    return clone(input);
  }

  async correctIcpProposal(input: {
    workspaceId: string;
    runId: string;
    proposalId: string;
    fields: Record<string, unknown>;
    updatedAt: Date;
  }): Promise<unknown> {
    this.proposalCorrections.push(clone(input));
    return clone(input);
  }

  async publishIcpVersion(input: {
    id: string;
    icpId: string;
    workspaceId: string;
    runId: string;
    proposalId: string;
    userId: string;
    publishedAt: Date;
  }): Promise<IcpVersionView> {
    this.publishedVersions.push(clone(input));
    return {
      ...input,
      version: 1,
      name: "",
      confidence: "0",
      criteria: {}, buyingCommittee: {}, problems: {}, signals: {}, exclusions: {}, unknowns: {},
      unresolvedContradictions: [], blockedFindings: [], publishedBy: input.userId,
      createdAt: input.publishedAt,
    };
  }

  async enqueue(job: NewJob): Promise<{ inserted: boolean }> {
    const uniqueKey = `${job.workspaceId}:${job.type}:${job.idempotencyKey}`;
    if (this.#jobKeys.has(uniqueKey)) return { inserted: false };
    this.#jobKeys.set(uniqueKey, job.id);
    this.#jobs.set(job.id, {
      ...clone(job),
      status: "pending",
      attempts: 0,
      lockedBy: null,
      lockedUntil: null,
      completedAt: null,
      lastErrorCode: null,
    });
    return { inserted: true };
  }

  async lease(request: LeaseJobsRequest): Promise<readonly LeasedJob[]> {
    const lockedUntil = new Date(request.now.getTime() + request.leaseMs);
    const candidates = [...this.#jobs.values()]
      .filter(
        (job) =>
          request.types.includes(job.type) &&
          job.attempts < job.maxAttempts &&
          ((["pending", "retry"].includes(job.status) && job.availableAt <= request.now) ||
            (job.status === "running" && job.lockedUntil !== null && job.lockedUntil <= request.now)),
      )
      .sort((left, right) => left.availableAt.getTime() - right.availableAt.getTime())
      .slice(0, request.limit);

    return candidates.map((job) => {
      job.status = "running";
      job.attempts += 1;
      job.lockedBy = request.workerId;
      job.lockedUntil = lockedUntil;
      return toLeasedJob(job);
    });
  }

  async acknowledge(jobId: string, workerId: string, completedAt: Date): Promise<void> {
    const job = this.#jobs.get(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) throw new Error("JOB_LEASE_LOST");
    job.status = "completed";
    job.completedAt = completedAt;
    job.lockedBy = null;
    job.lockedUntil = null;
  }

  async renewLease(jobId: string, workerId: string, lockedUntil: Date): Promise<boolean> {
    const job = this.#jobs.get(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) return false;
    job.lockedUntil = lockedUntil;
    return true;
  }

  async retry(request: RetryJobRequest): Promise<"scheduled" | "dead_lettered"> {
    const job = this.#jobs.get(request.jobId);
    if (!job || job.status !== "running" || job.lockedBy !== request.workerId) {
      throw new Error("JOB_LEASE_LOST");
    }
    job.status = job.attempts >= job.maxAttempts ? "dead_lettered" : "retry";
    job.availableAt = request.availableAt;
    job.lockedBy = null;
    job.lockedUntil = null;
    job.lastErrorCode = request.errorCode;
    return job.status === "retry" ? "scheduled" : "dead_lettered";
  }

  async quarantine(request: QuarantineJobRequest): Promise<void> {
    const job = this.#jobs.get(request.jobId);
    if (!job || job.status !== "running" || job.lockedBy !== request.workerId) throw new Error("JOB_LEASE_LOST");
    job.status = "dead_lettered";
    job.completedAt = new Date();
    job.lockedBy = null;
    job.lockedUntil = null;
    job.lastErrorCode = request.errorCode;
  }

  async defer(request: DeferJobRequest): Promise<void> {
    const job = this.#jobs.get(request.jobId);
    if (!job || job.status !== "running" || job.lockedBy !== request.workerId) {
      throw new Error("JOB_LEASE_LOST");
    }
    job.status = "pending";
    job.attempts = Math.max(0, job.attempts - 1);
    job.availableAt = request.availableAt;
    job.lockedBy = null;
    job.lockedUntil = null;
    job.lastErrorCode = request.errorCode;
  }

  inspectJobs(): readonly StoredJob[] {
    return [...this.#jobs.values()].map(clone);
  }

  inspectRuns(): readonly ProductResearchRunSnapshot[] {
    return [...this.#runs.values()].map(clone);
  }

  inspectCheckpoints(): readonly ResearchCheckpoint[] {
    return [...this.#checkpoints.values()].map(clone);
  }

  seedEvidence(evidence: MarketEvidenceView): void {
    this.#evidence.push(clone(evidence));
  }

  markCheckpointHumanReviewed(runId: string, stage: ResearchStage): void {
    const entry = [...this.#checkpoints.entries()].find(
      ([, checkpoint]) =>
        checkpoint.runId === runId &&
        checkpoint.stage === stage &&
        checkpoint.status === "completed",
    );
    if (!entry) throw new Error("CHECKPOINT_NOT_FOUND");
    this.#checkpoints.set(entry[0], { ...entry[1], review: "human_reviewed" });
  }

  async listEvidence(input: {
    workspaceId: string;
    runId: string;
    after: { createdAt: Date; id: string } | null;
    limit: number;
  }): Promise<readonly MarketEvidenceView[]> {
    return this.#evidence
      .filter(
        (evidence) =>
          evidence.workspaceId === input.workspaceId &&
          evidence.runId === input.runId &&
          (!input.after ||
            evidence.createdAt > input.after.createdAt ||
            (evidence.createdAt.getTime() === input.after.createdAt.getTime() &&
              evidence.id > input.after.id)),
      )
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
      )
      .slice(0, input.limit)
      .map(clone);
  }

  async listStageRuns(
    workspaceId: string,
    runId: string,
  ): Promise<readonly ResearchStageRunView[]> {
    return [...this.#checkpoints.values()]
      .filter(
        (checkpoint) =>
          checkpoint.workspaceId === workspaceId && checkpoint.runId === runId,
      )
      .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime())
      .map((checkpoint) => ({
        id: checkpoint.id,
        stage: checkpoint.stage,
        attempt: checkpoint.attempt,
        status: checkpoint.status,
        review: checkpoint.review,
        errorCode: checkpoint.errorCode,
        startedAt: checkpoint.startedAt,
        completedAt: checkpoint.completedAt,
      }));
  }

  async getReport(workspaceId: string, runId: string) {
    const checkpoints = await this.listCompletedCheckpoints(workspaceId, runId);
    const stageOutputs = Object.fromEntries(checkpoints.map((item) => [item.stage, item.output]));
    const run = this.#runs.get(runKey(workspaceId, runId));
    const forcePartial = run?.status === "partial" && run.brief.researchVersion === 3;
    return {
      stageOutputs: (() => {
        const ranking = resolveV3ReportRanking(stageOutputs, forcePartial);
        return ranking ? { ...stageOutputs, objective_ranking: ranking } : stageOutputs;
      })(),
      evidence: await this.listEvidence({
        workspaceId,
        runId,
        after: null,
        limit: Number.MAX_SAFE_INTEGER,
      }),
      competitors: [],
      findings: [],
      versions: this.publishedVersions
        .filter((candidate) => {
          const version = candidate as Record<string, unknown>;
          return version.workspaceId === workspaceId && version.runId === runId;
        })
        .map(clone),
      proposals: projectV3ReportProposals(resolveV3ReportRanking(stageOutputs, forcePartial)) ?? [],
    };
  }

  #saveRun(run: ProductResearchRun): void {
    const key = runKey(run.snapshot.workspaceId, run.snapshot.id);
    if (!this.#runs.has(key)) throw new Error("PRODUCT_RESEARCH_RUN_NOT_FOUND");
    this.#runs.set(key, clone(run.snapshot));
  }
}

function runKey(workspaceId: string, runId: string): string {
  return `${workspaceId}:${runId}`;
}

function workItemStorageKey(workspaceId: string, runId: string, workItemKey: string): string {
  return `${workspaceId}:${runId}:${workItemKey}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function toLeasedJob(job: StoredJob): LeasedJob {
  if (!job.lockedBy || !job.lockedUntil) throw new Error("JOB_NOT_LEASED");
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    type: job.type,
    status: job.status,
    payload: clone(job.payload),
    idempotencyKey: job.idempotencyKey,
    correlationId: job.correlationId,
    maxAttempts: job.maxAttempts,
    availableAt: job.availableAt,
    attempts: job.attempts,
    lockedBy: job.lockedBy,
    lockedUntil: job.lockedUntil,
  };
}
