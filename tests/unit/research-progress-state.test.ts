import { describe, expect, test } from "bun:test";
import type { ResearchRun } from "../../apps/web/lib/api";
import {
  canResumeIncompleteResearch,
  isResearchReportReady,
} from "../../apps/web/app/w/[workspaceSlug]/research/[runId]/research-progress-state";

function run(
  status: ResearchRun["status"],
  completedStages: readonly string[],
): Pick<ResearchRun, "status" | "brief" | "completedStages"> {
  return {
    status,
    completedStages,
    brief: { researchVersion: 3 } as ResearchRun["brief"],
  };
}

describe("research progress state", () => {
  test("does not advertise an early budget stop as an ICP report", () => {
    const stopped = run("partial", ["product_truth", "problem_mapping"]);

    expect(isResearchReportReady(stopped)).toBe(false);
    expect(canResumeIncompleteResearch(stopped)).toBe(true);
  });

  test("accepts an honest partial result only after objective ranking", () => {
    const ranked = run("partial", [
      "product_truth",
      "problem_mapping",
      "organization_discovery",
      "market_investigation",
      "buying_context",
      "sourcing_validation",
      "icp_composition",
      "adversarial_review",
      "objective_ranking",
    ]);

    expect(isResearchReportReady(ranked)).toBe(true);
    expect(canResumeIncompleteResearch(ranked)).toBe(false);
  });
});
