import { describe, expect, test } from "bun:test";
import { ProspectMemoryOperationsApplication } from "@outbound/application/prospect-memory/prospect-memory-operations";
import type {
  ProspectMemoryPolicy,
  ProspectMemoryPolicyReader,
  ProspectMemoryPolicyWriter,
} from "@outbound/application/prospect-memory/prospect-memory";

const now = new Date("2026-08-23T14:00:00.000Z");

describe("Prospect 360 rollout settings", () => {
  test("rejects shadow mode when the Setter could send", async () => {
    const app = application();
    await expect(app.updateSettings({
      workspaceId: "workspace-1",
      updatedBy: "operator-1",
      update: {
        ...validShadowUpdate(),
        setterEnabled: true,
      },
    })).rejects.toMatchObject({ code: "PROSPECT_MEMORY_SHADOW_CANNOT_SEND", status: 422 });
  });

  test("rejects activation when no single reviewed provider covers every enabled capability", async () => {
    const app = application();
    const update = validShadowUpdate();
    await expect(app.updateSettings({
      workspaceId: "workspace-1",
      updatedBy: "operator-1",
      update: {
        ...update,
        processingProfiles: [{
          ...update.processingProfiles[0]!,
          allowedCapabilities: ["setter_campaign"],
        }],
      },
    })).rejects.toMatchObject({ code: "PROSPECT_MEMORY_PROCESSING_PROFILE_REQUIRED", status: 422 });
  });

  test("server-stamps reviewedAt and persists a safe shadow policy", async () => {
    const saved: ProspectMemoryPolicy[] = [];
    const app = application(saved);
    const result = await app.updateSettings({
      workspaceId: "workspace-1",
      updatedBy: "operator-1",
      update: validShadowUpdate(),
    });
    expect(saved).toHaveLength(1);
    expect(result.processingProfiles[0]?.reviewedAt).toEqual(now);
    expect(result.flags).toMatchObject({
      prospectMemoryCapture: true,
      prospectMemoryShadow: true,
      prospectMemorySetter: false,
    });
  });
});

function validShadowUpdate() {
  return {
    captureEnabled: true,
    shadowEnabled: true,
    setterEnabled: false,
    enabledCapabilities: ["setter_campaign", "outbound_drafting"] as const,
    processingProfiles: [{
      provider: "codex-cli" as const,
      encryptedInTransit: true as const,
      trainingUse: "none" as const,
      providerRetentionDays: 0,
      regionOrJurisdiction: "EU",
      operatorAccessPolicy: "Restricted support access with audit logs",
      subprocessorsReviewed: true as const,
      deletionProcedure: "Provider deletion request followed by contract expiry",
      personalDataAllowed: true,
      allowedCapabilities: ["setter_campaign", "outbound_drafting"] as const,
    }],
    maxDailySemanticRefreshes: 500,
    maxDailyCostUsd: 5,
  };
}

function application(saved: ProspectMemoryPolicy[] = []) {
  const initial: ProspectMemoryPolicy = {
    flags: {
      prospectMemoryCapture: false,
      prospectMemoryShadow: false,
      prospectMemorySetter: false,
      enabledCapabilities: [],
    },
    processingProfiles: [],
    maxDailySemanticRefreshes: 0,
    maxDailyCostUsd: 0,
  };
  const policies: ProspectMemoryPolicyReader & ProspectMemoryPolicyWriter = {
    find: async () => saved.at(-1) ?? initial,
    save: async (input) => {
      saved.push(input.policy);
      return input.policy;
    },
  };
  return new ProspectMemoryOperationsApplication(
    {} as never,
    {} as never,
    {} as never,
    policies,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { now: () => now },
  );
}
