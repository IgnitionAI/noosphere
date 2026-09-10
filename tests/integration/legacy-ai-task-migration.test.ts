import { expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { registerRuntimeAiDefaults } from "@outbound/infrastructure/ai/register-runtime-ai-defaults";
import { PostgresTaskAiPolicyReader } from "@outbound/infrastructure/ai/postgres-task-ai-policy-reader";

const url = process.env.TEST_DATABASE_URL;
(url ? test : test.skip).each([false, true])("startup migrates legacy tasks idempotently (workspace override: %s)", async (override) => {
  const db = createDatabase(url!), workspaceId = crypto.randomUUID(), runId = crypto.randomUUID();
  const retainedRunId = crypto.randomUUID(), draftId = crypto.randomUUID();
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const route = { provider: "kimi-code" as const, model: "legacy-model", reasoningEffort: "low" as const };
  const policy = { researchModels: [route.model], synthesisModels: [route.model], defaultRoutes: [route], capabilityRoutes: {} };
  try {
    await migrate(db.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` });
    await db.client`delete from instance_ai_defaults`;
    await db.client`insert into workspaces (id, slug, name) values (${workspaceId}, ${workspaceId}, 'Legacy upgrade')`;
    await db.client`insert into product_research_runs (id, workspace_id, brief, status, created_at, updated_at) values (${retainedRunId}, ${workspaceId}, '{}', 'paused', now(), now()), (${draftId}, ${workspaceId}, '{}', 'draft', now(), now())`;
    if (override) {
      const userId = crypto.randomUUID();
      await db.client`insert into auth_users (id, name, email) values (${userId}, 'Legacy owner', ${`${userId}@example.com`})`;
      await db.client`insert into workspace_ai_settings (workspace_id, research_models, synthesis_models, model_routing, updated_by) values (${workspaceId}, ${db.client.json(policy.researchModels)}, ${db.client.json(policy.synthesisModels)}, ${db.client.json({ defaultRoutes: policy.defaultRoutes, capabilityRoutes: {} })}, ${userId})`;
    }
    for (const id of ids) await db.client`insert into jobs (id, workspace_id, type, payload, idempotency_key, correlation_id, max_attempts, available_at) values (${id}, ${workspaceId}, 'research.stage.execute', ${db.client.json({ runId })}, ${id}, ${runId}, 5, now())`;
    // Recreate pre-0111 rows without disabling the live trigger for other fixtures.
    await db.client`update jobs set ai_policy = null, ai_task_key = null where workspace_id = ${workspaceId}`;
    await db.client`delete from task_ai_contexts where workspace_id = ${workspaceId}`;
    await registerRuntimeAiDefaults(db.client, override ? { ...policy, defaultRoutes: [{ ...route, model: "environment-model" }] } : policy);
    const reader = new PostgresTaskAiPolicyReader(db.client);
    for (const id of ids) expect(await reader.find(id, workspaceId)).toEqual(policy);
    await registerRuntimeAiDefaults(db.client, { ...policy, defaultRoutes: [{ ...route, model: "new-default" }] });
    for (const id of ids) expect(await reader.find(id, workspaceId)).toEqual(policy);
    const [count] = await db.client`select count(*)::int as total from task_ai_contexts where workspace_id = ${workspaceId}`;
    expect(count?.total).toBe(2);
    const [retained] = await db.client`select policy from task_ai_contexts where workspace_id = ${workspaceId} and task_key = ${`research:run:${retainedRunId}`}`;
    expect(retained?.policy).toEqual(policy);
    const [draft] = await db.client`select policy from task_ai_contexts where workspace_id = ${workspaceId} and task_key = ${`research:run:${draftId}`}`;
    expect(draft).toBeUndefined();
    const [state] = await db.client`select status, attempts from jobs where id = ${ids[0]!}`;
    expect(state).toMatchObject({ status: "pending", attempts: 0 });
  } finally { await db.client`delete from jobs where workspace_id = ${workspaceId}`; await db.close(); }
});

(url ? test : test.skip)("saving unrelated workspace settings retains legacy research until explicit replacement", async () => {
  const { WorkspaceAiSettingsApplication } = await import("@outbound/application/workspaces/workspace-ai-settings");
  const { PostgresWorkspaceAiSettingsRepository } = await import("@outbound/infrastructure/workspaces/postgres-workspace-ai-settings-repository");
  const db = createDatabase(url!), workspaceId = crypto.randomUUID(), userId = crypto.randomUUID();
  const defaults = { researchModels: ["environment"], synthesisModels: ["environment"], defaultRoutes: [{ provider: "kimi-code" as const, model: "environment", reasoningEffort: "low" as const }], capabilityRoutes: {} };
  try {
    await migrate(db.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` });
    await db.client`delete from instance_ai_defaults`;
    await db.client`insert into workspaces (id, slug, name) values (${workspaceId}, ${workspaceId}, 'Legacy settings')`;
    await db.client`insert into auth_users (id, name, email) values (${userId}, 'Owner', ${`${userId}@example.com`})`;
    await db.client`insert into workspace_ai_settings (workspace_id, research_models, synthesis_models, updated_by) values (${workspaceId}, '["principal"]', '["executor"]', ${userId})`;
    await registerRuntimeAiDefaults(db.client, defaults);
    const app = new WorkspaceAiSettingsApplication(new PostgresWorkspaceAiSettingsRepository(db.db), defaults, () => new Date(), { async getFallback() { return null; }, async getDefault() { return null; }, async listAllowed() { return []; } });
    const before = await app.get(workspaceId);
    expect(before.researchTierRoutes?.principal[0]?.model).toBe("principal");
    expect(before.researchTierRoutes?.executor[0]?.model).toBe("executor");
    const save = { workspaceId, userId, defaultRoutes: [], capabilityRoutes: {} };
    expect((await app.update(save)).researchTierRoutes).toEqual(before.researchTierRoutes);
    const [captured] = await db.client`select noosphere_capture_ai_policy(${workspaceId}::uuid) as policy`;
    expect(captured?.policy.researchTierRoutes).toEqual(before.researchTierRoutes);
    expect((await app.update({ ...save, replaceLegacyResearch: true })).researchTierRoutes).toBeUndefined();
    const [replaced] = await db.client`select noosphere_capture_ai_policy(${workspaceId}::uuid) as policy`;
    expect(replaced?.policy.researchTierRoutes).toBeUndefined();
    expect(replaced?.policy.defaultRoutes).toEqual(defaults.defaultRoutes);
  } finally { await db.close(); }
});


