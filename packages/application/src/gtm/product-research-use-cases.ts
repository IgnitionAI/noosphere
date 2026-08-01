import {
  ProductResearchRun,
  type ProductResearchBrief,
  type ResearchStage,
} from "@outbound/domain/gtm/product-research";
import type { ProductResearchRepository } from "@outbound/application/gtm/product-research-ports";
import type { NewJob } from "@outbound/application/jobs/job-queue";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";

export class CreateProductResearchRun {
  constructor(
    private readonly repository: ProductResearchRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    brief: ProductResearchBrief;
  }): Promise<ProductResearchRun> {
    const run = ProductResearchRun.create({
      id: this.ids.generate(),
      workspaceId: input.workspaceId,
      brief: input.brief,
      now: this.clock.now(),
    });
    await this.repository.insert(run);
    return run;
  }
}

export class StartProductResearchRun {
  constructor(
    private readonly repository: ProductResearchRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    runId: string;
    correlationId: string;
  }): Promise<ProductResearchRun> {
    const run = await this.repository.findById(input.workspaceId, input.runId);
    if (!run) throw new Error("PRODUCT_RESEARCH_RUN_NOT_FOUND");

    run.start(this.clock.now());
    const stage = run.nextStage();
    if (!stage) return run;

    const job: NewJob = {
      id: this.ids.generate(),
      workspaceId: input.workspaceId,
      type: "research.stage.execute",
      payload: { workspaceId: input.workspaceId, runId: input.runId, stage },
      idempotencyKey: `${input.runId}:${stage}`,
      correlationId: input.correlationId,
      maxAttempts: 5,
      availableAt: this.clock.now(),
    };
    await this.repository.commitRunTransition(run, job, run.pullEvents());
    return run;
  }
}

export class PauseProductResearchRun {
  constructor(
    private readonly repository: ProductResearchRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: { workspaceId: string; runId: string }): Promise<ProductResearchRun> {
    const run = await this.repository.findById(input.workspaceId, input.runId);
    if (!run) throw new Error("PRODUCT_RESEARCH_RUN_NOT_FOUND");
    run.pause(this.clock.now());
    await this.repository.commitRunTransition(run, null, run.pullEvents());
    return run;
  }
}

export class ResumeProductResearchRun {
  constructor(
    private readonly repository: ProductResearchRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    runId: string;
    correlationId: string;
  }): Promise<ProductResearchRun> {
    const run = await this.repository.findById(input.workspaceId, input.runId);
    if (!run) throw new Error("PRODUCT_RESEARCH_RUN_NOT_FOUND");
    run.resume(this.clock.now());
    const stage = run.nextStage();
    const job = stage
      ? {
        id: this.ids.generate(),
        workspaceId: input.workspaceId,
        type: "research.stage.execute",
        payload: { workspaceId: input.workspaceId, runId: input.runId, stage },
        idempotencyKey: `${input.runId}:${stage}:resume:${run.snapshot.version}`,
        correlationId: input.correlationId,
        maxAttempts: 5,
        availableAt: this.clock.now(),
      }
      : null;
    await this.repository.commitRunTransition(run, job, run.pullEvents());
    return run;
  }
}

export class RequestMoreProductResearch {
  constructor(
    private readonly repository: ProductResearchRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    runId: string;
    fromStage: ResearchStage;
    reason: string;
    correlationId: string;
  }): Promise<ProductResearchRun> {
    const run = await this.repository.findById(input.workspaceId, input.runId);
    if (!run) throw new Error("PRODUCT_RESEARCH_RUN_NOT_FOUND");
    const checkpoints = await this.repository.listCompletedCheckpoints(input.workspaceId, input.runId);
    const workflowStages = run.workflowStages();
    const fromIndex = workflowStages.indexOf(input.fromStage);
    const preservedHumanStages = checkpoints
      .filter(
        (checkpoint) =>
          checkpoint.review === "human_reviewed" &&
          workflowStages.indexOf(checkpoint.stage) >= fromIndex,
      )
      .map((checkpoint) => checkpoint.stage);
    run.requestMore(input.fromStage, preservedHumanStages, input.reason, this.clock.now());
    const stage = run.nextStage();
    if (!stage) throw new Error("PRODUCT_RESEARCH_NO_STAGE_TO_RESEARCH");
    const job: NewJob = {
      id: this.ids.generate(),
      workspaceId: input.workspaceId,
      type: "research.stage.execute",
      payload: { workspaceId: input.workspaceId, runId: input.runId, stage },
      idempotencyKey: `${input.runId}:${stage}:research-more:${run.snapshot.version}`,
      correlationId: input.correlationId,
      maxAttempts: 5,
      availableAt: this.clock.now(),
    };
    await this.repository.commitResearchMore({
      run,
      fromStage: input.fromStage,
      reason: input.reason,
      job,
      events: run.pullEvents(),
    });
    return run;
  }
}
