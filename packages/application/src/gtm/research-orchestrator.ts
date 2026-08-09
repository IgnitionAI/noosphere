import {
  type ProductResearchRun,
  type ResearchCheckpoint,
  type ResearchStage,
} from "@outbound/domain/gtm/product-research";
import {
  parseAgentInput,
  parseAgentExecutionResult,
  parseAgentOutput,
  researchStageJobPayloadSchema,
} from "@outbound/contracts/product-research";
import type { LeasedJob, JobQueue, NewJob } from "@outbound/application/jobs/job-queue";
import {
  RetryableAgentError,
  TerminalAgentError,
  type ProductResearchRepository,
  type ResearchAgentExecutor,
  type ResearchWorkItem,
} from "@outbound/application/gtm/product-research-ports";
import type { Clock, ContentHasher, IdGenerator } from "@outbound/application/shared/ports";
import { buildV3StageSnapshot } from "@outbound/application/gtm/v3-stage-input-projector";

export type ResearchJobResult =
  | { readonly outcome: "completed"; readonly stage: ResearchStage; readonly nextStage: ResearchStage | null }
  | { readonly outcome: "already_completed"; readonly stage: ResearchStage }
  | { readonly outcome: "superseded"; readonly stage: ResearchStage }
  | { readonly outcome: "paused"; readonly stage: ResearchStage }
  | { readonly outcome: "retry_scheduled"; readonly stage: ResearchStage }
  | { readonly outcome: "partial"; readonly stage: ResearchStage }
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

  async #processMarketWorkItem(
    job: LeasedJob,
    run: ProductResearchRun,
    payload: ReturnType<typeof researchStageJobPayloadSchema.parse>,
  ): Promise<ResearchJobResult> {
    if (payload.stage !== "market_investigation" || !payload.hypothesisId) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      throw new TerminalAgentError("INVALID_RESEARCH_WORK_ITEM", "Only market hypotheses may fan out");
    }
    if (
      run.snapshot.activeStage !== "market_investigation" ||
      run.nextStage() !== "market_investigation"
    ) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return { outcome: "superseded", stage: "market_investigation" };
    }
    const completed = (await this.repository.listFanoutCheckpoints(
      payload.workspaceId,
      payload.runId,
      "market_investigation",
    )).find((checkpoint) => checkpoint.workItemKey === payload.workItemKey);
    if (completed) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return { outcome: "already_completed", stage: "market_investigation" };
    }
    if (run.snapshot.status === "paused") {
      await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 60_000),
        errorCode: "RUN_PAUSED",
        errorMessage: "Research run is paused",
      });
      return { outcome: "paused", stage: "market_investigation" };
    }
    const previous = await this.repository.listCompletedCheckpoints(payload.workspaceId, payload.runId);
    const stageSnapshot = snapshotForHypothesis(
      buildV3StageSnapshot("market_investigation", previous),
      payload.hypothesisId,
    );
    const now = this.clock.now();
    const attempt = await this.repository.nextStageAttempt(
      payload.workspaceId,
      payload.runId,
      "market_investigation",
      payload.workItemKey,
    );
    const checkpointId = this.ids.generate();
    const input = parseAgentInput("market_investigation", {
      runId: payload.runId,
      researchStageRunId: checkpointId,
      workspaceId: payload.workspaceId,
      stage: "market_investigation",
      brief: run.snapshot.brief,
      previousOutputs: stageSnapshot,
      correlationId: job.correlationId,
      deadlineAt: run.snapshot.deadlineAt?.toISOString() ?? null,
      workItemKey: payload.workItemKey,
      externalDlpTerms: extractInternalDlpTerms(previous),
    });
    let checkpoint: ResearchCheckpoint = {
      id: checkpointId,
      workspaceId: payload.workspaceId,
      runId: payload.runId,
      stage: "market_investigation",
      workItemKey: payload.workItemKey,
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
    await this.repository.commitStageStarted(run, checkpoint, []);
    const finalizerJob = this.#newMarketFinalizerJob(
      run,
      payload.fanoutSize ?? 1,
      job.correlationId,
    );
    try {
      const execution = parseAgentExecutionResult(
        "market_investigation",
        await this.agents.execute("market_investigation", input),
      );
      assertSingleHypothesisInvestigation(execution.output, payload.hypothesisId);
      assertResolvableEvidenceReferences(execution.output, stageSnapshot);
      checkpoint = {
        ...checkpoint,
        status: "completed",
        output: execution.output,
        outputHash: await this.hasher.hash(execution.output),
        completedAt: this.clock.now(),
      };
      await this.repository.commitFanoutItemCompleted({
        checkpoint,
        aiRun: {
          id: this.ids.generate(),
          workspaceId: checkpoint.workspaceId,
          productResearchRunId: checkpoint.runId,
          researchStageRunId: checkpoint.id,
          purpose: "market_investigation",
          provider: execution.metadata.provider,
          model: execution.metadata.model,
          promptVersion: execution.metadata.promptVersion,
          ...aiConfigurationReferences(execution.metadata.parameters),
          inputHash: checkpoint.inputHash,
          parameters: { ...execution.metadata.parameters, workItemKey: checkpoint.workItemKey },
          output: execution.output,
          status: "completed",
          cost: execution.metadata.cost,
          latencyMs: execution.metadata.latencyMs,
          createdAt: this.clock.now(),
        },
        finalizerJob,
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return { outcome: "completed", stage: "market_investigation", nextStage: "market_investigation" };
    } catch (error) {
      let leaseAlreadyReleased = false;
      if (error instanceof RetryableAgentError) {
        const retryOutcome = await this.queue.retry({
          jobId: job.id,
          workerId: job.lockedBy,
          availableAt: new Date(this.clock.now().getTime() + 5_000),
          errorCode: error.code,
          errorMessage: error.message,
        });
        leaseAlreadyReleased = true;
        checkpoint = {
          ...checkpoint,
          status: "failed",
          errorCode: error.code,
          completedAt: this.clock.now(),
        };
        if (retryOutcome === "scheduled") {
          await this.repository.commitStageFailed(run, checkpoint, []);
          return { outcome: "retry_scheduled", stage: "market_investigation" };
        }
      }
      const code = error instanceof TerminalAgentError ? error.code : "AGENT_OUTPUT_INVALID";
      checkpoint = {
        ...checkpoint,
        status: "failed",
        errorCode: code,
        completedAt: this.clock.now(),
      };
      await this.repository.commitFanoutItemFailed({ checkpoint, finalizerJob });
      if (!leaseAlreadyReleased) {
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      }
      return { outcome: "failed", stage: "market_investigation" };
    }
  }

  async #finalizeMarketFanout(
    job: LeasedJob,
    run: ProductResearchRun,
  ): Promise<ResearchJobResult> {
    const existing = await this.repository.findCompletedCheckpoint(
      run.snapshot.workspaceId,
      run.snapshot.id,
      "market_investigation",
    );
    if (existing) {
      await this.#ensureNextJob(run, "market_investigation", job.correlationId);
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return { outcome: "already_completed", stage: "market_investigation" };
    }
    const children = await this.repository.listFanoutCheckpoints(
      run.snapshot.workspaceId,
      run.snapshot.id,
      "market_investigation",
    );
    const previous = await this.repository.listCompletedCheckpoints(
      run.snapshot.workspaceId,
      run.snapshot.id,
    );
    const discovery = previous.find(
      (checkpoint) => checkpoint.stage === "organization_discovery",
    )?.output;
    const allHypothesisIds = organizationHypotheses(discovery).map(
      (hypothesis) => hypothesis.hypothesisId,
    );
    const childOutputs = children.map(
      (checkpoint) => checkpoint.output as Record<string, unknown>,
    );
    const investigations = childOutputs.flatMap((output) =>
      Array.isArray(output.investigations) ? output.investigations : [],
    );
    const completedIds = new Set(
      investigations.flatMap((item) =>
        item &&
        typeof item === "object" &&
        "hypothesisId" in item &&
        typeof item.hypothesisId === "string"
          ? [item.hypothesisId]
          : [],
      ),
    );
    const evidence = [
      ...new Map(
        childOutputs
          .flatMap((output) => (Array.isArray(output.evidence) ? output.evidence : []))
          .flatMap((item) =>
            item &&
            typeof item === "object" &&
            "evidenceId" in item &&
            typeof item.evidenceId === "string"
              ? [[item.evidenceId, item] as const]
              : [],
          ),
      ).values(),
    ];
    const output = parseAgentOutput("market_investigation", {
      investigations,
      notInvestigatedHypothesisIds: allHypothesisIds.filter(
        (hypothesisId) => !completedIds.has(hypothesisId),
      ),
      evidence,
    });
    const now = this.clock.now();
    run.beginStage("market_investigation", now);
    const checkpointId = this.ids.generate();
    let checkpoint: ResearchCheckpoint = {
      id: checkpointId,
      workspaceId: run.snapshot.workspaceId,
      runId: run.snapshot.id,
      stage: "market_investigation",
      workItemKey: "main",
      attempt: await this.repository.nextStageAttempt(
        run.snapshot.workspaceId,
        run.snapshot.id,
        "market_investigation",
      ),
      status: "running",
      review: "machine",
      inputHash: await this.hasher.hash(children.map((item) => item.outputHash)),
      outputHash: null,
      output: null,
      errorCode: null,
      startedAt: now,
      completedAt: null,
    };
    await this.repository.commitStageStarted(run, checkpoint, run.pullEvents());
    checkpoint = {
      ...checkpoint,
      status: "completed",
      output,
      outputHash: await this.hasher.hash(output),
      completedAt: this.clock.now(),
    };
    run.completeStage("market_investigation", this.clock.now());
    const nextStage = run.nextStage();
    await this.repository.commitStageCompleted({
      run,
      checkpoint,
      aiRun: {
        id: this.ids.generate(),
        workspaceId: run.snapshot.workspaceId,
        productResearchRunId: run.snapshot.id,
        researchStageRunId: checkpoint.id,
        purpose: "market_investigation",
        provider: "local-policy",
        model: "durable-fanout-join-v1",
        promptVersion: "icp-v3-fanout-join-v1",
        inputHash: checkpoint.inputHash,
        parameters: {
          completedItems: children.length,
          generatedHypotheses: allHypothesisIds.length,
        },
        output,
        status: "completed",
        cost: 0,
        latencyMs: 0,
        createdAt: this.clock.now(),
      },
      nextJob: nextStage ? this.#newJob(run, nextStage, job.correlationId) : null,
      events: run.pullEvents(),
    });
    await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    return { outcome: "completed", stage: "market_investigation", nextStage };
  }

  async #process(job: LeasedJob): Promise<ResearchJobResult> {
    const payload = researchStageJobPayloadSchema.parse(job.payload);
    const run = await this.repository.findById(payload.workspaceId, payload.runId);
    if (!run) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      throw new TerminalAgentError("PRODUCT_RESEARCH_RUN_NOT_FOUND", `Run ${payload.runId} was not found`);
    }
    if (payload.finalizeFanout) return this.#finalizeMarketFanout(job, run);
    if (payload.workItemKey !== "main") return this.#processMarketWorkItem(job, run, payload);

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
    const previousOutputs = run.snapshot.brief.researchVersion === 3
      ? buildV3StageSnapshot(payload.stage, previous)
      : Object.fromEntries(previous.map((checkpoint) => [checkpoint.stage, checkpoint.output]));
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
      deadlineAt: run.snapshot.deadlineAt?.toISOString() ?? null,
      workItemKey: "main",
      externalDlpTerms: extractInternalDlpTerms(previous),
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
      const terminalOutcome =
        payload.stage === "objective_ranking" &&
        output &&
        typeof output === "object" &&
        "status" in output &&
        output.status === "partial"
          ? "partial"
          : "completed";
      run.completeStage(payload.stage, this.clock.now(), terminalOutcome);
      let nextStage = run.nextStage();
      let nextJob = nextStage ? this.#newJob(run, nextStage, job.correlationId) : null;
      let fanout: { items: ResearchWorkItem[]; jobs: NewJob[] } | undefined;
      if (run.snapshot.brief.researchVersion === 3 && payload.stage === "organization_discovery") {
        const hypotheses = organizationHypotheses(output).slice(0, 4);
        if (hypotheses.length > 0) {
          run.beginStage("market_investigation", this.clock.now());
          const fanoutStartedAt = this.clock.now();
          const items = hypotheses.map((hypothesis, ordinal) => ({
            id: this.ids.generate(),
            workspaceId: payload.workspaceId,
            runId: payload.runId,
            stage: "market_investigation" as const,
            workItemKey: `hypothesis:${hypothesis.hypothesisId}`,
            subjectArtifactKey: hypothesis.hypothesisId,
            ordinal,
            status: "pending" as const,
            createdAt: fanoutStartedAt,
            updatedAt: fanoutStartedAt,
          }));
          fanout = {
            items,
            jobs: items.map((item) =>
              this.#newMarketWorkItemJob(run, item, items.length, job.correlationId)),
          };
          nextStage = "market_investigation";
          nextJob = null;
        }
      }
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
          ...aiConfigurationReferences(execution.metadata.parameters),
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
        ...(fanout ? { fanout } : {}),
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
      if (run.snapshot.brief.researchVersion === 3 && isBudgetExhaustion(code)) {
        run.finishPartial(payload.stage, code, this.clock.now());
      } else if (run.snapshot.brief.researchVersion === 3) {
        run.interrupt(payload.stage, code, this.clock.now());
      } else {
        run.failStage(payload.stage, code, this.clock.now());
      }
      await this.repository.commitStageFailed(
        run,
        { ...checkpoint, status: "failed", errorCode: code, completedAt: this.clock.now() },
        run.pullEvents(),
      );
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return {
        outcome:
          run.snapshot.brief.researchVersion === 3 && isBudgetExhaustion(code)
            ? "partial"
            : "failed",
        stage: payload.stage,
      };
    }
  }

  async #ensureNextJob(run: ProductResearchRun, completedStage: ResearchStage, correlationId: string): Promise<void> {
    if (
      run.snapshot.brief.researchVersion === 3 &&
      completedStage === "organization_discovery" &&
      run.snapshot.activeStage === "market_investigation"
    ) {
      return;
    }
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

  #newMarketWorkItemJob(
    run: ProductResearchRun,
    item: ResearchWorkItem,
    fanoutSize: number,
    correlationId: string,
  ): NewJob {
    return {
      id: this.ids.generate(),
      workspaceId: run.snapshot.workspaceId,
      type: "research.stage.execute",
      payload: {
        workspaceId: run.snapshot.workspaceId,
        runId: run.snapshot.id,
        stage: "market_investigation",
        workItemKey: item.workItemKey,
        hypothesisId: item.subjectArtifactKey,
        fanoutSize,
      },
      idempotencyKey: `${run.snapshot.id}:market:${item.workItemKey}:v${run.snapshot.version}`,
      correlationId,
      maxAttempts: 5,
      availableAt: this.clock.now(),
    };
  }

  #newMarketFinalizerJob(
    run: ProductResearchRun,
    fanoutSize: number,
    correlationId: string,
  ): NewJob {
    return {
      id: this.ids.generate(),
      workspaceId: run.snapshot.workspaceId,
      type: "research.stage.execute",
      payload: {
        workspaceId: run.snapshot.workspaceId,
        runId: run.snapshot.id,
        stage: "market_investigation",
        workItemKey: "main",
        fanoutSize,
        finalizeFanout: true,
      },
      idempotencyKey: `${run.snapshot.id}:market:finalize:v${run.snapshot.version}`,
      correlationId,
      maxAttempts: 5,
      availableAt: this.clock.now(),
    };
  }
}

