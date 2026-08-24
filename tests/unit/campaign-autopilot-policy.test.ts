import { describe, expect, test } from "bun:test";
import {
  defaultCampaignAutopilotPolicy,
  mergeCampaignAutopilotPolicy,
  nextAllowedCampaignSendAt,
  recipientTimezoneFromEvidence,
  resolveCampaignAutopilotPolicy,
} from "@outbound/domain/campaigns/campaign-autopilot-policy";

describe("campaign autopilot policy", () => {
  test("defaults new campaigns to dry-run and requires an explicit live mode", () => {
    expect(defaultCampaignAutopilotPolicy("email").executionMode).toBe("dry_run");
    expect(resolveCampaignAutopilotPolicy({ executionMode: "live" }, "email").executionMode).toBe("live");
    expect(resolveCampaignAutopilotPolicy({ executionMode: "unknown" }, "email").executionMode).toBe("dry_run");
  });
  test("uses a recipient-timezone weekday window by default", () => {
    const policy = defaultCampaignAutopilotPolicy("email");

    expect(policy.schedule).toEqual({
      activeDays: [1, 2, 3, 4, 5],
      windowStart: "09:00",
      windowEnd: "17:00",
      timezoneMode: "recipient",
      fallbackTimezone: "Europe/Paris",
    });
    expect(policy.email.followUpDelaysBusinessDays).toEqual([4, 10]);
    expect(policy.email.autoReplyEnabled).toBe(true);
    expect(policy.email.stopOnHumanActivity).toBe(true);
  });

  test("keeps an in-window send immediate and moves an evening send to Monday morning", () => {
    const schedule = defaultCampaignAutopilotPolicy("email").schedule;
    expect(nextAllowedCampaignSendAt({
      from: new Date("2026-08-07T10:00:00.000Z"),
      delayBusinessDays: 0,
      schedule,
      recipientTimezone: "Europe/Paris",
    }).toISOString()).toBe("2026-08-07T10:00:00.000Z");
    expect(nextAllowedCampaignSendAt({
      from: new Date("2026-08-07T17:30:00.000Z"),
      delayBusinessDays: 0,
      schedule,
      recipientTimezone: "Europe/Paris",
    }).toISOString()).toBe("2026-08-10T07:00:00.000Z");
  });

  test("counts follow-up delays in active business days", () => {
    const schedule = defaultCampaignAutopilotPolicy("email").schedule;
    expect(nextAllowedCampaignSendAt({
      from: new Date("2026-08-07T10:00:00.000Z"),
      delayBusinessDays: 4,
      schedule,
      recipientTimezone: "Europe/Paris",
    }).toISOString()).toBe("2026-08-13T07:00:00.000Z");
  });

  test("normalizes untrusted persisted settings and timezone evidence", () => {
    const policy = resolveCampaignAutopilotPolicy({
      schedule: { activeDays: [1, 3, 9], windowStart: "08:30", fallbackTimezone: "bad-zone" },
      email: { followUpDelaysBusinessDays: [3, -1, 9], replyDelayMinutes: 5, stopOnHumanActivity: false },
    }, "email");

    expect(policy.schedule.activeDays).toEqual([1, 3]);
    expect(policy.schedule.windowStart).toBe("08:30");
    expect(policy.schedule.fallbackTimezone).toBe("Europe/Paris");
    expect(policy.email.followUpDelaysBusinessDays).toEqual([3, 9]);
    expect(policy.email.replyDelayMinutes).toBe(5);
    expect(policy.email.stopOnHumanActivity).toBe(true);
    expect(recipientTimezoneFromEvidence({ timezone: "Europe/Madrid" }, "Europe/Paris")).toBe("Europe/Madrid");
    expect(recipientTimezoneFromEvidence({ timezone: "invalid" }, "Europe/Paris")).toBe("Europe/Paris");
  });

  test("merges a narrow campaign override without erasing inherited defaults", () => {
    const policy = mergeCampaignAutopilotPolicy(
      defaultCampaignAutopilotPolicy("email"),
      { schedule: { windowStart: "10:00" }, email: { replyDelayMinutes: 0 } },
      "email",
    );

    expect(policy.schedule.windowStart).toBe("10:00");
    expect(policy.schedule.windowEnd).toBe("17:00");
    expect(policy.email.replyDelayMinutes).toBe(0);
    expect(policy.email.followUpDelaysBusinessDays).toEqual([4, 10]);
  });
});
