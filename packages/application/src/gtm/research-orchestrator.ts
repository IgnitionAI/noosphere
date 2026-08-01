import {
  type ProductResearchRun,
  type ResearchCheckpoint,
  type ResearchStage,
} from "@outbound/domain/gtm/product-research";
import {
  parseAgentInput,
  parseAgentExecutionResult,
  researchStageJobPayloadSchema,
} from "@outbound/contracts/product-research";
import type { LeasedJob, JobQueue, NewJob } from "@outbound/application/jobs/job-queue";
import {
  RetryableAgentError,
  TerminalAgentError,
  type ProductResearchRepository,
  type ResearchAgentExecutor,
} from "@outbound/application/gtm/product-research-ports";
import type { Clock, ContentHasher, IdGenerator } from "@outbound/application/shared/ports";

export type ResearchJobResult =
  | { readonly outcome: "completed"; readonly stage: ResearchStage; readonly nextStage: ResearchStage | null }
  | { readonly outcome: "already_completed"; readonly stage: ResearchStage }
  | { readonly outcome: "superseded"; readonly stage: ResearchStage }
  | { readonly outcome: "paused"; readonly stage: ResearchStage }
  | { readonly outcome: "retry_scheduled"; readonly stage: ResearchStage }
  | { readonly outcome: "failed"; readonly stage: ResearchStage };

export class ResearchOrchestrator {
  constructor(
    private readonly repository: ProductResearchRepository,
    private readonly queue: JobQueue,
    private readonly agents: ResearchAgentExecutor,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly hasher: ContentHasher,
  ) {}

  async process(job: LeasedJob): Promise<ResearchJobResult> {
    const result = await this.#process(job);
    console.info(
      JSON.stringify({
        event: "research_stage_job_processed",
        jobId: job.id,
        stage: result.stage,
        outcome: result.outcome,
      }),
    );
    return result;
  }

