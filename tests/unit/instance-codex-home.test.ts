import { expect, test } from "bun:test";
import { instanceCodexHome } from "@outbound/infrastructure/ai/instance-codex-home";

test("managed Codex requires an explicit absolute service root and a connection UUID", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  expect(instanceCodexHome({ INSTANCE_CODEX_HOME: "/srv/noosphere/instance-codex" }, id)).toBe(`/srv/noosphere/instance-codex/${id}`);
  expect(() => instanceCodexHome({ CODEX_HOME: "/personal", CODEX_SERVICE_HOME: "/legacy" }, id)).toThrow("INSTANCE_CODEX_HOME_REQUIRED");
  expect(() => instanceCodexHome({ INSTANCE_CODEX_HOME: "relative" }, id)).toThrow("INSTANCE_CODEX_HOME_REQUIRED");
  expect(() => instanceCodexHome({ INSTANCE_CODEX_HOME: "/srv/codex" }, "../../personal")).toThrow("INVALID_CONNECTION_ID");
});

test("ChatGPT authentication status distinguishes missing, connected and expired without returning tokens", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { InstanceCodexAuthenticationReader } = await import("@outbound/infrastructure/ai/instance-codex-home");
  const root = await mkdtemp(join(tmpdir(), "noosphere-auth-state-test-"));
  const id = crypto.randomUUID();
  const home = join(root, id);
  await mkdir(home, { mode: 0o700 });
  const connection = { id, name: "Controlled ChatGPT", provider: "codex-cli" as const, baseUrl: "", version: 1, secretConfigured: false, models: [] };
  const reader = new InstanceCodexAuthenticationReader({ INSTANCE_CODEX_HOME: root });
  expect(await reader.status(connection)).toEqual({ state: "action_required" });
  await writeFile(join(home, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "fake-key" }), { mode: 0o600 });
  expect(await reader.status(connection)).toEqual({ state: "action_required" });
  await writeFile(join(home, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "fake-access", refresh_token: "fake-refresh" } }), { mode: 0o600 });
  expect(await reader.status(connection)).toEqual({ state: "connected" });
  const expired = { ...connection, models: [{ model: "test-model", reasoningEffort: "low" as const, status: "failed" as const, testedAt: new Date(Date.now() + 1000), errorCode: "AI_PROVIDER_AUTHENTICATION_FAILED" as const }] };
  expect(await reader.status(expired)).toEqual({ state: "expired" });
  expect(JSON.stringify(await reader.status(expired))).not.toContain("fake-access");
  expect(await new InstanceCodexAuthenticationReader({}).status(connection)).toEqual({ state: "unavailable" });
});
