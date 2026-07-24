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
