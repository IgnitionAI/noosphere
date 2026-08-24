import { describe, expect, test } from "bun:test";
import type { ProspectDecisionState } from "@outbound/application/campaigns/prospect-decision";
import { LangChainProspectDecisionAgent } from "@outbound/infrastructure/campaigns/langchain-prospect-decision-agent";
import type { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

describe("Prospect decision Prospect 360 boundary", () => {
  test("sends the scoring context only to the approved provider and withholds receipt authority", async () => {
    let invocation: { payload: unknown; allowedProviders?: readonly string[] } | undefined;
    const routedModel = {
      invoke: async (input: { payload: unknown; allowedProviders?: readonly string[] }) => {
        invocation = input;
        return {
          output: {
            observation: "Le prospect a déjà refusé ce sujet.",
            action: "stop",
            reason: "Refus explicite mémorisé.",
            nextDueAt: null,
            nextReason: null,
          },
        };
      },
    } as unknown as WorkspaceStructuredModel;
    const agent = new LangChainProspectDecisionAgent(
      { AI_PROVIDER: "codex-cli", CODEX_SERVICE_HOME: "/tmp/codex-test" },
      undefined,
      routedModel,
    );

    const result = await agent.decide(decisionState());

    expect(result.action).toBe("stop");
    expect(invocation?.allowedProviders).toEqual(["codex-cli"]);
    expect(invocation?.payload).toHaveProperty("prospectContext");
    expect(invocation?.payload).not.toHaveProperty("prospectContextReference");
    expect(invocation?.payload).not.toHaveProperty("prospectContextAllowedProviders");
  });
});

function decisionState(): ProspectDecisionState {
  return {
    workspaceId: "workspace-1",
    decisionId: "decision-1",
    kind: "recheck",
    reason: "Évaluer la prochaine action",
    dueAt: new Date("2026-08-23T10:00:00.000Z"),
    contact: { id: "contact-1", name: "Marie", status: "active" },
    campaign: null,
    outreachAction: null,
    latestMessages: [],
    sentTouches: 0,
    suppressed: false,
    socialSignalAssessment: {
      evaluatedAt: new Date("2026-08-23T10:00:00.000Z"),
      baseScore: null,
      socialBoost: 0,
      effectiveScore: null,
      eligibleSignals: [],
      ignoredSignals: [],
      openLinkedinConversation: false,
      decisionImpact: "none",
    },
    prospectContext: { memory: { commercialState: { doNotRepeat: ["Refus explicite"] } } },
    prospectContextReference: {
      receiptId: "receipt-1",
      snapshotId: "snapshot-1",
      snapshotVersion: 1,
      watermark: 20,
      privacyEpoch: 0,
    },
    prospectContextAllowedProviders: ["codex-cli"],
  };
}
