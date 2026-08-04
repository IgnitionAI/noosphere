import { describe, expect, test } from "bun:test";
import {
  deriveProspectEngagementState,
  isActionableCampaignException,
  isHotProspectState,
} from "@outbound/application/campaigns/campaign-engagement";

const base = {
  sent: false,
  replied: false,
  intent: null,
  action: null,
  opportunityStage: null,
} as const;

describe("campaign engagement projection rules", () => {
  test("uses the most advanced prospect state with deterministic precedence", () => {
    expect(deriveProspectEngagementState(base)).toBe("not_contacted");
    expect(deriveProspectEngagementState({ ...base, sent: true })).toBe("sent");
    expect(deriveProspectEngagementState({ ...base, sent: true, replied: true })).toBe("replied");
    expect(deriveProspectEngagementState({ ...base, replied: true, intent: "positive" })).toBe("qualified");
    expect(deriveProspectEngagementState({ ...base, replied: true, intent: "not_interested", action: "stop" })).toBe("refused");
    expect(deriveProspectEngagementState({ ...base, replied: true, intent: "meeting_request", action: "booking" })).toBe("meeting");
  });

  test("counts only qualified and meeting prospects as hot", () => {
    expect(isHotProspectState("qualified")).toBe(true);
    expect(isHotProspectState("meeting")).toBe(true);
    expect(isHotProspectState("replied")).toBe(false);
  });

  test("does not present an empty sourcing result as a technical exception", () => {
    expect(isActionableCampaignException({ automationStage: "attention", automationErrorCode: "NO_PROSPECTS_FOUND" })).toBe(false);
    expect(isActionableCampaignException({ automationStage: "attention", automationErrorCode: "PROVIDER_UNAVAILABLE" })).toBe(true);
  });
});
