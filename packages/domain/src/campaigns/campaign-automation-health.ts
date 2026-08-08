export interface FailedCampaignAction {
  readonly code: string | null;
  readonly message: string | null;
}

export function deriveCampaignExecutionState(input: {
  readonly pendingActionCount: number;
  readonly latestFailedAction: FailedCampaignAction | null;
}) {
  if (input.latestFailedAction) {
    return {
      campaignStatus: "active" as const,
      automationStage: "attention" as const,
      automationErrorCode: input.latestFailedAction.code ?? "OUTREACH_DELIVERY_FAILED",
      automationErrorMessage: input.latestFailedAction.message ?? "Un envoi de la campagne a échoué.",
    };
  }
  if (input.pendingActionCount > 0) {
    return {
      campaignStatus: "active" as const,
      automationStage: "running" as const,
      automationErrorCode: null,
      automationErrorMessage: null,
    };
  }
  return {
    campaignStatus: "completed" as const,
    automationStage: "completed" as const,
    automationErrorCode: null,
    automationErrorMessage: null,
  };
}