function aiConfigurationReferences(parameters: Readonly<Record<string, unknown>>): { aiConfigurationId?: string; promptVersionId?: string } {
  const aiConfigurationId = typeof parameters.aiConfigurationId === "string" ? parameters.aiConfigurationId : undefined;
  const promptVersionId = typeof parameters.promptVersionId === "string" ? parameters.promptVersionId : undefined;
  return { ...(aiConfigurationId ? { aiConfigurationId } : {}), ...(promptVersionId ? { promptVersionId } : {}) };
}

export function isBudgetExhaustion(code: string): boolean {
  return code === "RESEARCH_BUDGET_EXHAUSTED" || code === "RESEARCH_GLOBAL_DEADLINE_EXHAUSTED";
}

function organizationHypotheses(output: unknown): Array<{
  hypothesisId: string;
  [key: string]: unknown;
}> {
  if (!output || typeof output !== "object" || !("hypotheses" in output)) return [];
  const hypotheses = (output as { hypotheses?: unknown }).hypotheses;
  if (!Array.isArray(hypotheses)) return [];
  return hypotheses.filter(
    (item): item is { hypothesisId: string; [key: string]: unknown } =>
      Boolean(item) &&
      typeof item === "object" &&
      "hypothesisId" in item &&
      typeof item.hypothesisId === "string",
  );
}

