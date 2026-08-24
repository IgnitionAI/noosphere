import { describe, expect, test } from "bun:test";
import { createProspectMemoryHttpHandler } from "@outbound/interface/http/prospect-memory-handler";

const workspaceId = "00000000-0000-4000-8000-000000000901";
const userId = "00000000-0000-4000-8000-000000000902";
const contactId = "00000000-0000-4000-8000-000000000903";
const requestKey = "00000000-0000-4000-8000-000000000904";

describe("Prospect 360 memory HTTP", () => {
  test("exposes status and a capability-scoped progressive view without a send effect", async () => {
    const api = handler("viewer");
    const status = await api(request(`/api/v1/prospects/${contactId}/memory-status`));
    expect(status.status).toBe(200);
    expect((await status.json() as { sentEffect: boolean }).sentEffect).toBe(false);

    const view = await api(request(`/api/v1/prospects/${contactId}/memory-view?capability=call_preparation`));
    expect(view.status).toBe(200);
    const body = await view.json() as { capability: string; sentEffect: boolean; relationshipSummary: string };
    expect(body.capability).toBe("call_preparation");
    expect(body.relationshipSummary).toBe("Le prospect a confirmé un besoin de traçabilité.");
    expect(body.sentEffect).toBe(false);
  });

  test("reserves a durable refresh command for administrators", async () => {
    const body = { requestKey };
    expect((await handler("operator")(request(`/api/v1/prospects/${contactId}/memory/actions/refresh`, "POST", body))).status).toBe(403);
    const response = await handler("owner")(request(`/api/v1/prospects/${contactId}/memory/actions/refresh`, "POST", body));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ inserted: true, sentEffect: false });
  });

  test("rejects a capability that is not authorized for a viewer", async () => {
    const response = await handler("viewer")(request(
      `/api/v1/prospects/${contactId}/memory-view?capability=setter_campaign`,
    ));
    expect(response.status).toBe(403);
  });

  test("keeps activation and rollback admin-only with an explicit processing profile", async () => {
    const update = {
      captureEnabled: true,
      shadowEnabled: true,
      setterEnabled: false,
      enabledCapabilities: ["setter_campaign"],
      processingProfiles: [{
        provider: "codex-cli",
        encryptedInTransit: true,
        trainingUse: "none",
        providerRetentionDays: 0,
        regionOrJurisdiction: "EU",
        operatorAccessPolicy: "Restricted support access with audit logs",
        subprocessorsReviewed: true,
        deletionProcedure: "Provider deletion request followed by contract expiry",
        personalDataAllowed: true,
        allowedCapabilities: ["setter_campaign"],
      }],
      maxDailySemanticRefreshes: 100,
      maxDailyCostUsd: 5,
    };
    expect((await handler("operator")(request("/api/v1/workspace/prospect-memory-settings", "PUT", update))).status).toBe(403);
    const response = await handler("owner")(request("/api/v1/workspace/prospect-memory-settings", "PUT", update));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ flags: { prospectMemoryCapture: true, prospectMemoryShadow: true } });
  });

  test("rejects a provider profile that does not document the complete personal-data boundary", async () => {
    const response = await handler("owner")(request("/api/v1/workspace/prospect-memory-settings", "PUT", {
      captureEnabled: true,
      shadowEnabled: true,
      setterEnabled: false,
      enabledCapabilities: ["setter_campaign"],
      processingProfiles: [{
        provider: "codex-cli",
        encryptedInTransit: true,
        trainingUse: "none",
        providerRetentionDays: 0,
        personalDataAllowed: true,
        allowedCapabilities: ["setter_campaign"],
      }],
      maxDailySemanticRefreshes: 100,
      maxDailyCostUsd: 5,
    }));
    expect(response.status).toBe(422);
  });
});

function handler(role: "viewer" | "operator" | "owner") {
  return createProspectMemoryHttpHandler({
    contextResolver: { async resolve() { return { workspaceId, userId, role }; } },
    application: {
      async status() {
        return {
          enabled: true,
          mode: "shadow" as const,
          status: "fresh" as const,
          snapshotId: "snapshot-1",
          snapshotVersion: 1,
          generatedAt: new Date("2026-08-23T08:00:00Z"),
          watermark: 12,
          latestSequence: 12,
          pendingEventCount: 0,
          privacyEpoch: 0,
          job: null,
          sentEffect: false as const,
          asOf: new Date("2026-08-23T08:01:00Z"),
        };
      },
      async view(input) {
        if (input.capability === "setter_campaign" && input.principalRole === "viewer") {
          throw new Error("PROSPECT_MEMORY_CAPABILITY_FORBIDDEN");
        }
        return {
          capability: input.capability,
          mode: "shadow" as const,
          status: "fresh" as const,
          snapshotId: "snapshot-1",
          snapshotVersion: 1,
          generatedAt: new Date("2026-08-23T08:00:00Z"),
          relationshipSummary: "Le prospect a confirmé un besoin de traçabilité.",
          recommendedTone: "direct",
          facts: { confirmedNeeds: [], objections: [], commitments: [], topicsCovered: [], doNotRepeat: [], openQuestions: [] },
          hypotheses: [], recommendations: [], contradictions: [], missingInformation: [],
          automaticActionAllowed: false,
          waitCode: null,
          sourceCount: 3,
          excludedSourceCount: 0,
          estimatedTokens: 120,
          sentEffect: false as const,
          asOf: new Date("2026-08-23T08:01:00Z"),
        };
      },
      async refresh() {
        return { inserted: true, job: null, sentEffect: false as const };
      },
      async settings() {
        return memoryPolicy();
      },
      async updateSettings(input) {
        return {
          ...memoryPolicy(),
          flags: {
            prospectMemoryCapture: input.update.captureEnabled,
            prospectMemoryShadow: input.update.shadowEnabled,
            prospectMemorySetter: input.update.setterEnabled,
            enabledCapabilities: input.update.enabledCapabilities,
          },
        };
      },
    },
  });
}

function memoryPolicy() {
  return {
    flags: {
      prospectMemoryCapture: true,
      prospectMemoryShadow: true,
      prospectMemorySetter: false,
      enabledCapabilities: ["setter_campaign" as const],
    },
    processingProfiles: [],
    maxDailySemanticRefreshes: 100,
    maxDailyCostUsd: 5,
  };
}

function request(pathname: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-workspace-slug": "workspace" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
