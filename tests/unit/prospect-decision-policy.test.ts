import { describe, expect, test } from "bun:test";
import { evaluateProspectDecisionPolicy } from "@outbound/domain/campaigns/prospect-decision-policy";

const now = new Date("2026-08-13T10:00:00.000Z");
const send = {
  observation: "Aucune réponse n’a été reçue.",
  action: "send" as const,
  reason: "La relance prévue est arrivée à échéance.",
  nextDueAt: null,
  nextReason: null,
};

describe("prospect decision policy", () => {
  test("turns dry-run sends into approvals and lets explicit live campaigns proceed", () => {
    const base = {
      contactStatus: "active",
      suppressed: false,
      outreachAction: { status: "scheduled", dueAt: now },
      now,
    };
    expect(evaluateProspectDecisionPolicy({ ...base, campaign: { status: "active", executionMode: "dry_run" } }, send))
      .toEqual({ allowed: true, requiresApproval: true, executeAt: now });
    expect(evaluateProspectDecisionPolicy({ ...base, campaign: { status: "active", executionMode: "live" } }, send))
      .toEqual({ allowed: true, requiresApproval: false, executeAt: now });
  });

  test("blocks suppression, inactive campaigns and actions that are no longer sendable", () => {
    const base = { contactStatus: "active", suppressed: false, campaign: { status: "active", executionMode: "live" as const }, outreachAction: { status: "scheduled", dueAt: now }, now };
    expect(evaluateProspectDecisionPolicy({ ...base, suppressed: true }, send)).toMatchObject({ allowed: false, code: "PROSPECT_SUPPRESSED" });
    expect(evaluateProspectDecisionPolicy({ ...base, campaign: { ...base.campaign, status: "paused" } }, send)).toMatchObject({ allowed: false, code: "CAMPAIGN_NOT_ACTIVE" });
    expect(evaluateProspectDecisionPolicy({ ...base, outreachAction: { status: "cancelled", dueAt: now } }, send)).toMatchObject({ allowed: false, code: "OUTREACH_ACTION_NOT_SENDABLE" });
  });
});
