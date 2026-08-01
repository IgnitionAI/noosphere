import { describe, expect, test } from "bun:test";
import {
  ProductResearchInvariantError,
  ProductResearchRun,
  assertCheckpointReplaceable,
  researchStages,
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
