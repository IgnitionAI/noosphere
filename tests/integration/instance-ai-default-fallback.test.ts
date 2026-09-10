import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { InstanceAiConnectionsApplication } from "@outbound/application/ai/instance-ai-connections";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { jobs, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresTaskAiPolicyReader } from "@outbound/infrastructure/ai/postgres-task-ai-policy-reader";
import { PostgresInstanceAiConnectionsRepository } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
import { InstanceWorkspaceAiPolicyReader } from "@outbound/infrastructure/ai/instance-ai-runtime";
import { encryptSecret, decryptSecret } from "@outbound/infrastructure/security/secret-crypto";
import { createInstanceAiConnectionsHttpHandler } from "@outbound/interface/http/instance-ai-connections-handler";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("instance default fallback", () => {
  if (!url) return;
  const database = createDatabase(url);
  const cipher = { encrypt: (value: string) => encryptSecret(value, "fallback-test-key"), decrypt: (value: string) => decryptSecret(value, "fallback-test-key") };
  const repository = new PostgresInstanceAiConnectionsRepository(database.db, cipher);
  const app = new InstanceAiConnectionsApplication({ async isAdministrator(id) { return id === "admin"; } }, repository, { async test() {} });
  const handle = createInstanceAiConnectionsHttpHandler({ application: app, sessions: { async getSession(headers) { return { userId: headers.get("x-user") ?? "admin", sessionId: "test" }; } } });
  const select = (body: unknown, user = "admin") => handle(new Request("http://localhost/api/v1/instance/ai/default", { method: "POST", headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify(body) }));
  beforeAll(() => migrate(database.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` }));
  afterAll(() => database.close());

  test("persists an explicit tested fallback and shares it with inheriting workspaces", async () => {
    const saved = await repository.save({ name: "Shared", provider: "openai-api", apiKey: "fixture", models: [{ model: "primary", reasoningEffort: "low" }, { model: "fallback", reasoningEffort: "low" }, { model: "other-primary", reasoningEffort: "low" }] });
    const primary = { connectionId: saved.id, model: "primary" };
    const fallback = { connectionId: saved.id, model: "fallback" };
    await app.test("admin", primary);
    expect((await select({ ...primary, fallback })).status).toBe(409);
    await app.test("admin", fallback);
    expect((await select({ ...primary, fallback }, "workspace-owner")).status).toBe(403);
    expect((await select({ ...primary, fallback })).status).toBe(200);
    // Primary-only forms must preserve the explicitly configured fallback.
    expect((await select(primary)).status).toBe(200);
    expect(await repository.getConfiguredFallback()).toMatchObject(fallback);
    expect((await select(fallback)).status).toBe(409);
    expect(await repository.getConfiguredDefault()).toMatchObject(primary);
    expect(await repository.getConfiguredFallback()).toMatchObject(fallback);
    const otherPrimary = { connectionId: saved.id, model: "other-primary" };
    await app.test("admin", otherPrimary);
    expect((await select(otherPrimary)).status).toBe(200);
    expect(await repository.getConfiguredDefault()).toMatchObject(otherPrimary);
    expect(await repository.getConfiguredFallback()).toMatchObject(fallback);
    expect((await select(primary)).status).toBe(200);
    // Recompose the repository and policy reader to prove durable inheritance.
    const restarted = new PostgresInstanceAiConnectionsRepository(database.db, cipher);
    const policies = new InstanceWorkspaceAiPolicyReader({ async find() { return null; } }, restarted);
    for (const workspace of ["workspace-a", "workspace-b"]) {
      expect((await policies.find(workspace))?.defaultRoutes).toMatchObject([primary, fallback]);
    }
    const workspaceId = crypto.randomUUID();
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `fallback-${workspaceId}`, name: "Fallback test" });
    const jobId = crypto.randomUUID();
    await database.db.insert(jobs).values({ id: jobId, workspaceId, type: "ai.evaluation.execute", payload: { runId: crypto.randomUUID() }, idempotencyKey: jobId, correlationId: jobId, maxAttempts: 3, availableAt: new Date() });
    const snapshots = new PostgresTaskAiPolicyReader(database.client);
    expect((await snapshots.find(jobId, workspaceId))?.defaultRoutes).toMatchObject([primary, fallback]);
    expect((await select({ ...primary, fallback: primary })).status).toBe(422);
    expect((await select({ ...primary, fallback: null })).status).toBe(200);
    expect((await policies.find("workspace-a"))?.defaultRoutes).toMatchObject([primary]);
    expect((await snapshots.find(jobId, workspaceId))?.defaultRoutes).toMatchObject([primary, fallback]);
  });
});
