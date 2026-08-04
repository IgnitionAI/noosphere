import { describe, expect, test } from "bun:test";
import {
  ProductResearchInvariantError,
  ProductResearchRun,
  assertCheckpointReplaceable,
  researchStages,
  v3ResearchStages,
  type ProductResearchBrief,
  type ResearchCheckpoint,
} from "@outbound/domain/gtm/product-research";

const brief: ProductResearchBrief = {
  productUrl: "https://example.com",
  productName: "Example",
  description: "",
  geography: "France",
  languages: ["fr"],
  salesMotion: "saas",
  knownCompetitors: [],
  internalDocumentIds: [],
  depth: "standard",
  audienceGoal: "end_customers",
  buyerConstraints: "Exclude organizations that prefer to build the product internally.",
  researchVersion: 2,
};

describe("ProductResearchRun", () => {
  test("the current workflow discovers buyer landscapes before synthesizing segments", () => {
    expect(researchStages).toEqual([
      "product_analysis",
      "competitor_discovery",
      "competitor_analysis",
      "buyer_landscape_discovery",
      "segment_synthesis",
      "icp_synthesis",
      "evidence_review",
    ]);
  });

  test("legacy runs keep their original six-stage workflow", () => {
    const now = new Date("2026-07-24T10:00:00.000Z");
    const run = ProductResearchRun.create({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      brief: { ...brief, researchVersion: 1 },
      now,
    });
    expect(run.workflowStages()).not.toContain("buyer_landscape_discovery");
    expect(run.workflowStages()).toHaveLength(6);
  });

  test("V3 uses the evidence-led workflow and completes without human review", () => {
    const now = new Date("2026-08-02T10:00:00.000Z");
    const run = ProductResearchRun.create({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      brief: { ...brief, researchVersion: 3 },
      now,
    });

    expect(run.workflowStages()).toEqual(v3ResearchStages);
    run.start(now);
    expect(run.snapshot.executionStartedAt).toBeNull();
    expect(run.snapshot.deadlineAt).toBeNull();
    const executionStartedAt = new Date(now.getTime() + 90_000);
    for (const stage of v3ResearchStages) {
      run.beginStage(stage, executionStartedAt);
      run.completeStage(stage, executionStartedAt);
    }

    expect(run.snapshot.status).toBe("completed");
    expect(run.snapshot.executionStartedAt).toEqual(executionStartedAt);
    expect(run.snapshot.deadlineAt).toEqual(
      new Date(executionStartedAt.getTime() + 60 * 60_000),
    );
    expect(run.pullEvents().at(-1)).toMatchObject({
      type: "ProductResearchCompleted",
      outcome: "completed",
    });
  });

  test("V3 gives K3 max reasoning a depth-aware global deadline", () => {
    const now = new Date("2026-08-02T10:00:00.000Z");
    const expectedMinutes = { quick: 30, standard: 60, deep: 90 } as const;

    for (const [depth, minutes] of Object.entries(expectedMinutes)) {
      const run = ProductResearchRun.create({
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        brief: { ...brief, depth: depth as ProductResearchBrief["depth"], researchVersion: 3 },
        now,
      });
      run.start(now);
      run.beginStage("product_truth", now);
      expect(run.snapshot.deadlineAt).toEqual(new Date(now.getTime() + minutes * 60_000));
    }
  });

  test("V3 can finish with an honest partial report", () => {
    const now = new Date("2026-08-02T10:00:00.000Z");
    const run = ProductResearchRun.create({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      brief: { ...brief, researchVersion: 3 },
      now,
    });
    run.start(now);
    for (const stage of v3ResearchStages) {
      run.beginStage(stage, now);
      run.completeStage(
        stage,
        now,
        stage === "objective_ranking" ? "partial" : "completed",
      );
    }
    expect(run.snapshot.status).toBe("partial");
  });

  test("V3 budget exhaustion terminates as a reportable partial run", () => {
    const now = new Date("2026-08-02T10:00:00.000Z");
    const run = ProductResearchRun.create({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      brief: { ...brief, researchVersion: 3 },
      now,
    });
    run.start(now);
    run.beginStage("product_truth", now);
    run.completeStage("product_truth", now);
    run.beginStage("problem_mapping", now);

    run.finishPartial("problem_mapping", "RESEARCH_BUDGET_EXHAUSTED", now);

    expect(run.snapshot).toMatchObject({
      status: "partial",
      activeStage: null,
      completedStages: ["product_truth"],
    });
    expect(run.pullEvents().at(-1)).toMatchObject({
      type: "ProductResearchCompleted",
      outcome: "partial",
    });
  });

  test("only the final V3 stage may declare a partial outcome", () => {
    const now = new Date("2026-08-02T10:00:00.000Z");
    const run = ProductResearchRun.create({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      brief: { ...brief, researchVersion: 3 },
      now,
    });
    run.start(now);
    run.beginStage("product_truth", now);
    expect(() => run.completeStage("product_truth", now, "partial")).toThrow(
      "Only the final V3 stage",
    );
  });

  test("enforces ordered, resumable stages and becomes ready only after evidence review", () => {
    const now = new Date("2026-07-24T10:00:00.000Z");
    const run = ProductResearchRun.create({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      brief,
      now,
    });

    run.start(now);
    expect(run.snapshot.status).toBe("queued");
    expect(() => run.beginStage("competitor_discovery", now)).toThrow(ProductResearchInvariantError);

    for (const stage of researchStages) {
      run.beginStage(stage, now);
      run.completeStage(stage, now);
    }

    expect(run.snapshot.status).toBe("ready_for_review");
    expect(run.snapshot.completedStages).toEqual(researchStages);
    expect(run.pullEvents().at(-1)?.type).toBe("ProductResearchReadyForReview");
  });

  test("pause is idempotent and prevents stage execution until resume", () => {
    const now = new Date("2026-07-24T10:00:00.000Z");
    const run = ProductResearchRun.create({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      brief,
      now,
    });
    run.start(now);
    run.pause(now);
    run.pause(now);

    expect(run.snapshot.status).toBe("paused");
    expect(() => run.beginStage("product_analysis", now)).toThrow("paused");
    run.resume(now);
    run.resume(now);
    run.beginStage("product_analysis", now);
    expect(run.snapshot.activeStage).toBe("product_analysis");
  });

  test("a failed run resumes from its first incomplete stage", () => {
    const now = new Date("2026-07-24T10:00:00.000Z");
    const run = ProductResearchRun.create({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      brief,
      now,
    });
    run.start(now);
    run.beginStage("product_analysis", now);
    run.failStage("product_analysis", "MODEL_PROVIDER_QUOTA_EXHAUSTED", now);

    run.resume(now);

    expect(run.snapshot).toMatchObject({
      status: "queued",
      activeStage: null,
      completedStages: [],
    });
    expect(run.nextStage()).toBe("product_analysis");
    run.beginStage("product_analysis", now);
    expect(run.snapshot.activeStage).toBe("product_analysis");
  });

  test("an interrupted V3 run resumes with a fresh global deadline", () => {
    const now = new Date("2026-08-02T10:00:00.000Z");
    const run = ProductResearchRun.create({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      brief: { ...brief, depth: "quick", researchVersion: 3 },
      now,
    });
    run.start(now);
    run.beginStage("product_truth", now);
    run.completeStage("product_truth", now);
    run.beginStage("problem_mapping", now);
    run.interrupt("problem_mapping", "RESEARCH_BUDGET_EXHAUSTED", now);

    const resumedAt = new Date(now.getTime() + 5 * 60_000);
    run.resume(resumedAt);

    expect(run.snapshot.status).toBe("queued");
    expect(run.snapshot.activeStage).toBeNull();
    expect(run.snapshot.deadlineAt).toEqual(
      new Date(resumedAt.getTime() + 30 * 60_000),
    );
    expect(run.nextStage()).toBe("problem_mapping");
  });

  test("a human-reviewed checkpoint cannot be overwritten", () => {
    const checkpoint: ResearchCheckpoint = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      stage: "product_analysis",
      attempt: 1,
      status: "completed",
      review: "human_reviewed",
      inputHash: "input",
      outputHash: "output",
      output: {},
      errorCode: null,
      startedAt: new Date(),
      completedAt: new Date(),
    };

    expect(() => assertCheckpointReplaceable(checkpoint)).toThrow("human-reviewed");
  });
});
