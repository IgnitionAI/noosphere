import { describe, expect, test } from "bun:test";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import { DeterministicProspectMemoryShadowComparator } from "@outbound/application/prospect-memory/prospect-memory-shadow-comparator";
import type { ProspectContextBundle } from "@outbound/domain/prospect-memory/prospect-memory";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";

const comparedAt = new Date("2026-08-23T12:00:00.000Z");

describe("ProspectMemoryShadowComparator", () => {
  test("records a PII-free deterministic comparison and never authorizes an effect", async () => {
    const recorded: Parameters<AiRunRecorder["record"]>[0][] = [];
    const comparator = new DeterministicProspectMemoryShadowComparator({
      record: async (input) => {
        recorded.push(input);
        return { id: "ai-run-shadow-1" };
      },
    }, new Sha256ContentHasher());

    const result = await comparator.compare({
      workspaceId: "workspace-1",
      contactId: "contact-sensitive-id",
      requestKey: "shadow:setter:1",
      legacyHistory: [{ direction: "inbound", body: "Mon budget secret est déjà engagé.", sourceId: "message-recent" }],
      memory: shadowBundle(),
      comparedAt,
    });

    expect(result).toEqual({ aiRunId: "ai-run-shadow-1" });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.purpose).toBe("prospect_memory_shadow_comparison");
    expect(recorded[0]?.shadow).toBe(true);
    expect(recorded[0]?.cost).toBe(0);
    expect(JSON.stringify(recorded[0]?.output)).not.toContain("budget secret");
    expect(JSON.stringify(recorded[0]?.output)).not.toContain("contact-sensitive-id");
    expect(recorded[0]?.output).toMatchObject({
      receiptId: "receipt-1",
      legacyMessageCount: 1,
      legacySourceCount: 1,
      memorySourceCount: 2,
      automaticActionAllowed: false,
      criticalCounts: { objections: 1, commitments: 0 },
      criticalSourceCount: 1,
      legacyCoveredCriticalSourceCount: 0,
      memoryOnlyCriticalSourceCount: 1,
      legacyCoverageMeasurable: true,
    });
  });

  test("rejects an active bundle so shadow measurement cannot be mistaken for execution", async () => {
    const comparator = new DeterministicProspectMemoryShadowComparator({
      record: async () => ({ id: "unused" }),
    }, new Sha256ContentHasher());
    await expect(comparator.compare({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      requestKey: "invalid-active",
      legacyHistory: [],
      memory: { ...shadowBundle(), mode: "active", automaticActionAllowed: true },
      comparedAt,
    })).rejects.toThrow("PROSPECT_MEMORY_SHADOW_COMPARISON_INVALID");
  });
});

function shadowBundle(): ProspectContextBundle {
  return {
    workspaceId: "workspace-1",
    contactId: "contact-1",
    capability: "setter_campaign",
    mode: "shadow",
    status: "fresh",
    snapshotId: "snapshot-1",
    snapshotVersion: 3,
    receiptId: "receipt-1",
    watermark: 42,
    privacyEpoch: 0,
    assembledAt: comparedAt,
    currentState: {
      displayName: "Prospect",
      companyName: "Acme",
      jobTitle: null,
      locale: "fr",
      availableChannels: ["linkedin"],
      suppressed: false,
      anonymized: false,
      activeCampaignIds: [],
      activeDecisionId: null,
    },
    activeDecisionId: null,
    context: {
      memory: {
        commercialState: {
          confirmedNeeds: [],
          objections: [{ eventId: "event-old", sourceId: "message-old" }],
          commitments: [],
          topicsCovered: [],
          doNotRepeat: [{ eventId: "event-old", sourceId: "message-old" }],
          openQuestions: [],
        },
        contradictions: [],
      },
    },
    sourceEventIds: ["event-old", "event-new"],
    excludedSourceEventIds: [],
    estimatedTokens: 120,
    automaticActionAllowed: false,
    waitCode: null,
  };
}
