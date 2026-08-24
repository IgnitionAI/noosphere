import { describe, expect, test } from "bun:test";
import {
  assertTypedConfirmation,
  campaignAutopilotFromWorkspacePolicy,
  defaultWorkspaceDataPolicy,
  retentionWasReduced,
  startOfWorkspaceDay,
  validateWorkspaceDataPolicy,
} from "@outbound/domain/workspaces/workspace-data-policy";

describe("workspace security and data lifecycle policy", () => {
  test("accepts the documented defaults", () => {
    expect(validateWorkspaceDataPolicy(defaultWorkspaceDataPolicy())).toEqual(defaultWorkspaceDataPolicy());
  });

  test("bounds channel limits, sending windows and retention", () => {
    expect(() => validateWorkspaceDataPolicy({ ...defaultWorkspaceDataPolicy(), channelLimits: { linkedin: 0, email: 50, whatsapp: 30 } })).toThrow("WORKSPACE_CHANNEL_LIMIT_INVALID");
    expect(() => validateWorkspaceDataPolicy({ ...defaultWorkspaceDataPolicy(), sending: { ...defaultWorkspaceDataPolicy().sending, windowStart: "18:00", windowEnd: "09:00" } })).toThrow("WORKSPACE_SENDING_WINDOW_INVALID");
    expect(() => validateWorkspaceDataPolicy({ ...defaultWorkspaceDataPolicy(), retention: { ...defaultWorkspaceDataPolicy().retention, invitationsDays: 1 } })).toThrow("WORKSPACE_RETENTION_INVALID");
  });

  test("detects only retention reductions", () => {
    const current = defaultWorkspaceDataPolicy().retention;
    expect(retentionWasReduced(current, { ...current, jobsDays: current.jobsDays - 1 })).toBe(true);
    expect(retentionWasReduced(current, { ...current, jobsDays: current.jobsDays + 1 })).toBe(false);
  });

  test("requires an exact typed confirmation", () => {
    expect(() => assertTypedConfirmation("ANONYMISER", "ANONYMISER")).not.toThrow();
    expect(() => assertTypedConfirmation("anonymiser", "ANONYMISER")).toThrow("TYPED_CONFIRMATION_REQUIRED");
  });

  test("starts daily limits at midnight in the workspace timezone", () => {
    expect(startOfWorkspaceDay(new Date("2026-08-09T22:30:00.000Z"), "Europe/Madrid").toISOString()).toBe("2026-08-09T22:00:00.000Z");
  });

  test("snapshots workspace sending defaults into future campaigns", () => {
    const policy = defaultWorkspaceDataPolicy();
    const campaign = campaignAutopilotFromWorkspacePolicy({
      ...policy,
      sending: { timezone: "Europe/Madrid", activeDays: [1, 2, 3, 4], windowStart: "08:30", windowEnd: "18:30" },
    }, "linkedin");
    expect(campaign.schedule).toMatchObject({ activeDays: [1, 2, 3, 4], windowStart: "08:30", windowEnd: "18:30", fallbackTimezone: "Europe/Madrid" });
  });
});