  async #process(job: LeasedJob): Promise<ResearchJobResult> {
    const payload = researchStageJobPayloadSchema.parse(job.payload);
    const run = await this.repository.findById(payload.workspaceId, payload.runId);
    if (!run) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      throw new TerminalAgentError("PRODUCT_RESEARCH_RUN_NOT_FOUND", `Run ${payload.runId} was not found`);
    }

    const completed = await this.repository.findCompletedCheckpoint(
      payload.workspaceId,
      payload.runId,
      payload.stage,
    );
    if (completed) {
      await this.#ensureNextJob(run, payload.stage, job.correlationId);
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return { outcome: "already_completed", stage: payload.stage };
    }

    // Jobs enqueued before a research-more invalidation are stale: the run now
    // expects an earlier stage. Acknowledge them instead of crashing the worker.
    const expectedStage = run.nextStage();
    if (payload.stage !== expectedStage) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return { outcome: "superseded", stage: payload.stage };
    }

    if (run.snapshot.status === "paused") {
      await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 60_000),
        errorCode: "RUN_PAUSED",
        errorMessage: "Research run is paused",
      });
      return { outcome: "paused", stage: payload.stage };
    }

    const previous = await this.repository.listCompletedCheckpoints(payload.workspaceId, payload.runId);
    const previousOutputs = Object.fromEntries(previous.map((checkpoint) => [checkpoint.stage, checkpoint.output]));
    const now = this.clock.now();
    run.beginStage(payload.stage, now);
    const attempt = await this.repository.nextStageAttempt(
      payload.workspaceId,
      payload.runId,
      payload.stage,
    );
    const checkpointId = this.ids.generate();
    const input = parseAgentInput(payload.stage, {
      runId: payload.runId,
      researchStageRunId: checkpointId,
      workspaceId: payload.workspaceId,
      stage: payload.stage,
      brief: run.snapshot.brief,
      previousOutputs,
      correlationId: job.correlationId,
    });
    let checkpoint: ResearchCheckpoint = {
      id: checkpointId,
      workspaceId: payload.workspaceId,
      runId: payload.runId,
      stage: payload.stage,
      attempt,
      status: "running",
      review: "machine",
      inputHash: await this.hasher.hash(input),
      outputHash: null,
      output: null,
      errorCode: null,
      startedAt: now,
      completedAt: null,
    };
    await this.repository.commitStageStarted(run, checkpoint, run.pullEvents());

    try {
      const rawExecution = await this.agents.execute(payload.stage, input);
      const execution = parseAgentExecutionResult(payload.stage, rawExecution);
      const output = execution.output;
      assertResolvableEvidenceReferences(output, previousOutputs);
      checkpoint = {
        ...checkpoint,
        status: "completed",
        output,
        outputHash: await this.hasher.hash(output),
        completedAt: this.clock.now(),
      };
      run.completeStage(payload.stage, this.clock.now());
      const nextStage = run.nextStage();
      const nextJob = nextStage ? this.#newJob(run, nextStage, job.correlationId) : null;
      await this.repository.commitStageCompleted({
        run,
        checkpoint,
        aiRun: {
          id: this.ids.generate(),
          workspaceId: payload.workspaceId,
          productResearchRunId: payload.runId,
          researchStageRunId: checkpoint.id,
          purpose: payload.stage,
          provider: execution.metadata.provider,
          model: execution.metadata.model,
          promptVersion: execution.metadata.promptVersion,
          inputHash: checkpoint.inputHash,
          parameters: execution.metadata.parameters,
          output,
          status: "completed",
          cost: execution.metadata.cost,
          latencyMs: execution.metadata.latencyMs,
          createdAt: this.clock.now(),
        },
        nextJob,
        events: run.pullEvents(),
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return { outcome: "completed", stage: payload.stage, nextStage };
    } catch (error) {
      if (error instanceof RetryableAgentError) {
        const delayMs = Math.min(15 * 60_000, 2 ** Math.max(0, job.attempts - 1) * 5_000);
        const failedCheckpoint = {
          ...checkpoint,
          status: "failed" as const,
          errorCode: error.code,
          completedAt: this.clock.now(),
        };
        const retryOutcome = await this.queue.retry({
          jobId: job.id,
          workerId: job.lockedBy,
          availableAt: new Date(this.clock.now().getTime() + delayMs),
          errorCode: error.code,
          errorMessage: error.message,
        });
        if (retryOutcome === "dead_lettered") {
          run.failStage(payload.stage, error.code, this.clock.now());
          await this.repository.commitStageFailed(run, failedCheckpoint, run.pullEvents());
          return { outcome: "failed", stage: payload.stage };
        }
        await this.repository.commitStageFailed(run, failedCheckpoint, []);
        return { outcome: "retry_scheduled", stage: payload.stage };
      }

      const code = error instanceof TerminalAgentError ? error.code : "AGENT_OUTPUT_INVALID";
      console.error(
        JSON.stringify({
          event: "research_stage_terminal_error",
          workspaceId: payload.workspaceId,
          runId: payload.runId,
          stage: payload.stage,
          code,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      run.failStage(payload.stage, code, this.clock.now());
      await this.repository.commitStageFailed(
        run,
        { ...checkpoint, status: "failed", errorCode: code, completedAt: this.clock.now() },
        run.pullEvents(),
      );
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return { outcome: "failed", stage: payload.stage };
    }
  }

  async #ensureNextJob(run: ProductResearchRun, completedStage: ResearchStage, correlationId: string): Promise<void> {
    const workflowStages = run.workflowStages();
    const completedIndex = workflowStages.indexOf(completedStage);
    const nextStage = workflowStages[completedIndex + 1] ?? null;
    if (nextStage && !run.snapshot.completedStages.includes(nextStage)) {
      await this.queue.enqueue(this.#newJob(run, nextStage, correlationId));
    }
  }

  #newJob(run: ProductResearchRun, stage: ResearchStage, correlationId: string): NewJob {
    return {
      id: this.ids.generate(),
      workspaceId: run.snapshot.workspaceId,
      type: "research.stage.execute",
      payload: { workspaceId: run.snapshot.workspaceId, runId: run.snapshot.id, stage },
      // A research-more revision may legitimately enqueue the same stage
      // again after its previous job completed. The aggregate version keeps
      // retries within one revision idempotent without blocking later ones.
      idempotencyKey: `${run.snapshot.id}:${stage}:v${run.snapshot.version}`,
      correlationId,
      maxAttempts: 5,
      availableAt: this.clock.now(),
    };
  }
}

function assertResolvableEvidenceReferences(
  output: unknown,
  previousOutputs: Readonly<Record<string, unknown>>,
): void {
  const available = new Set<string>();
  const referenced = new Set<string>();
  for (const value of [...Object.values(previousOutputs), output]) {
    walk(value, (key, candidate) => {
      if (key === "evidence" && Array.isArray(candidate)) {
        for (const item of candidate) {
          if (item && typeof item === "object" && "evidenceId" in item) {
            const id = item.evidenceId;
            if (typeof id === "string") available.add(id);
          }
        }
      }
      if (
        ["evidenceIds", "marketEvidenceIds", "productFitEvidenceIds"].includes(key) &&
        Array.isArray(candidate)
      ) {
        for (const id of candidate) {
          if (typeof id === "string") referenced.add(id);
        }
      }
    });
  }
  const unresolved = [...referenced].filter((id) => !available.has(id));
  if (unresolved.length) {
    throw new TerminalAgentError(
      "UNRESOLVED_EVIDENCE_REFERENCE",
      `Agent output references unknown evidence keys: ${unresolved.join(", ")}`,
    );
  }
}

function walk(
  value: unknown,
  visitor: (key: string, value: unknown) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child);
    walk(child, visitor);
  }
}
