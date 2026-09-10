import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresInstanceAiConnectionsRepository } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
import { PostgresWorkspaceAiSettingsRepository } from "@outbound/infrastructure/workspaces/postgres-workspace-ai-settings-repository";
import { WorkspaceAiSettingsApplication } from "@outbound/application/workspaces/workspace-ai-settings";
import { InstanceWorkspaceAiPolicyReader, createInstanceWorkspaceAiAvailability } from "@outbound/infrastructure/ai/instance-ai-runtime";
import { encryptSecret, decryptSecret } from "@outbound/infrastructure/security/secret-crypto";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("workspace instance model persistence", () => {
  if (!url) return;
  const db = createDatabase(url);
  beforeAll(() => migrate(db.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` }));
  afterAll(() => db.close());
  test("two workspaces inherit live defaults and preserve or reset their authorized choices after reconnect", async () => {
    const key = "workspace-instance-test-key-0123456789";
    const cipher = { encrypt: (value: string) => encryptSecret(value, key), decrypt: (value: string) => decryptSecret(value, key) };
    const instance = new PostgresInstanceAiConnectionsRepository(db.db, cipher);
    const userId = crypto.randomUUID();
    await db.db.insert(authUsers).values({ id: userId, name: "Workspace admin", email: `${userId}@example.com` });
    const one = crypto.randomUUID(), two = crypto.randomUUID();
    await db.db.insert(workspaces).values([one, two].map((id) => ({ id, slug: `inherit-${id}`, name: "Inheritance test" })));
    async function ready(model: string) {
      const connection = await instance.save({ name: model, provider: "openrouter", apiKey: "private-test-key", models: [{ model, reasoningEffort: "low" }] });
      const selection = { connectionId: connection.id, model };
      // Controlled proof completion: this test exercises persistence, not provider behavior.
      expect(await instance.finishTest({ ...await instance.beginTest(selection), errorCode: null })).toBe(true);
      return (await instance.getReadyRoute(selection))!;
    }
    const a = await ready("vendor/a"), b = await ready("vendor/b");
    await instance.setDefault(a);
    const application = new WorkspaceAiSettingsApplication(new PostgresWorkspaceAiSettingsRepository(db.db), { researchModels: [], synthesisModels: [], defaultRoutes: [] }, () => new Date(), { getDefault: () => instance.getConfiguredDefault(), getFallback: () => instance.getConfiguredFallback(), listAllowed: () => instance.listAllowed() });
    expect((await application.get(one)).effectiveDefaultRoutes).toEqual([a]);
    const { connectionVersion: _version, ...chosenA } = a;
    await application.update({ workspaceId: two, userId, defaultRoutes: [chosenA], capabilityRoutes: {} });
    await instance.setDefault(b);
    const reopened = createDatabase(url);
    try {
      const policies = new InstanceWorkspaceAiPolicyReader(new PostgresWorkspaceAiSettingsRepository(reopened.db), new PostgresInstanceAiConnectionsRepository(reopened.db, cipher));
      expect((await policies.find(one))?.defaultRoutes).toEqual([b]);
      expect((await policies.find(two))?.defaultRoutes).toEqual([a]);
      await application.update({ workspaceId: two, userId, defaultRoutes: [], capabilityRoutes: { content_writer: [chosenA] } });
      expect(await policies.find(two)).toMatchObject({ defaultRoutes: [b], capabilityRoutes: { content_writer: [a] } });
      await instance.save({ id: a.connectionId, name: "Retired A", provider: "openrouter", models: [{ model: "replacement", reasoningEffort: "low" }] });
      const availability = createInstanceWorkspaceAiAvailability({}, policies, instance);
      expect(await availability(two, "content_writer")).toBe(false);
      expect(await availability(two, "icp_research")).toBe(true);
      expect((await application.get(two)).capabilityRoutes.content_writer).toEqual([chosenA]);
      expect(JSON.stringify(await application.get(two))).not.toContain("private-test-key");
      await expect(application.update({ workspaceId: two, userId, defaultRoutes: [chosenA], capabilityRoutes: {} })).rejects.toMatchObject({ code: "AI_MODEL_NOT_AUTHORIZED" });
    } finally { await reopened.close(); }
  });
});
