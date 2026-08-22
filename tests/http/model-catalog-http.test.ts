import { describe, expect, test } from "bun:test";
import { ModelCatalogApplication } from "@outbound/application/ai/model-catalog-application";
import type { ModelCatalog } from "@outbound/application/ai/model-gateway";
import { createModelCatalogHttpHandler } from "@outbound/interface/http/model-catalog-handler";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";

const now = new Date("2026-08-22T12:00:00.000Z");

describe("model catalog HTTP route", () => {
  test("returns dynamic provider catalogs and explicitly marks missing providers", async () => {
    const kimi: ModelCatalog = {
      provider: "kimi-code",
      list: async () => ({
        provider: "kimi-code",
        status: "healthy",
        models: [{ id: "future-kimi", displayName: "Future Kimi", reasoningEfforts: ["low", "max"], structuredOutput: "supported" }],
        observedAt: now,
        errorCode: null,
      }),
    };
    const codex: ModelCatalog = {
      provider: "codex-cli",
      list: async () => ({
        provider: "codex-cli",
        status: "healthy",
        models: [{ id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", reasoningEfforts: ["low", "xhigh"], structuredOutput: "supported" }],
        observedAt: now,
        errorCode: null,
      }),
    };
    const handler = createModelCatalogHttpHandler({
      application: new ModelCatalogApplication([kimi, codex], () => now),
      contextResolver: fixedContext(),
    });

    const response = await handler(new Request("http://localhost/api/v1/ai/models", { headers: { "x-workspace-slug": "ignition-ai" } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: [
      expect.objectContaining({ provider: "kimi-code", status: "healthy", models: [expect.objectContaining({ id: "future-kimi" })] }),
      expect.objectContaining({ provider: "codex-cli", status: "healthy", models: [expect.objectContaining({ id: "gpt-5.6-luna" })] }),
      expect.objectContaining({ provider: "openai-api", status: "unavailable", models: [] }),
    ] });
  });

  test("requires a workspace session", async () => {
    const handler = createModelCatalogHttpHandler({
      application: new ModelCatalogApplication([], () => now),
      contextResolver: { resolve: async () => { throw new (await import("@outbound/interface/http/request-context")).RequestAuthenticationError("login"); } },
    });

    expect((await handler(new Request("http://localhost/api/v1/ai/models"))).status).toBe(401);
  });
});

function fixedContext(): RequestContextResolver {
  return {
    resolve: async () => ({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      role: "owner",
    }),
  };
}