function snapshotForHypothesis(
  snapshot: Readonly<Record<string, unknown>>,
  hypothesisId: string,
): Readonly<Record<string, unknown>> {
  const discovery = snapshot.organization_discovery;
  if (!discovery || typeof discovery !== "object") return snapshot;
  const hypotheses = organizationHypotheses(discovery).filter(
    (hypothesis) => hypothesis.hypothesisId === hypothesisId,
  );
  return {
    ...snapshot,
    organization_discovery: {
      ...(discovery as Record<string, unknown>),
      hypotheses,
    },
    assignedHypothesisId: hypothesisId,
  };
}

function assertSingleHypothesisInvestigation(output: unknown, hypothesisId: string): void {
  if (!output || typeof output !== "object" || !("investigations" in output)) {
    throw new TerminalAgentError(
      "MARKET_WORK_ITEM_SCOPE_VIOLATION",
      `Work item must return hypothesis ${hypothesisId}`,
    );
  }
  const investigations = (output as { investigations?: unknown }).investigations;
  if (
    !Array.isArray(investigations) ||
    investigations.length !== 1 ||
    !investigations.some(
      (item) =>
        item &&
        typeof item === "object" &&
        "hypothesisId" in item &&
        item.hypothesisId === hypothesisId,
    )
  ) {
    throw new TerminalAgentError(
      "MARKET_WORK_ITEM_SCOPE_VIOLATION",
      `Work item must return exactly hypothesis ${hypothesisId}`,
    );
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
    });
  }
  walk(output, (key, candidate) => {
    if (
      ["evidenceIds", "marketEvidenceIds", "productFitEvidenceIds"].includes(key) &&
      Array.isArray(candidate)
    ) {
      for (const id of candidate) {
        if (typeof id === "string") referenced.add(id);
      }
    }
    if (key === "evidence" && Array.isArray(candidate)) {
      for (const item of candidate) {
        if (
          item &&
          typeof item === "object" &&
          "evidenceId" in item &&
          !("sourceType" in item) &&
          typeof item.evidenceId === "string"
        ) {
          referenced.add(item.evidenceId);
        }
      }
    }
  });
  const unresolved = [...referenced].filter((id) => !available.has(id));
  if (unresolved.length) {
    throw new TerminalAgentError(
      "UNRESOLVED_EVIDENCE_REFERENCE",
      `Agent output references unknown evidence keys: ${unresolved.join(", ")}`,
    );
  }
}

function extractInternalDlpTerms(
  checkpoints: readonly Pick<ResearchCheckpoint, "output">[],
): readonly string[] {
  const terms = new Set<string>();
  for (const checkpoint of checkpoints) {
    walk(checkpoint.output, (key, candidate) => {
      if (key !== "evidence" || !Array.isArray(candidate)) return;
      for (const item of candidate) {
        if (
          !item ||
          typeof item !== "object" ||
          !("sourceType" in item) ||
          item.sourceType !== "internal_document"
        ) continue;
        for (const field of ["excerpt", "context"] as const) {
          if (!(field in item) || typeof item[field] !== "string") continue;
          const value = item[field].trim().slice(0, 1_000);
          if (value.length >= 8) terms.add(value);
          if (terms.size >= 200) return;
        }
      }
    });
    if (terms.size >= 200) break;
  }
  return [...terms];
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
