import { describe, expect, test } from "bun:test";
import { deriveCampaignExecutionState } from "@outbound/domain/campaigns/campaign-automation-health";

describe("deriveCampaignExecutionState", () => {
  test("keeps a campaign in attention while any delivery remains failed", () => {
    expect(deriveCampaignExecutionState({
      pendingActionCount: 4,
      latestFailedAction: {
        code: "UNIPILE_NETWORK_UNKNOWN",
        message: "Delivery state is unknown",
      },
    })).toEqual({
      campaignStatus: "active",
      automationStage: "attention",
      automationErrorCode: "UNIPILE_NETWORK_UNKNOWN",
      automationErrorMessage: "Delivery state is unknown",
    });
  });

  test("returns to running only when no failed delivery remains", () => {
    expect(deriveCampaignExecutionState({
      pendingActionCount: 4,
      latestFailedAction: null,
    })).toEqual({
      campaignStatus: "active",
      automationStage: "running",
      automationErrorCode: null,
      automationErrorMessage: null,
    });
  });

  test("completes a campaign after its last healthy action", () => {
    expect(deriveCampaignExecutionState({
      pendingActionCount: 0,
      latestFailedAction: null,
    })).toEqual({
      campaignStatus: "completed",
      automationStage: "completed",
      automationErrorCode: null,
      automationErrorMessage: null,
    });
  });
});
