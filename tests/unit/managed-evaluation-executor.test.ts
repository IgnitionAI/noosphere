import { expect, test } from "bun:test";
import { ModelRouter } from "@outbound/application/ai/model-router";
import type { ModelGateway, ModelRoute } from "@outbound/application/ai/model-gateway";
import { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";
import { LangChainEvaluationExecutor } from "@outbound/infrastructure/ai/langchain-evaluation-executor";

test.each(["openai-api", "anthropic", "openrouter"] as const)("evaluation preserves the selected managed %s candidate", async (provider) => {
  const route: ModelRoute = { provider, model: "vendor/candidate", connectionId: "managed-connection", connectionVersion: 7, reasoningEffort: "medium" };
  const calls: unknown[] = [];
  const gateway: ModelGateway = { provider, transport: "chat-completions", async invokeStructured(request) {
    calls.push({ model: request.model, connectionId: request.connectionId, connectionVersion: request.connectionVersion, reasoningEffort: request.reasoningEffort });
    return { output: request.parse({ content: "Synthetic output" }), metadata: { ...route, transport: "chat-completions", latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, source: "reported" } } };
  } };
  const policies = { async find() { return { researchModels: [], synthesisModels: [], defaultRoutes: [route] }; } };
  const executor = new LangChainEvaluationExecutor({}, new WorkspaceStructuredModel(new ModelRouter([gateway]), policies), policies);
  const input = { workspaceId: "workspace-one", provider, model: route.model, capability: "message_generation" as const, prompt: "Evaluate synthetic output", caseInput: {} };
  await executor.execute(input);
  expect(calls).toEqual([{ model: route.model, connectionId: route.connectionId, connectionVersion: 7, reasoningEffort: "medium" }]);
  await expect(executor.execute({ ...input, model: "unselected-model" })).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
