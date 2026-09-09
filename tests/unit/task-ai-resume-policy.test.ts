import { expect, test } from "bun:test";
import { refreshTaskAiPolicyForResume } from "@outbound/infrastructure/ai/task-ai-resume-policy";
import type { ModelRoute } from "@outbound/application/ai/model-gateway";
const primary: ModelRoute = { provider: "openai-api", model: "original-model", reasoningEffort: "low", connectionId: "11111111-1111-4111-8111-111111111111", connectionVersion: 1 };
const policy = { defaultRoutes: [primary], capabilityRoutes: {}, researchModels: [primary.model], synthesisModels: [primary.model] };
test("manual resume refreshes credentials for the same selection without changing pinned model or effort", async () => {
  const refreshed = await refreshTaskAiPolicyForResume(policy, "icp_research", {
    async getReadyRoute() { return { ...primary, reasoningEffort: "high", connectionVersion: 2 }; },
  }, {});
  expect(refreshed.defaultRoutes).toEqual([{ ...primary, connectionVersion: 2 }]);
  expect(policy.defaultRoutes[0]?.connectionVersion).toBe(1);
});
test("revoked or different-provider connections cannot authorize resume", async () => {
  for (const ready of [null, { ...primary, provider: "anthropic" as const }, { ...primary, model: "replacement" }]) {
    await expect(refreshTaskAiPolicyForResume(policy, "icp_research", { async getReadyRoute() { return ready; } }, {})).rejects.toThrow("AI_SETUP_REQUIRED");
  }
});
test("an explicit healthy fallback permits resume while the revoked primary remains blocked", async () => {
  const fallback = { ...primary, connectionId: "22222222-2222-4222-8222-222222222222", model: "fallback" };
  const refreshed = await refreshTaskAiPolicyForResume({ ...policy, defaultRoutes: [primary, fallback] }, "icp_research", {
    async getReadyRoute(input) { return input.connectionId === fallback.connectionId ? { ...fallback, connectionVersion: 3 } : null; },
  }, {});
  expect(refreshed.defaultRoutes).toEqual([primary, { ...fallback, connectionVersion: 3 }]);
});
test("empty snapshots cannot inherit a newly configured environment provider", async () => {
  await expect(refreshTaskAiPolicyForResume({ ...policy, defaultRoutes: [] }, "icp_research", { async getReadyRoute() { return null; } }, { OPENAI_API_KEY: "new-key" })).rejects.toThrow("AI_SETUP_REQUIRED");
});
test("a healthy unrelated capability cannot authorize the paused capability", async () => {
  const other = { ...primary, model: "other" };
  await expect(refreshTaskAiPolicyForResume({ ...policy, capabilityRoutes: { message_generation: [other] } }, "icp_research", {
    async getReadyRoute(input) { return input.model === "other" ? other : null; },
  }, {})).rejects.toThrow("AI_SETUP_REQUIRED");
});
