export type CampaignAutopilotHealth = "working" | "healthy" | "attention" | "paused" | "completed";

export interface CampaignAutopilotException {
  readonly code: string;
  readonly message: string;
  readonly count: number;
  readonly lastOccurredAt: Date | null;
}

export interface CampaignAutopilotDashboard {
  readonly campaignId: string;
  readonly health: CampaignAutopilotHealth;
  readonly currentStep: "research" | "enrichment" | "composition" | "outreach" | "setter" | "meeting" | "completed" | "attention";
  readonly counts: {
    readonly discovered: number;
    readonly eligible: number;
    readonly enrolled: number;
    readonly scheduled: number;
    readonly sent: number;
    readonly replies: number;
    readonly setterReplies: number;
    readonly offeredMeetings: number;
    readonly bookedMeetings: number;
  };
  readonly exceptions: readonly CampaignAutopilotException[];
  readonly updatedAt: Date;
}

export function deriveAutopilotHealth(input: {
  readonly campaignStatus: string;
  readonly automationStage: string;
  readonly exceptionCount: number;
}): CampaignAutopilotHealth {
  if (input.exceptionCount > 0 || input.automationStage === "attention") return "attention";
  if (input.campaignStatus === "paused") return "paused";
  if (input.campaignStatus === "completed" || input.automationStage === "completed") return "completed";
  if (["sourcing", "enriching", "composing", "scheduled"].includes(input.automationStage)) return "working";
  return "healthy";
}

export function deriveAutopilotStep(input: {
  readonly automationStage: string;
  readonly replies: number;
  readonly offeredMeetings: number;
  readonly bookedMeetings: number;
}): CampaignAutopilotDashboard["currentStep"] {
  if (input.automationStage === "attention") return "attention";
  if (input.bookedMeetings > 0 || input.offeredMeetings > 0) return "meeting";
  if (input.replies > 0) return "setter";
  if (["running", "scheduled"].includes(input.automationStage)) return "outreach";
  if (input.automationStage === "composing") return "composition";
  if (input.automationStage === "enriching") return "enrichment";
  if (input.automationStage === "completed") return "completed";
  return "research";
}
