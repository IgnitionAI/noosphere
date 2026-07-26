import type {
  ProductResearchBrief,
  ResearchStage,
} from "@outbound/domain/gtm/product-research";
import type {
  ProductResearchRepository,
  ProductResearchViewRepository,
} from "@outbound/application/gtm/product-research-ports";
import {
  CreateProductResearchRun,
  PauseProductResearchRun,
  ResumeProductResearchRun,
  RequestMoreProductResearch,
  StartProductResearchRun,
} from "@outbound/application/gtm/product-research-use-cases";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";

export class ProductResearchApplication {
  readonly #create: CreateProductResearchRun;
  readonly #start: StartProductResearchRun;
  readonly #pause: PauseProductResearchRun;
  readonly #resume: ResumeProductResearchRun;
  readonly #researchMore: RequestMoreProductResearch;

  constructor(
    private readonly repository: ProductResearchRepository,
    private readonly views: ProductResearchViewRepository,
    ids: IdGenerator,
    clock: Clock,
  ) {
    this.#create = new CreateProductResearchRun(repository, ids, clock);
    this.#start = new StartProductResearchRun(repository, ids, clock);
    this.#pause = new PauseProductResearchRun(repository, clock);
    this.#resume = new ResumeProductResearchRun(repository, ids, clock);
    this.#researchMore = new RequestMoreProductResearch(repository, ids, clock);
  }

  async create(input: { workspaceId: string; brief: ProductResearchBrief }) {
    const run = await this.#create.execute(input);
    return run.snapshot;
  }

  async start(input: { workspaceId: string; runId: string; correlationId: string }) {
    try {
      const run = await this.#start.execute(input);
      return run.snapshot;
    } catch (error) {
      rethrowNotFound(error, input.runId);
    }
  }

  async get(input: { workspaceId: string; runId: string }) {
    const run = await this.repository.findById(input.workspaceId, input.runId);
    if (!run) throw new ProductResearchNotFoundError(input.runId);
    return run.snapshot;
  }

  async getProgress(input: { workspaceId: string; runId: string }) {
    const run = await this.get(input);
    const stageRuns = await this.views.listStageRuns(input.workspaceId, input.runId);
    return { run, stageRuns };
  }

  async pause(input: { workspaceId: string; runId: string }) {
    try {
      const run = await this.#pause.execute(input);
      return run.snapshot;
    } catch (error) {
      rethrowNotFound(error, input.runId);
    }
  }

  async resume(input: { workspaceId: string; runId: string; correlationId: string }) {
    try {
      const run = await this.#resume.execute(input);
      return run.snapshot;
    } catch (error) {
      rethrowNotFound(error, input.runId);
    }
  }

  async listEvidence(input: {
    workspaceId: string;
    runId: string;
    after: { createdAt: Date; id: string } | null;
    limit: number;
  }) {
    await this.get({ workspaceId: input.workspaceId, runId: input.runId });
    return this.views.listEvidence(input);
  }

  async researchMore(input: {
    workspaceId: string;
    runId: string;
    fromStage: ResearchStage;
    reason: string;
    correlationId: string;
  }) {
    try {
      const run = await this.#researchMore.execute(input);
      return run.snapshot;
    } catch (error) {
      rethrowNotFound(error, input.runId);
    }
  }

  async getReport(input: { workspaceId: string; runId: string }) {
    const run = await this.get(input);
    const report = await this.views.getReport(input.workspaceId, input.runId);
    return { run, ...report };
  }

  async reviewIcpProposal(input: {
    workspaceId: string;
    runId: string;
    proposalId: string;
    userId: string;
    decision: "approved" | "rejected";
    reason: string | null;
  }): Promise<void> {
    const run = await this.get({ workspaceId: input.workspaceId, runId: input.runId });
    if (run.status !== "ready_for_review") {
      throw new Error("PRODUCT_RESEARCH_NOT_READY_FOR_REVIEW");
    }
    await this.repository.reviewIcpProposal({
      ...input,
      reviewedAt: new Date(),
    });
  }
}

export class ProductResearchNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`Product research run ${runId} was not found`);
    this.name = "ProductResearchNotFoundError";
  }
}

function rethrowNotFound(error: unknown, runId: string): never {
  if (error instanceof Error && error.message === "PRODUCT_RESEARCH_RUN_NOT_FOUND") {
    throw new ProductResearchNotFoundError(runId);
  }
  throw error;
}
