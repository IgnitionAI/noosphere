export type CampaignStatus = "draft" | "active" | "paused" | "archived";

export type CampaignTransition = "activate" | "pause" | "resume" | "archive";

export interface CampaignSnapshot {
  readonly offerVersionId: string;
  readonly icpVersionId: string;
  readonly messagingStrategyVersionId: string;
  readonly aiPolicyVersionId: string;
  readonly sequenceVersionId: string;
}

export interface CampaignTransitionResult {
  readonly status: CampaignStatus;
  readonly changed: boolean;
}

export function transitionCampaign(
  current: CampaignStatus,
  transition: CampaignTransition,
): CampaignTransitionResult {
  if (transition === "activate") {
    if (current === "active") return { status: current, changed: false };
    if (current !== "draft") throw new Error("CAMPAIGN_ACTIVATION_CONFLICT");
    return { status: "active", changed: true };
  }
  if (transition === "pause") {
    if (current === "paused") return { status: current, changed: false };
    if (current !== "active") throw new Error("CAMPAIGN_PAUSE_CONFLICT");
    return { status: "paused", changed: true };
  }
  if (transition === "resume") {
    if (current === "active") return { status: current, changed: false };
    if (current !== "paused") throw new Error("CAMPAIGN_RESUME_CONFLICT");
    return { status: "active", changed: true };
  }
  if (current === "archived") return { status: current, changed: false };
  if (current !== "active" && current !== "paused" && current !== "draft") {
    throw new Error("CAMPAIGN_ARCHIVE_CONFLICT");
  }
  return { status: "archived", changed: true };
}

export function assertCampaignDraft(status: CampaignStatus): void {
  if (status !== "draft") throw new Error("CAMPAIGN_SNAPSHOT_IMMUTABLE");
}
