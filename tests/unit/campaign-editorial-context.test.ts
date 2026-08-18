import { describe, expect, test } from "bun:test";
import {
  campaignStepObjective,
  mergeCampaignMessageHistory,
  requiresEditorialRegeneration,
} from "@outbound/domain/campaigns/campaign-editorial-context";

describe("campaignStepObjective", () => {
  test("gives an email follow-up a distinct, non-repetitive objective", () => {
    expect(campaignStepObjective({
      channel: "email",
      kind: "email",
      position: 2,
      totalSteps: 3,
    })).toEqual({
      stage: "follow_up",
      objective: "Ajouter un angle utile qui n’apparaît pas dans les messages précédents et obtenir une réponse simple, sans répéter l’ouverture.",
    });
  });

  test("merges sent campaign touches and conversation messages chronologically without duplicates", () => {
    expect(mergeCampaignMessageHistory([
      { direction: "outbound", body: "Bonjour Marie", occurredAt: new Date("2026-08-01T09:00:00Z"), source: "campaign" },
      { direction: "inbound", body: "Bonjour Marie", occurredAt: new Date("2026-08-01T09:00:00Z"), source: "conversation" },
      { direction: "inbound", body: "Pas maintenant", occurredAt: new Date("2026-08-02T10:00:00Z"), source: "conversation" },
    ])).toEqual([
      { direction: "outbound", body: "Bonjour Marie", occurredAt: "2026-08-01T09:00:00.000Z", source: "campaign" },
      { direction: "inbound", body: "Pas maintenant", occurredAt: "2026-08-02T10:00:00.000Z", source: "conversation" },
    ]);
  });

  test("regenerates only pending or legacy unsent content", () => {
    expect(requiresEditorialRegeneration({ generationPending: true, promptVersion: "pending" })).toBe(true);
    expect(requiresEditorialRegeneration({ generationPending: false, promptVersion: "campaign-personalization-v2-knowledge" })).toBe(true);
    expect(requiresEditorialRegeneration({ generationPending: false, promptVersion: "message-generation-v4" })).toBe(true);
    expect(requiresEditorialRegeneration({ generationPending: false, promptVersion: "campaign-personalization-v3-editorial" })).toBe(false);
    expect(requiresEditorialRegeneration({ generationPending: false, promptVersion: "fixture-personalization-v1" })).toBe(false);
  });
});
