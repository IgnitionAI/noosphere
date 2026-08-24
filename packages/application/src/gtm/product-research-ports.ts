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
  listRecent(workspaceId: string, limit: number): Promise<readonly ProductResearchRun[]>;
  findCompletedCheckpoint(
    workspaceId: string,
    runId: string,
    stage: ResearchStage,
  ): Promise<ResearchCheckpoint | null>;
  listCompletedCheckpoints(workspaceId: string, runId: string): Promise<readonly ResearchCheckpoint[]>;
  nextStageAttempt(
    workspaceId: string,
    runId: string,
    stage: ResearchStage,
    workItemKey?: string,
  ): Promise<number>;
  listFanoutCheckpoints(
    workspaceId: string,
    runId: string,
    stage: "market_investigation",
  ): Promise<readonly ResearchCheckpoint[]>;
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
    fanout?: {
      readonly items: readonly ResearchWorkItem[];
      readonly jobs: readonly NewJob[];
    };
  }): Promise<void>;
  commitFanoutItemCompleted(input: {
    checkpoint: ResearchCheckpoint;
    aiRun: ResearchAIRun;
    finalizerJob: NewJob;
  }): Promise<void>;
  commitFanoutItemFailed(input: {
    checkpoint: ResearchCheckpoint;
    finalizerJob: NewJob;
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
  reviewIcpProposal(input: {
    workspaceId: string;
    runId: string;
    proposalId: string;
    userId: string;
    decision: "approved" | "rejected";
    reason: string | null;
    reviewedAt: Date;
  }): Promise<void>;
  reviewFinding(input: {
    workspaceId: string;
    runId: string;
    findingId: string;
    userId: string;
    decision: "confirmed" | "corrected" | "rejected";
    statement: string | null;
    confidence: number | null;
    reason: string | null;
    reviewedAt: Date;
  }): Promise<unknown>;
  correctIcpProposal(input: {
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
  }): Promise<unknown>;
  publishIcpVersion(input: {
    id: string;
    icpId: string;
    workspaceId: string;
    runId: string;
    proposalId: string;
    userId: string;
    publishedAt: Date;
  }): Promise<IcpVersionView>;
}

export interface IcpVersionView {
  readonly id: string;
  readonly workspaceId: string;
  readonly icpId: string;
  readonly runId: string | null;
  readonly proposalId: string | null;
  readonly version: number;
  readonly name: string;
  readonly confidence: string;
  readonly criteria: unknown;
  readonly buyingCommittee: unknown;
  readonly problems: unknown;
  readonly signals: unknown;
  readonly exclusions: unknown;
  readonly unknowns: unknown;
  readonly unresolvedContradictions: unknown;
  readonly blockedFindings: unknown;
  readonly publishedBy: string | null;
  readonly publishedAt: Date;
  readonly createdAt: Date;
}

export interface ResearchWorkItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly stage: "market_investigation";
  readonly workItemKey: string;
  readonly subjectArtifactKey: string;
  readonly ordinal: number;
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly createdAt: Date;
  readonly updatedAt: Date;
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
  getReport(workspaceId: string, runId: string): Promise<ProductResearchReportView>;
}

export interface ProductResearchReportView {
  readonly stageOutputs: Readonly<Record<string, unknown>>;
  readonly evidence: readonly MarketEvidenceView[];
  readonly competitors: readonly Readonly<Record<string, unknown>>[];
  readonly findings: readonly Readonly<Record<string, unknown>>[];
  readonly proposals: readonly Readonly<Record<string, unknown>>[];
  readonly versions: readonly Readonly<Record<string, unknown>>[];
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

export type ResearchToolRequestClaim =
  | { readonly kind: "execute"; readonly leaseToken: string }
  | { readonly kind: "cache_hit"; readonly output: string; readonly contentHash: string }
  | { readonly kind: "in_progress"; readonly retryAt: Date };

export interface ResearchToolRequestRegistry {
  claim(input: {
    workspaceId: string;
    runId: string;
    toolName: string;
    normalizedInputHash: string;
    normalizedInput: Readonly<Record<string, unknown>>;
    now: Date;
    leaseMs: number;
  }): Promise<ResearchToolRequestClaim>;
  complete(input: {
    leaseToken: string;
    output: string;
    contentHash: string;
    now: Date;
  }): Promise<void>;
  fail(input: {
    leaseToken: string;
    retryable: boolean;
    errorCode: string;
    now: Date;
  }): Promise<void>;
}

export interface ExternalQueryGuard {
  authorize(input: {
    channel: "web" | "unipile";
    payload: Readonly<Record<string, unknown>>;
    sensitiveTerms: readonly string[];
  }): Promise<{ allowed: true } | { allowed: false; reason: string }>;
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
  readonly promptVersionId?: string;
  readonly aiConfigurationId?: string;
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