(url ? test : test.skip)("upgrade preserves a legacy evaluation candidate after its queue row was retained out", async () => {
  const { PostgresEvaluationService } = await import("@outbound/infrastructure/ai/postgres-evaluation-service");
  const { createTaskAiResumePreparation } = await import("@outbound/infrastructure/ai/postgres-task-ai-resume");
  const db = createDatabase(url!), workspaceId = crypto.randomUUID(), actorUserId = crypto.randomUUID();
  const legacyRoute = { provider: "kimi-code" as const, model: "legacy-evaluation", reasoningEffort: "low" as const };
  const runtime = { researchModels: ["current"], synthesisModels: ["current"], defaultRoutes: [{ ...legacyRoute, model: "current" }], capabilityRoutes: {} };
  try {
    await migrate(db.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` });
    await db.client`insert into workspaces (id, slug, name) values (${workspaceId}, ${workspaceId}, 'Legacy evaluation')`;
    await db.client`insert into auth_users (id, name, email) values (${actorUserId}, 'Legacy evaluator', ${`${actorUserId}@example.com`})`;
    const prepare = createTaskAiResumePreparation({ KIMI_CODE_API_KEY: "fixture-legacy" });
    const service = new PostgresEvaluationService(db.db, { now: () => new Date() }, { generate: () => crypto.randomUUID() }, undefined, undefined, prepare);
    const prompt = await service.createPromptVersion({ workspaceId, actorUserId, capability: "setter", content: "Classify a synthetic case." });
    const configuration = await service.createConfiguration({ workspaceId, actorUserId, capability: "setter", provider: legacyRoute.provider, model: legacyRoute.model, promptVersionId: prompt.id });
    const dataset = await service.createDataset({ workspaceId, actorUserId, capability: "setter", name: "Legacy synthetic dataset", rubricVersion: "v1", cases: [{ name: "synthetic", input: { message: "EXEMPLE" }, expected: { classification: "qualified" } }] });
    const run = await service.requestRun({ workspaceId, actorUserId, datasetId: dataset.id, configurationId: configuration.id, requestKey: "before-upgrade" });
    // Recreate an older failed evaluation whose terminal queue row expired before 0111.
    await db.client`update evaluation_runs set status = 'failed' where id = ${run.id}`;
    await db.client`update evaluation_case_results set status = 'failed' where evaluation_run_id = ${run.id}`;
    await db.client`delete from jobs where workspace_id = ${workspaceId}`;
    await db.client`delete from task_ai_contexts where workspace_id = ${workspaceId}`;
    // A subsequently selected managed route is deliberately unrelated to the legacy invocation.
    const managedRoute = { ...legacyRoute, connectionId: crypto.randomUUID(), connectionVersion: 1 };
    await db.client`insert into workspace_ai_settings (workspace_id, research_models, synthesis_models, model_routing, updated_by)
      values (${workspaceId}, '[]', '[]', ${db.client.json({ defaultRoutes: [managedRoute], capabilityRoutes: {} })}, ${actorUserId})`;
    const retry = { workspaceId, actorUserId, runId: run.id, requestKey: "after-upgrade" };
    await expect(service.retryFailedRun(retry)).rejects.toThrow("AI_SETUP_REQUIRED");
    await registerRuntimeAiDefaults(db.client, runtime);
    const [context] = await db.client`select policy from task_ai_contexts where workspace_id = ${workspaceId} and task_key = ${`ai:run:${run.id}`}`;
    expect(context?.policy.capabilityRoutes.evaluation).toEqual([legacyRoute]);
    await service.retryFailedRun(retry);
    await service.retryFailedRun(retry);
    const queued = await db.client`select id, ai_policy from jobs where workspace_id = ${workspaceId}`;
    expect(queued).toHaveLength(1);
    expect(queued[0]?.ai_policy.capabilityRoutes.evaluation).toEqual([legacyRoute]);
    await registerRuntimeAiDefaults(db.client, { ...runtime, defaultRoutes: [managedRoute] });
    const [unchanged] = await db.client`select policy from task_ai_contexts where workspace_id = ${workspaceId} and task_key = ${`ai:run:${run.id}`}`;
    expect(unchanged?.policy).toEqual(context?.policy);
  } finally { await db.close(); }
});
