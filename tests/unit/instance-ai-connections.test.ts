import { expect, test } from "bun:test";
import { InstanceAiConnectionsApplication, type InstanceAiConnectionsRepository, type InstanceAiTestLease } from "@outbound/application/ai/instance-ai-connections";

function harness() {
  const models = new Map<string, InstanceAiTestLease>();
  let version = 1;
  let calls = 0;
  let finish: (() => void) | undefined;
  const repository: InstanceAiConnectionsRepository = {
    async list() { return []; },
    async save(input) { version++; return { id: "connection", version, name: input.name, provider: input.provider, baseUrl: input.baseUrl ?? "https://api.openai.com/v1", secretConfigured: true, models: input.models.map((model) => ({ ...model, status: "untested", testedAt: null, errorCode: null })) }; },
    async beginTest(input) { const row = { ...input, version, testId: crypto.randomUUID(), reasoningEffort: "low" as const }; models.set(input.model, row); return row; },
    async finishTest(input) { const row = models.get(input.model); return row?.version === version && row?.testId === input.testId; },
    async setDefault() { return false; },
    async getFallback() { return null; }, async getConfiguredFallback() { return null; }, async getDefault() { return null; },
  };
  const app = new InstanceAiConnectionsApplication({ async isAdministrator(userId: string) { return userId === "admin"; } }, repository, { async test() { calls++; if (finish) await new Promise<void>((resolve) => { finish = resolve; }); } });
  return { app, calls: () => calls, mutate: () => version++, delay: () => { finish = () => {}; }, release: () => finish?.() };
}

test("only instance administrators may save a shared connection or spend a test invocation", async () => {
  const h = harness();
  const connection = { name: "OpenAI", provider: "openai-api" as const, apiKey: "secret", models: [{ model: "gpt-test", reasoningEffort: "high" as const }] };
  await expect(h.app.save("workspace-owner", connection)).rejects.toThrow("INSTANCE_ADMIN_REQUIRED");
  await expect(h.app.test("workspace-owner", { connectionId: "connection", model: "gpt-test" })).rejects.toThrow("INSTANCE_ADMIN_REQUIRED");
  expect(h.calls()).toBe(0);
  await expect(h.app.setDefault("admin", { connectionId: "connection", model: "gpt-test" })).rejects.toThrow("AI_CONNECTION_NOT_VALIDATED");
});

test("a connection changed during its real invocation cannot be marked ready by an old result", async () => {
  const h = harness();
  h.delay();
  const pending = h.app.test("admin", { connectionId: "connection", model: "gpt-test" });
  while (!h.calls()) await Promise.resolve();
  h.mutate();
  h.release();
  await expect(pending).rejects.toThrow("AI_CONNECTION_CHANGED");
});

test("only an instance administrator can start or inspect a ChatGPT device login", async () => {
  const h = harness();
  await expect(h.app.deviceLogin("workspace-owner", "connection", true)).rejects.toThrow("INSTANCE_ADMIN_REQUIRED");
  await expect(h.app.deviceLogin("workspace-owner", "connection", false)).rejects.toThrow("INSTANCE_ADMIN_REQUIRED");
  await expect(h.app.deviceLogin("admin", "missing", true)).rejects.toThrow("AI_CONNECTION_NOT_FOUND");
});
