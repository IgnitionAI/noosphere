import { describe, expect, test } from "bun:test";
import { LangChainProspectMemorySynthesizer } from "@outbound/infrastructure/prospect-memory/langchain-prospect-memory-synthesizer";
import type { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";
import type { ProspectMemorySourceMaterial } from "@outbound/application/prospect-memory/prospect-memory";
import { PROSPECT_MEMORY_EVENT_SCHEMA_VERSION } from "@outbound/domain/prospect-memory/prospect-memory";

const now = new Date("2026-08-23T12:00:00.000Z");

describe("LangChainProspectMemorySynthesizer audit mode", () => {
  test.each([true, false])("records the effective shadow mode (%s)", async (shadow) => {
    const recorded: Array<Record<string, unknown>> = [];
    const synthesizer = new LangChainProspectMemorySynthesizer(
      {
        invoke: async () => ({
          output: {
            classifications: [{ eventId: "event-1", categories: ["commitment"] }],
            assertions: [],
            relationshipSummary: "Le prospect a confirmé le rendez-vous.",
            recommendedTone: "direct",
            contradictions: [],
            missingInformation: [],
          },
          metadata: {
            provider: "codex-cli",
            model: "gpt-5.6-luna",
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
          },
          providerAttempt: 1,
          fallbackReason: null,
        }),
      } as unknown as WorkspaceStructuredModel,
      {
        record: async (input) => {
          recorded.push(input);
          return { id: "ai-run-1" };
        },
      },
      { hash: async () => "a".repeat(64) },
      () => now,
    );

    await synthesizer.synthesize({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      requestKey: `memory-${shadow}`,
      materials: [material()],
      previousSnapshot: null,
      allowedProviders: ["codex-cli"],
      shadow,
      deadlineAt: new Date(now.getTime() + 60_000),
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ purpose: "prospect_memory", shadow });
  });
});

function material(): ProspectMemorySourceMaterial {
  return {
    event: {
      id: "event-1",
      sequenceId: 1,
      workspaceId: "workspace-1",
      sourceContactId: "contact-1",
      canonicalContactId: "contact-1",
      sourceKind: "message",
      sourceId: "message-1",
      sourceVersion: 1,
      kind: "message_received",
      occurredAt: now,
      observedAt: now,
      validFrom: now,
      validTo: null,
      supersedesEventId: null,
      payload: { direction: "inbound", channel: "linkedin" },
      schemaVersion: PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
    },
    content: "Oui, rendez-vous confirmé.",
    language: "fr",
    sourceHash: "b".repeat(64),
  };
}
