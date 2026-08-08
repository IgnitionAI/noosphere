export const OPPORTUNITY_STAGES = [
  "qualified",
  "meeting_requested",
  "meeting_booked",
  "meeting_no_show",
  "meeting_completed",
  "won",
  "lost",
] as const;

export type OpportunityStage = typeof OPPORTUNITY_STAGES[number];
export type PipelineColumn = "qualified" | "meeting" | "follow_up" | "closed";

export function isOpportunityStage(value: unknown): value is OpportunityStage {
  return typeof value === "string" && (OPPORTUNITY_STAGES as readonly string[]).includes(value);
}

export function canTransitionOpportunity(from: OpportunityStage, to: OpportunityStage): boolean {
  if (from === to) return false;
  if (from === "won" || from === "lost") return to === "qualified";
  return true;
}

export function pipelineColumn(stage: string): PipelineColumn {
  if (stage === "meeting_requested" || stage === "meeting_booked") return "meeting";
  if (stage === "meeting_no_show" || stage === "meeting_completed") return "follow_up";
  if (stage === "won" || stage === "lost") return "closed";
  return "qualified";
}

export function opportunityStageLabel(stage: string): string {
  return ({
    qualified: "Qualifié",
    meeting_requested: "Rendez-vous demandé",
    meeting_booked: "Rendez-vous réservé",
    meeting_no_show: "À replanifier",
    meeting_completed: "Rendez-vous terminé",
    won: "Gagné",
    lost: "Perdu",
  } as Record<string, string>)[stage] ?? "Étape inconnue";
}
