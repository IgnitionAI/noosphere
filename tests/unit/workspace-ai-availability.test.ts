import { expect, test } from "bun:test";
import { createWorkspaceAiAvailabilityFromEnvironment } from "@outbound/infrastructure/ai/workspace-ai-availability";
import type { WorkspaceAiModelPolicy } from "@outbound/application/workspaces/workspace-ai-settings";

const kimi = { provider: "kimi-code", model: "k3", reasoningEffort: "max" } as const;
const openai = { provider: "openai-api", model: "gpt-test", reasoningEffort: "high" } as const;
const codex = { provider: "codex-cli", model: "gpt-test", reasoningEffort: "high" } as const;

test("availability follows capability override, workspace default and environment fallback", async () => {
  let policy: WorkspaceAiModelPolicy | null = null;
  const available = createWorkspaceAiAvailabilityFromEnvironment({ AI_PROVIDER: "kimi-code", KIMI_CODE_API_KEY: "test-key" }, { async find() { return policy; } });
  expect(await available("workspace", "content_idea")).toBe(true);
  policy = { researchModels: [], synthesisModels: [], defaultRoutes: [codex], capabilityRoutes: { content_idea: [kimi] } };
  expect(await available("workspace", "content_idea")).toBe(true);
  expect(await available("workspace", "content_writer")).toBe(false);
  policy = { researchModels: [], synthesisModels: [], defaultRoutes: [] };
  expect(await available("workspace", "content_writer")).toBe(true);
});

test("no credentials blocks generation and legacy OpenAI research remains usable", async () => {
  const policies = { async find() { return { researchModels: [], synthesisModels: [], defaultRoutes: [openai] }; } };
  expect(await createWorkspaceAiAvailabilityFromEnvironment({}, policies)("workspace", "icp_research")).toBe(false);
  expect(await createWorkspaceAiAvailabilityFromEnvironment({ AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key", OPENAI_RESEARCH_MODEL: "gpt-test", OPENAI_SYNTHESIS_MODEL: "gpt-test" }, policies)("workspace", "icp_research")).toBe(true);
});

test("an empty service volume is unavailable; only explicit service credentials enable legacy Codex", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "noosphere-codex-availability-"));
  const policies = { async find() { return { researchModels: [], synthesisModels: [], defaultRoutes: [codex] }; } };
  const available = createWorkspaceAiAvailabilityFromEnvironment({ CODEX_SERVICE_HOME: home }, policies);
  expect(await available("workspace", "content_writer")).toBe(false);
  writeFileSync(join(home, "auth.json"), "{}", { mode: 0o600 });
  expect(await available("workspace", "content_writer")).toBe(false);
  writeFileSync(join(home, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "fixture-token" } }));
  expect(await available("workspace", "content_writer")).toBe(true);
  expect(await createWorkspaceAiAvailabilityFromEnvironment({ CODEX_HOME: home }, policies)("workspace", "content_writer")).toBe(false);
  writeFileSync(join(home, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "fixture-key" }));
  expect(await available("workspace", "content_writer")).toBe(true);
});
