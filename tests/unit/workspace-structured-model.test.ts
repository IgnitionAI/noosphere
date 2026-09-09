import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { ModelGateway } from "@outbound/application/ai/model-gateway";
import { ModelRouter } from "@outbound/application/ai/model-router";
import { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

describe("WorkspaceStructuredModel", () => {
  test("uses a per-use-case Codex route instead of the global Kimi route", async () => {
    const seen: string[] = [];
    const gateway = (provider: ModelGateway["provider"]): ModelGateway => ({
      provider,
      transport: provider === "codex-cli" ? "codex-process" : "chat-completions",
      invokeStructured: async (request) => {
        seen.push(`${provider}:${request.capability}:${request.model}:${request.reasoningEffort}`);
        return {
          output: request.parse({ body: "specific" }),
          metadata: {
            provider,
            transport: provider === "codex-cli" ? "codex-process" : "chat-completions",
            model: request.model,
            reasoningEffort: request.reasoningEffort,
            usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, source: "reported" },
            latencyMs: 1,
          },
        };
      },
    });
    const runtime = new WorkspaceStructuredModel(
      new ModelRouter([gateway("kimi-code"), gateway("codex-cli")]),
      {
        find: async () => ({
          researchModels: ["k3"],
          synthesisModels: ["k3-256k"],
          defaultRoutes: [{ provider: "kimi-code", model: "k3", reasoningEffort: "max" }],
          capabilityRoutes: {
            content_writer: [{ provider: "codex-cli", model: "gpt-5.6-luna", reasoningEffort: "xhigh" }],
          },
        }),
      },
      () => new Date("2026-08-22T12:00:00.000Z"),
    );

    const result = await runtime.invoke({
      workspaceId: "workspace-1",
      capability: "content_writer",
      requestKey: "writer:1",
      fallbackRoutes: [{ provider: "kimi-code", model: "k3", reasoningEffort: "max" }],
      systemPrompt: "Write",
      payload: { idea: "one" },
      outputName: "submit",
      outputDescription: "Submit",
      schema: z.object({ body: z.string() }),
    });

    expect(result.output).toEqual({ body: "specific" });
    expect(seen).toEqual(["codex-cli:content_writer:gpt-5.6-luna:xhigh"]);
  });
});

test("provider exhaustion requests a manual pause and never invokes an unselected provider", async () => {
  const { ModelGatewayError } = await import("@outbound/application/ai/model-gateway");
  let primaryCalls = 0, unselectedCalls = 0;
  const primary: ModelGateway = { provider: "openai-api", transport: "responses-api", async invokeStructured() {
    primaryCalls++;
    throw new ModelGatewayError("AI_PROVIDER_QUOTA_EXHAUSTED", "openai-api", "quota", true, false);
  } };
  const unselected: ModelGateway = { provider: "anthropic", transport: "anthropic-messages", async invokeStructured() { unselectedCalls++; throw new Error("must not call"); } };
  const runtime = new WorkspaceStructuredModel(new ModelRouter([primary, unselected]), { async find() { return { researchModels: [], synthesisModels: [], defaultRoutes: [{ provider: "openai-api", model: "selected", reasoningEffort: "low" }] }; } });
  await expect(runtime.invoke({ workspaceId: "one", capability: "content_writer", requestKey: "task:write", fallbackRoutes: [], systemPrompt: "Write", payload: {}, outputName: "submit", outputDescription: "Submit", schema: z.object({ body: z.string() }) })).rejects.toMatchObject({ name: "AiTaskPauseError", code: "AI_PROVIDER_QUOTA_EXHAUSTED", capability: "content_writer", requestKey: "task:write" });
  expect(primaryCalls).toBe(1);
  expect(unselectedCalls).toBe(0);
});

test("records the actual explicit fallback and sanitized reason without prompts or output", async () => {
  const { ModelGatewayError } = await import("@outbound/application/ai/model-gateway");
  const observations: unknown[] = [];
  const primary: ModelGateway = { provider: "openai-api", transport: "responses-api", async invokeStructured() { throw new ModelGatewayError("AI_PROVIDER_QUOTA_EXHAUSTED", "openai-api", "private provider response", true, false); } };
  const secondary: ModelGateway = { provider: "kimi-code", transport: "chat-completions", async invokeStructured(request) { return { output: request.parse({ body: "private output" }), metadata: { provider: "kimi-code", transport: "chat-completions", model: request.model, reasoningEffort: request.reasoningEffort, latencyMs: 1, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, source: "reported" } } }; } };
  const model = new WorkspaceStructuredModel(new ModelRouter([primary, secondary]), { async find() { return null; } }, () => new Date(), { async record(input) { observations.push(input); } });
  await model.invoke({ workspaceId: "workspace", capability: "content_writer", requestKey: "request", fallbackRoutes: [{ provider: "openai-api", model: "primary", reasoningEffort: "low" }, { provider: "kimi-code", model: "secondary", reasoningEffort: "low" }], systemPrompt: "private prompt", payload: { private: true }, outputName: "submit", outputDescription: "Submit", schema: z.object({ body: z.string() }) });
  expect(observations).toEqual([{ workspaceId: "workspace", capability: "content_writer", requestKey: "request", primary: { provider: "openai-api", model: "primary" }, selected: { provider: "kimi-code", model: "secondary" }, reason: "AI_PROVIDER_QUOTA_EXHAUSTED" }]);
});

test("preserves the migrated principal and executor routes independently", async () => {
  const seen: string[] = [];
  const gateway: ModelGateway = { provider: "kimi-code", transport: "chat-completions", async invokeStructured(request) {
    seen.push(request.model);
    return { output: request.parse({ body: "ok" }), metadata: { provider: "kimi-code", transport: "chat-completions", model: request.model, reasoningEffort: request.reasoningEffort, latencyMs: 1, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, source: "reported" } } };
  } };
  const route = (model: string) => ({ provider: "kimi-code" as const, model, reasoningEffort: "low" as const });
  const runtime = new WorkspaceStructuredModel(new ModelRouter([gateway]), { async find() { return { researchModels: ["principal"], synthesisModels: ["executor"], defaultRoutes: [route("future-default")], researchTierRoutes: { principal: [route("principal")], executor: [route("executor")] } }; } });
  for (const researchTier of ["principal", "executor"] as const) await runtime.invoke({ workspaceId: "one", capability: "icp_research", researchTier, requestKey: researchTier, fallbackRoutes: [], systemPrompt: "Research", payload: {}, outputName: "submit", outputDescription: "Submit", schema: z.object({ body: z.string() }) });
  expect(seen).toEqual(["principal", "executor"]);
});
