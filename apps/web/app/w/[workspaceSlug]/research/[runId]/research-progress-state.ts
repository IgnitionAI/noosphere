import type { ResearchRun } from "../../../../../lib/api";

type ResearchProgress = Pick<ResearchRun, "status" | "brief" | "completedStages">;

export function isResearchReportReady(run: ResearchProgress): boolean {
  if (!["ready_for_review", "completed", "partial"].includes(run.status)) return false;
  if (run.brief.researchVersion === 3) {
    return run.completedStages.includes("objective_ranking");
  }
  return run.completedStages.includes("evidence_review");
}

export function canResumeIncompleteResearch(run: ResearchProgress): boolean {
  if (run.status === "failed" || run.status === "interrupted") return true;
  return run.status === "partial" && !isResearchReportReady(run);
}
