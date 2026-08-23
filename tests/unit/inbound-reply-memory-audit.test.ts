import { describe, expect, test } from "bun:test";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";
import { LangChainInboundReplyAgent } from "@outbound/infrastructure/campaigns/langchain-inbound-reply-agent";

describe("LangChainInboundReplyAgent Prospect 360 audit", () => {
  test("records the context receipt and snapshot without giving those references model authority", async () => {
    let modelPayload: unknown;
    let allowedProviders: unknown;
    const routedModel = {
      invoke: async (input: { payload: unknown; allowedProviders?: readonly string[] }) => {
        modelPayload = input.payload;
        allowedProviders = input.allowedProviders;
        return {
          output: {
            intent: "positive",
            confidence: 0.9,
            action: "reply",
            evidence: ["Le prospect demande une précision."],
            resumeAt: null,
            referredPerson: null,
            requiresHuman: false,
            suggestedNextAction: null,
            calendarAction: null,
            selectedSlotStart: null,
            replyBody: "Voici la précision demandée.",
            rationale: "Réponse factuelle.",
            knowledgeClaimIds: [],
            knowledgeSourceIds: [],
          },
          metadata: {
            provider: "codex-cli",
            model: "gpt-5.6-luna",
            reasoningEffort: "xhigh",
            transport: "codex-process",
            usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, source: "unknown" },
            latencyMs: 1,
          },
          providerAttempt: 1,
          fallbackReason: null,
        };
      },
    } as unknown as WorkspaceStructuredModel;
    const recorded: Parameters<AiRunRecorder["record"]>[0][] = [];
    const recorder: AiRunRecorder = {
      record: async (input) => {
        recorded.push(input);
        return { id: "ai-run-1" };
      },
    };
    const agent = new LangChainInboundReplyAgent(
      { AI_PROVIDER: "codex-cli", CODEX_SERVICE_HOME: "/tmp/codex-test" },
      undefined,
      undefined,
      undefined,
      recorder,
      undefined,
      routedModel,
    );

    const decision = await agent.decide({
      workspaceId: "workspace-1",
      channel: "linkedin",
      contactName: "Prospect",
      companyName: "Acme",
      icpName: "Cabinets",
      incomingMessage: "Pouvez-vous préciser ?",
      conversationHistory: [{ direction: "inbound", body: "Pouvez-vous préciser ?" }],
      prospectContext: { memory: { relationshipSummary: "Échange déjà engagé." } },
      prospectContextReference: {
        receiptId: "receipt-42",
        snapshotId: "snapshot-9",
        snapshotVersion: 9,
        watermark: 123,
        privacyEpoch: 2,
        mode: "active",
      },
      prospectContextAllowedProviders: ["codex-cli"],
      instructions: null,
      bookingUrl: null,
    });

    expect(modelPayload).not.toHaveProperty("prospectContextReference");
    expect(modelPayload).not.toHaveProperty("prospectContextAllowedProviders");
    expect(modelPayload).toHaveProperty("prospectContext");
    expect(allowedProviders).toEqual(["codex-cli"]);
    expect(recorded[0]?.output).toMatchObject({
      prospectMemory: {
        receiptId: "receipt-42",
        snapshotId: "snapshot-9",
        snapshotVersion: 9,
        watermark: 123,
        privacyEpoch: 2,
        mode: "active",
      },
    });
    expect(decision.metadata).toMatchObject({
      aiRunId: "ai-run-1",
      memoryReceiptId: "receipt-42",
      memorySnapshotId: "snapshot-9",
      memorySnapshotVersion: 9,
      memoryWatermark: 123,
    });
  });
});
