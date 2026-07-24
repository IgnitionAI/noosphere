import type {
  ProductResearchEvent,
  ProductResearchRun,
  ResearchCheckpoint,
  ResearchStage,
} from "@outbound/domain/gtm/product-research";
import type { AgentExecutionResult, AgentStageInput } from "@outbound/contracts/product-research";
import type { NewJob } from "@outbound/application/jobs/job-queue";

export interface ProductResearchRepository {
  insert(run: ProductResearchRun): Promise<void>;
  findById(workspaceId: string, runId: string): Promise<ProductResearchRun | null>;
  findCompletedCheckpoint(
    workspaceId: string,
    runId: string,
    stage: ResearchStage,
  ): Promise<ResearchCheckpoint | null>;
  listCompletedCheckpoints(workspaceId: string, runId: string): Promise<readonly ResearchCheckpoint[]>;
  commitRunTransition(
    run: ProductResearchRun,
    job: NewJob | null,
    events: readonly ProductResearchEvent[],
  ): Promise<void>;
  commitStageStarted(
    run: ProductResearchRun,
    checkpoint: ResearchCheckpoint,
    events: readonly ProductResearchEvent[],
  ): Promise<void>;
  commitStageCompleted(input: {
    run: ProductResearchRun;
    checkpoint: ResearchCheckpoint;
    aiRun: ResearchAIRun;
    nextJob: NewJob | null;
    events: readonly ProductResearchEvent[];
  }): Promise<void>;
  commitStageFailed(
    run: ProductResearchRun,
    checkpoint: ResearchCheckpoint,
    events: readonly ProductResearchEvent[],
  ): Promise<void>;
  commitResearchMore(input: {
    run: ProductResearchRun;
    fromStage: ResearchStage;
    reason: string;
    job: NewJob;
    events: readonly ProductResearchEvent[];
  }): Promise<void>;
}

export interface ProductResearchViewRepository {
  listStageRuns(
    workspaceId: string,
    runId: string,
  ): Promise<readonly ResearchStageRunView[]>;
  listEvidence(input: {
    workspaceId: string;
    runId: string;
    after: { createdAt: Date; id: string } | null;
    limit: number;
  }): Promise<readonly MarketEvidenceView[]>;
}

export interface ResearchStageRunView {
  readonly id: string;
  readonly stage: ResearchStage;
  readonly attempt: number;
  readonly status: ResearchCheckpoint["status"];
  readonly review: ResearchCheckpoint["review"];
  readonly errorCode: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

export interface MarketEvidenceView {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly sourceType: "public_web" | "internal_document";
  readonly url: string | null;
  readonly title: string;
  readonly excerpt: string;
  readonly contentHash: string;
  readonly observedAt: Date;
  readonly createdAt: Date;
}

export interface ResearchAgentExecutor {
  execute(stage: ResearchStage, input: AgentStageInput): Promise<AgentExecutionResult>;
}

export interface ResearchAIRun {
  readonly id: string;
  readonly workspaceId: string;
  readonly productResearchRunId: string;
  readonly researchStageRunId: string;
  readonly purpose: ResearchStage;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputHash: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly output: unknown;
  readonly status: "completed";
  readonly cost: number | null;
  readonly latencyMs: number;
  readonly createdAt: Date;
}

export class RetryableAgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RetryableAgentError";
  }
}

export class TerminalAgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TerminalAgentError";
  }
}
