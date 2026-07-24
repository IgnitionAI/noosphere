export const researchStages = [
  "product_analysis",
  "competitor_discovery",
  "competitor_analysis",
  "segment_synthesis",
  "icp_synthesis",
  "evidence_review",
] as const;

export type ResearchStage = (typeof researchStages)[number];
export type ProductResearchStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "ready_for_review"
  | "failed";
export type ResearchDepth = "quick" | "standard" | "deep";

export interface ProductResearchBrief {
  readonly productUrl: string;
  readonly productName: string;
  readonly description: string;
  readonly geography: string;
  readonly languages: readonly string[];
  readonly salesMotion: "service" | "saas" | "license" | "hybrid";
  readonly knownCompetitors: readonly string[];
  readonly internalDocumentIds: readonly string[];
  readonly depth: ResearchDepth;
}

export interface ProductResearchRunSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly brief: ProductResearchBrief;
  readonly status: ProductResearchStatus;
  readonly activeStage: ResearchStage | null;
  readonly completedStages: readonly ResearchStage[];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type ProductResearchEvent =
  | { readonly type: "ProductResearchQueued"; readonly runId: string; readonly workspaceId: string }
  | { readonly type: "ProductResearchPaused"; readonly runId: string; readonly workspaceId: string }
  | { readonly type: "ProductResearchResumed"; readonly runId: string; readonly workspaceId: string }
  | {
      readonly type: "ResearchStageStarted";
      readonly runId: string;
      readonly workspaceId: string;
      readonly stage: ResearchStage;
    }
  | {
      readonly type: "ResearchStageCompleted";
      readonly runId: string;
      readonly workspaceId: string;
      readonly stage: ResearchStage;
    }
  | { readonly type: "ProductResearchReadyForReview"; readonly runId: string; readonly workspaceId: string }
  | {
      readonly type: "ProductResearchMoreRequested";
      readonly runId: string;
      readonly workspaceId: string;
      readonly fromStage: ResearchStage;
      readonly reason: string;
    }
  | {
      readonly type: "ResearchStageFailed";
      readonly runId: string;
      readonly workspaceId: string;
      readonly stage: ResearchStage;
      readonly reason: string;
    };

export class ProductResearchInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductResearchInvariantError";
  }
}

export class ProductResearchRun {
  readonly #events: ProductResearchEvent[] = [];
  #snapshot: ProductResearchRunSnapshot;

  private constructor(snapshot: ProductResearchRunSnapshot) {
    this.#snapshot = snapshot;
  }

