import { expect, test } from "bun:test";
import { TaskAiPolicyScope } from "@outbound/infrastructure/ai/task-ai-policy-scope";
import type { WorkspaceAiModelPolicy } from "@outbound/application/workspaces/workspace-ai-settings";

test("task scope isolates concurrent work and never rereads live defaults inside a captured task", async () => {
  const policy = (model: string): WorkspaceAiModelPolicy => ({ researchModels: [model], synthesisModels: [model], defaultRoutes: [{ provider: "openai-api", connectionId: model, connectionVersion: 1, model, reasoningEffort: "low" }] });
  let live = policy("new");
  const scope = new TaskAiPolicyScope({ async find() { return live; } }, { async find(id) { return policy(id); } });
  const seen = await Promise.all(["a", "b"].map((id) => scope.run({ id, workspaceId: "workspace" }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    live = policy("newest");
    return scope.find("workspace");
  })));
  expect(seen).toEqual([policy("a"), policy("b")]);
  expect(await scope.find("workspace")).toEqual(policy("newest"));
});
