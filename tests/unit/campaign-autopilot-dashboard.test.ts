import { describe, expect, test } from "bun:test";
import {
  deriveAutopilotHealth,
  deriveAutopilotStep,
} from "@outbound/application/campaigns/campaign-autopilot-dashboard";

describe("campaign autopilot dashboard", () => {
  test("surfaces technical exceptions before a nominal running state", () => {
    expect(deriveAutopilotHealth({
      campaignStatus: "active",
      automationStage: "running",
      exceptionCount: 1,
    })).toBe("attention");
  });

  test("shows the most advanced observable autonomous step", () => {
    expect(deriveAutopilotStep({
      automationStage: "running",
      replies: 2,
      offeredMeetings: 1,
      bookedMeetings: 0,
    })).toBe("meeting");
    expect(deriveAutopilotStep({
      automationStage: "running",
      replies: 2,
      offeredMeetings: 0,
      bookedMeetings: 0,
    })).toBe("setter");
  });

  test("represents an exhausted empty search as completed rather than broken", () => {
    expect(deriveAutopilotHealth({
      campaignStatus: "active",
      automationStage: "completed",
      exceptionCount: 0,
    })).toBe("completed");
    expect(deriveAutopilotStep({
      automationStage: "completed",
      replies: 0,
      offeredMeetings: 0,
      bookedMeetings: 0,
    })).toBe("completed");
  });
});