  static create(input: {
    id: string;
    workspaceId: string;
    brief: ProductResearchBrief;
    now: Date;
  }): ProductResearchRun {
    if (!input.workspaceId) throw new ProductResearchInvariantError("A research run requires a workspace");
    if (!input.brief.productName.trim()) {
      throw new ProductResearchInvariantError("A research run requires a product name");
    }
    if (!input.brief.productUrl.trim() && !input.brief.description.trim()) {
      throw new ProductResearchInvariantError("A research run requires a product URL or description");
    }

    return new ProductResearchRun({
      id: input.id,
      workspaceId: input.workspaceId,
      brief: input.brief,
      status: "draft",
      activeStage: null,
      completedStages: [],
      version: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static restore(snapshot: ProductResearchRunSnapshot): ProductResearchRun {
    return new ProductResearchRun(snapshot);
  }

  get snapshot(): ProductResearchRunSnapshot {
    return this.#snapshot;
  }

  nextStage(): ResearchStage | null {
    return researchStages.find((stage) => !this.#snapshot.completedStages.includes(stage)) ?? null;
  }

  start(now: Date): void {
    if (this.#snapshot.status === "queued" || this.#snapshot.status === "running") return;
    if (this.#snapshot.status !== "draft") {
      throw new ProductResearchInvariantError(`Cannot start a run in status ${this.#snapshot.status}`);
    }
    this.#update({ status: "queued", updatedAt: now });
    this.#events.push({
      type: "ProductResearchQueued",
      runId: this.#snapshot.id,
      workspaceId: this.#snapshot.workspaceId,
    });
  }

  pause(now: Date): void {
    if (this.#snapshot.status === "paused") return;
    if (!["queued", "running"].includes(this.#snapshot.status)) {
      throw new ProductResearchInvariantError(`Cannot pause a run in status ${this.#snapshot.status}`);
    }
    this.#update({ status: "paused", updatedAt: now });
    this.#events.push({
      type: "ProductResearchPaused",
      runId: this.#snapshot.id,
      workspaceId: this.#snapshot.workspaceId,
    });
  }

  resume(now: Date): void {
    if (this.#snapshot.status === "queued" || this.#snapshot.status === "running") return;
    if (this.#snapshot.status !== "paused") {
      throw new ProductResearchInvariantError(`Cannot resume a run in status ${this.#snapshot.status}`);
    }
    this.#update({ status: this.#snapshot.activeStage ? "running" : "queued", updatedAt: now });
    this.#events.push({
      type: "ProductResearchResumed",
      runId: this.#snapshot.id,
      workspaceId: this.#snapshot.workspaceId,
    });
  }

  beginStage(stage: ResearchStage, now: Date): void {
    if (this.#snapshot.status === "paused") {
      throw new ProductResearchInvariantError("Cannot begin a stage while the run is paused");
    }
    if (this.#snapshot.activeStage === stage && this.#snapshot.status === "running") return;
    const expected = this.nextStage();
    if (expected !== stage) {
      throw new ProductResearchInvariantError(`Expected stage ${expected ?? "none"}, received ${stage}`);
    }
    if (!["queued", "running"].includes(this.#snapshot.status)) {
      throw new ProductResearchInvariantError(`Cannot begin a stage in status ${this.#snapshot.status}`);
    }

    this.#update({ status: "running", activeStage: stage, updatedAt: now });
    this.#events.push({
      type: "ResearchStageStarted",
      runId: this.#snapshot.id,
      workspaceId: this.#snapshot.workspaceId,
      stage,
    });
  }

  completeStage(stage: ResearchStage, now: Date): void {
    if (this.#snapshot.completedStages.includes(stage)) return;
    if (this.#snapshot.activeStage !== stage) {
      throw new ProductResearchInvariantError(`Stage ${stage} is not active`);
    }

    const completedStages = [...this.#snapshot.completedStages, stage];
    const ready = completedStages.length === researchStages.length;
    this.#update({
      completedStages,
      activeStage: null,
      status: ready ? "ready_for_review" : "running",
      updatedAt: now,
    });
    this.#events.push({
      type: "ResearchStageCompleted",
      runId: this.#snapshot.id,
      workspaceId: this.#snapshot.workspaceId,
      stage,
    });
    if (ready) {
      this.#events.push({
        type: "ProductResearchReadyForReview",
        runId: this.#snapshot.id,
        workspaceId: this.#snapshot.workspaceId,
      });
    }
  }

  failStage(stage: ResearchStage, reason: string, now: Date): void {
    if (this.#snapshot.activeStage !== stage) {
      throw new ProductResearchInvariantError(`Stage ${stage} is not active`);
    }
    this.#update({ status: "failed", updatedAt: now });
    this.#events.push({
      type: "ResearchStageFailed",
      runId: this.#snapshot.id,
      workspaceId: this.#snapshot.workspaceId,
      stage,
      reason,
    });
  }

  requestMore(
    fromStage: ResearchStage,
    preservedHumanStages: readonly ResearchStage[],
    reason: string,
    now: Date,
  ): void {
    const fromIndex = researchStages.indexOf(fromStage);
    const wasReached =
      this.#snapshot.completedStages.includes(fromStage) || this.#snapshot.activeStage === fromStage;
    if (!wasReached) {
      throw new ProductResearchInvariantError(`Stage ${fromStage} has not been reached`);
    }
    const completedStages = this.#snapshot.completedStages.filter(
      (stage) => researchStages.indexOf(stage) < fromIndex || preservedHumanStages.includes(stage),
    );
    this.#update({
      completedStages,
      activeStage: null,
      status: "queued",
      updatedAt: now,
    });
    this.#events.push({
      type: "ProductResearchMoreRequested",
      runId: this.#snapshot.id,
      workspaceId: this.#snapshot.workspaceId,
      fromStage,
      reason,
    });
  }

  pullEvents(): readonly ProductResearchEvent[] {
    return this.#events.splice(0);
  }

  #update(changes: Partial<ProductResearchRunSnapshot>): void {
    this.#snapshot = {
      ...this.#snapshot,
      ...changes,
      version: this.#snapshot.version + 1,
    };
  }
}

export type ResearchCheckpointStatus = "running" | "completed" | "failed" | "invalidated";
export type ResearchCheckpointReview = "machine" | "human_reviewed";

export interface ResearchCheckpoint {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly stage: ResearchStage;
  readonly attempt: number;
  readonly status: ResearchCheckpointStatus;
  readonly review: ResearchCheckpointReview;
  readonly inputHash: string;
  readonly outputHash: string | null;
  readonly output: unknown;
  readonly errorCode: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

export function assertCheckpointReplaceable(checkpoint: ResearchCheckpoint): void {
  if (checkpoint.review === "human_reviewed") {
    throw new ProductResearchInvariantError(
      `Checkpoint ${checkpoint.id} was human-reviewed and cannot be overwritten`,
    );
  }
}
