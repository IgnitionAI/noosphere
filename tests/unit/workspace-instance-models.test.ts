import { expect, test } from "bun:test";
import { WorkspaceAiSettingsApplication, type WorkspaceAiModelPolicy, type WorkspaceAiSettingsRepository } from "@outbound/application/workspaces/workspace-ai-settings";
import type { ModelRoute } from "@outbound/application/ai/model-gateway";

test("workspace choices inherit live defaults, preserve overrides and reject unauthorized models", async () => {
  const policies = new Map<string, WorkspaceAiModelPolicy & { updatedAt: Date }>();
  const repository: WorkspaceAiSettingsRepository = { async find(id) { return policies.get(id) ?? null; }, async upsert(input) { const value = { ...input, updatedAt: input.now }; policies.set(input.workspaceId, value); return value; } };
  const a: ModelRoute = { connectionId: "a", provider: "openai-api", model: "model-a", reasoningEffort: "low" };
  const b: ModelRoute = { connectionId: "b", provider: "anthropic", model: "model-b", reasoningEffort: "low" };
  let current = a;
  const application = new WorkspaceAiSettingsApplication(repository, { researchModels: [], synthesisModels: [], defaultRoutes: [] }, () => new Date(), {
    async getDefault() { return current; }, async listAllowed() { return [a, b].map((route) => ({ ...route, connectionName: route.connectionId! })); },
  });
  expect(await application.get("one")).toMatchObject({ source: "instance", defaultRoutes: [], effectiveDefaultRoutes: [a] });
  await application.update({ workspaceId: "two", userId: "admin", defaultRoutes: [b], capabilityRoutes: {} });
  current = b;
  expect((await application.get("one")).effectiveDefaultRoutes).toEqual([b]);
  expect((await application.get("two")).defaultRoutes).toEqual([b]);
  await application.update({ workspaceId: "two", userId: "admin", defaultRoutes: [], capabilityRoutes: { content_writer: [a] } });
  expect(await application.get("two")).toMatchObject({ source: "instance", defaultRoutes: [], capabilityRoutes: { content_writer: [a] } });
  await expect(application.update({ workspaceId: "one", userId: "admin", defaultRoutes: [{ ...a, model: "not-authorized" }], capabilityRoutes: {} })).rejects.toMatchObject({ code: "AI_MODEL_NOT_AUTHORIZED" });
  await expect(application.update({ workspaceId: "one", userId: "admin", defaultRoutes: [{ provider: "openai-api", model: "model-a", reasoningEffort: "low" }], capabilityRoutes: {} })).rejects.toMatchObject({ code: "AI_MODEL_NOT_AUTHORIZED" });
});

test("runtime merges usage overrides with live defaults and keeps withdrawn choices", async () => {
  const { InstanceWorkspaceAiPolicyReader } = await import("@outbound/infrastructure/ai/instance-ai-runtime");
  const a: ModelRoute & { connectionId: string; connectionVersion: number } = { connectionId: "a", connectionVersion: 2, provider: "openai-api", model: "model-a", reasoningEffort: "low" };
  const b: ModelRoute & { connectionId: string; connectionVersion: number } = { connectionId: "b", connectionVersion: 3, provider: "anthropic", model: "model-b", reasoningEffort: "low" };
  let current = a;
  let authorized = true;
  const selected: ModelRoute = { connectionId: b.connectionId, provider: b.provider, model: b.model, reasoningEffort: b.reasoningEffort };
  const reader = new InstanceWorkspaceAiPolicyReader({ async find() { return { researchModels: [], synthesisModels: [], defaultRoutes: [], capabilityRoutes: { content_writer: [selected] } }; } }, {
    async getConfiguredDefault() { return current; },
    async getReadyRoute(input) { return input.connectionId === "a" ? a : authorized ? b : null; },
  });
  expect(await reader.find("one")).toMatchObject({ defaultRoutes: [a], capabilityRoutes: { content_writer: [b] } });
  current = b;
  expect((await reader.find("one"))?.defaultRoutes).toEqual([b]);
  authorized = false;
  expect((await reader.find("one"))?.capabilityRoutes.content_writer).toEqual([selected]);
});

test("research-only workspace override supplies research candidates without an instance default", async () => {
  const { InstanceWorkspaceAiPolicyReader } = await import("@outbound/infrastructure/ai/instance-ai-runtime");
  const route = { connectionId: "research", connectionVersion: 1, provider: "openai-api" as const, model: "research-model", reasoningEffort: "low" as const };
  const reader = new InstanceWorkspaceAiPolicyReader({ async find() { return { researchModels: [], synthesisModels: [], capabilityRoutes: { icp_research: [route] } }; } }, {
    async getConfiguredDefault() { return null; }, async getReadyRoute() { return route; },
  });
  expect(await reader.find("one")).toMatchObject({ researchModels: [route.model], synthesisModels: [route.model], defaultRoutes: [], capabilityRoutes: { icp_research: [route] } });
});

test("workspace view follows the newly validated effort for the same authorized model", async () => {
  const old = { connectionId: "shared", provider: "openai-api" as const, model: "model", reasoningEffort: "low" as const };
  const updated = { ...old, reasoningEffort: "high" as const };
  const repository: WorkspaceAiSettingsRepository = {
    async find() { return { researchModels: [], synthesisModels: [], defaultRoutes: [old], capabilityRoutes: { content_writer: [old] }, updatedAt: new Date() }; },
    async upsert() { throw new Error("not used"); },
  };
  const application = new WorkspaceAiSettingsApplication(repository, { researchModels: [], synthesisModels: [] }, () => new Date(), {
    async getDefault() { return null; }, async listAllowed() { return [{ ...updated, connectionName: "Shared" }]; },
  });
  expect(await application.get("one")).toMatchObject({ defaultRoutes: [updated], effectiveDefaultRoutes: [updated], capabilityRoutes: { content_writer: [updated] } });
});
