import {
  ProductResearchRun,
  type ProductResearchEvent,
  type ProductResearchRunSnapshot,
  type ResearchCheckpoint,
  type ResearchStage,
} from "@outbound/domain/gtm/product-research";
import type {
  JobQueue,
  LeaseJobsRequest,
  LeasedJob,
  NewJob,
  RetryJobRequest,
} from "@outbound/application/jobs/job-queue";
import type {
  ProductResearchRepository,
  ResearchAIRun,
} from "@outbound/application/gtm/product-research-ports";

type StoredJob = Omit<NewJob, "availableAt"> & {
  availableAt: Date;
  status: "pending" | "running" | "retry" | "completed" | "dead_lettered";
  attempts: number;
  lockedBy: string | null;
  lockedUntil: Date | null;
  completedAt: Date | null;
  lastErrorCode: string | null;
};

export class InMemoryResearchBackend implements ProductResearchRepository, JobQueue {
  readonly #runs = new Map<string, ProductResearchRunSnapshot>();
  readonly #checkpoints = new Map<string, ResearchCheckpoint>();
  readonly #jobs = new Map<string, StoredJob>();
  readonly #jobKeys = new Map<string, string>();
  readonly outbox: ProductResearchEvent[] = [];
  readonly aiRuns: ResearchAIRun[] = [];

  async insert(run: ProductResearchRun): Promise<void> {
    const key = runKey(run.snapshot.workspaceId, run.snapshot.id);
    if (this.#runs.has(key)) throw new Error("PRODUCT_RESEARCH_RUN_ALREADY_EXISTS");
    this.#runs.set(key, clone(run.snapshot));
  }

  async findById(workspaceId: string, runId: string): Promise<ProductResearchRun | null> {
    const snapshot = this.#runs.get(runKey(workspaceId, runId));
    return snapshot ? ProductResearchRun.restore(clone(snapshot)) : null;
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
          checkpoint.status === "completed",
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
          checkpoint.status === "completed",
      )
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
    if (!this.#checkpoints.has(checkpoint.id)) this.#checkpoints.set(checkpoint.id, clone(checkpoint));
    this.outbox.push(...events.map(clone));
  }

  async commitStageCompleted(input: {
    run: ProductResearchRun;
    checkpoint: ResearchCheckpoint;
    aiRun: ResearchAIRun;
    nextJob: NewJob | null;
    events: readonly ProductResearchEvent[];
  }): Promise<void> {
    const existing = this.#checkpoints.get(input.checkpoint.id);
    if (existing?.review === "human_reviewed") throw new Error("CHECKPOINT_HUMAN_REVIEW_LOCKED");
    this.#saveRun(input.run);
    this.#checkpoints.set(input.checkpoint.id, clone(input.checkpoint));
    this.aiRuns.push(clone(input.aiRun));
    if (input.nextJob) await this.enqueue(input.nextJob);
    this.outbox.push(...input.events.map(clone));
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

  inspectJobs(): readonly StoredJob[] {
    return [...this.#jobs.values()].map(clone);
  }

  inspectCheckpoints(): readonly ResearchCheckpoint[] {
    return [...this.#checkpoints.values()].map(clone);
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function toLeasedJob(job: StoredJob): LeasedJob {
  if (!job.lockedBy || !job.lockedUntil) throw new Error("JOB_NOT_LEASED");
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    type: job.type,
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
