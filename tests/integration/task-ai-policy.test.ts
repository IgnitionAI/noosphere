import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { jobs, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresInstanceAiConnectionsRepository } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("durable task AI selection", () => {
  if (!url) return;
  const database = createDatabase(url);
  beforeAll(() => migrate(database.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` }));
  afterAll(() => database.close());
  test("captures at enqueue across SQL writers and preserves a research run across stages and reconnect", async () => {
    const instance = new PostgresInstanceAiConnectionsRepository(database.db, { encrypt: (value) => value, decrypt: (value) => value });
    const workspaceId = crypto.randomUUID(), runId = crypto.randomUUID();
    await database.db.insert(workspaces).values({ id: workspaceId, name: "Task AI test", slug: `task-ai-${workspaceId}` });
    async function ready(model: string) {
      const saved = await instance.save({ name: model, provider: "openai-api", apiKey: "controlled", models: [{ model, reasoningEffort: "low" }] });
      const selection = { connectionId: saved.id, model };
      await instance.finishTest({ ...await instance.beginTest(selection), errorCode: null });
      return (await instance.getReadyRoute(selection))!;
    }
    const a = await ready("captured-a"), b = await ready("future-b");
    const job = (id: string, researchRun = runId) => ({ id, workspaceId, type: "research.stage.execute", payload: { runId: researchRun, stage: "product_analysis" }, idempotencyKey: id, correlationId: crypto.randomUUID(), maxAttempts: 5, availableAt: new Date() });
    await instance.setDefault(a);
    const first = job(crypto.randomUUID());
    await new PostgresJobQueue(database.client).enqueue(first);
    await instance.setDefault(b);
    const next = job(crypto.randomUUID());
    // Some producers bypass PostgresJobQueue; the capture must cover them too.
    await database.db.insert(jobs).values(next);
    const future = job(crypto.randomUUID(), crypto.randomUUID());
    await database.db.insert(jobs).values(future);
    const reopened = createDatabase(url);
    try {
      const rows = await reopened.client`select id, ai_policy from jobs where workspace_id = ${workspaceId}`;
      expect(rows.find((row) => row.id === first.id)?.ai_policy.defaultRoutes).toEqual([a]);
      expect(rows.find((row) => row.id === next.id)?.ai_policy.defaultRoutes).toEqual([a]);
      expect(rows.find((row) => row.id === future.id)?.ai_policy.defaultRoutes).toEqual([b]);
      await database.client`delete from jobs where workspace_id = ${workspaceId}`;
      const resumed = job(crypto.randomUUID());
      await database.db.insert(jobs).values(resumed);
      const [afterRetention] = await reopened.client`select ai_policy from jobs where id = ${resumed.id}`;
      expect(afterRetention?.ai_policy.defaultRoutes).toEqual([a]);
    } finally { await reopened.close(); await database.client`delete from jobs where workspace_id = ${workspaceId}`; }
  });
  test.each([false, true])("an environment installation preserves a complete mission (legacy tiers: %s)", async (legacyTiers) => {
    const { registerRuntimeAiDefaults } = await import("@outbound/infrastructure/ai/register-runtime-ai-defaults");
    const { TaskAiPolicyScope } = await import("@outbound/infrastructure/ai/task-ai-policy-scope");
    const { PostgresTaskAiPolicyReader } = await import("@outbound/infrastructure/ai/postgres-task-ai-policy-reader");
    const { resolveResearchModelPolicyFromEnvironment, resolveResearchModelConfigurationFromEnvironment, LangChainResearchAgentExecutor, modelTierForStage } = await import("@outbound/infrastructure/ai/langchain-research-agent-executor");
    const { createWorkspaceStructuredModelFromEnvironment } = await import("@outbound/infrastructure/ai/model-runtime-from-environment");
    const { createInstanceApiKeyGateways } = await import("@outbound/infrastructure/ai/instance-ai-runtime");
    const { PostgresProductResearchRepository } = await import("@outbound/infrastructure/gtm/postgres-product-research-repository");
    const { CreateProductResearchRun, StartProductResearchRun } = await import("@outbound/application/gtm/product-research-use-cases");
    const { ResearchOrchestrator } = await import("@outbound/application/gtm/research-orchestrator");
    const { ResearchWorker } = await import("../../apps/worker/src/research-worker");
    const { CryptoIdGenerator } = await import("@outbound/application/shared/ports");
    const { Sha256ContentHasher } = await import("@outbound/infrastructure/shared/sha256-content-hasher");
    const { validOutputFor } = await import("../fixtures/research-agent-fixtures");
    let calls = 0;
    const models = new Set<string>();
    const provider = Bun.serve({ port: 0, async fetch(request) {
      calls++;
      const body = await request.json() as { model: string; tools: { function: { name: string } }[] };
      models.add(body.model);
      expect(legacyTiers ? ["legacy-model", "legacy-executor"] : ["legacy-model"]).toContain(body.model);
      const name = body.tools[0]!.function.name;
      if (legacyTiers && name !== "submit_research_tool_plan") {
        const stage = name.replace(/^submit_/, "") as Parameters<typeof validOutputFor>[0];
        expect(body.model).toBe(modelTierForStage(stage, 3) === "principal" ? "legacy-model" : "legacy-executor");
      }
      const output = name === "submit_research_tool_plan" ? { approach: "Controlled evidence", calls: [] } : validOutputFor(name.replace(/^submit_/, "") as Parameters<typeof validOutputFor>[0]);
      return Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(output) } }] } }] });
    } });
    const workspaceId = crypto.randomUUID();
    try {
      await database.client`delete from instance_ai_defaults`;
      await database.db.insert(workspaces).values({ id: workspaceId, slug: `legacy-${workspaceId}`, name: "Legacy mission" });
      const environment = { KIMI_CODE_API_KEY: "controlled", KIMI_CODE_BASE_URL: provider.url.toString(), KIMI_RESEARCH_MODEL: "legacy-model", KIMI_SYNTHESIS_MODEL: "legacy-model" };
      const initial = resolveResearchModelPolicyFromEnvironment(environment);
      if (legacyTiers) {
        const userId = crypto.randomUUID();
        await database.client`insert into auth_users (id, name, email) values (${userId}, 'Legacy owner', ${`${userId}@example.com`})`;
        await database.client`insert into workspace_ai_settings (workspace_id, research_models, synthesis_models, updated_by) values (${workspaceId}, '["legacy-model"]', '["legacy-executor"]', ${userId})`;
      }
      await registerRuntimeAiDefaults(database.client, initial);
      const instance = new PostgresInstanceAiConnectionsRepository(database.db, { encrypt: (value) => value, decrypt: (value) => value });
      const policies = new TaskAiPolicyScope({ async find() { return initial; } }, new PostgresTaskAiPolicyReader(database.client));
      const model = createWorkspaceStructuredModelFromEnvironment(environment, policies, createInstanceApiKeyGateways(instance, environment));
      const executor = new LangChainResearchAgentExecutor({ ...resolveResearchModelConfigurationFromEnvironment(environment), crawlerServiceUrl: "http://127.0.0.1:1", crawlerApiKey: "unused", modelPolicyReader: policies, routedModel: model });
      const research = new PostgresProductResearchRepository(database.db), queue = new PostgresJobQueue(database.client);
      const ids = new CryptoIdGenerator(), clock = { now: () => new Date() };
      const run = await new CreateProductResearchRun(research, ids, clock).execute({ workspaceId, brief: { productUrl: "https://example.com", productName: "Noosphere", description: "B2B growth platform", geography: "France", languages: ["fr"], salesMotion: "hybrid", knownCompetitors: [], internalDocumentIds: [], depth: "quick", audienceGoal: "end_customers", buyerConstraints: "", researchVersion: 3 } });
      await new StartProductResearchRun(research, ids, clock).execute({ workspaceId, runId: run.snapshot.id, correlationId: "legacy-capture" });
      await registerRuntimeAiDefaults(database.client, resolveResearchModelPolicyFromEnvironment({ ...environment, KIMI_RESEARCH_MODEL: "future-model" }));
      const orchestrator = new ResearchOrchestrator(research, queue, executor, ids, clock, new Sha256ContentHasher());
      const worker = new ResearchWorker(queue, orchestrator, clock, { workerId: "legacy-capture", leaseMs: 30_000, batchSize: 1, pollIntervalMs: 1, jobTypes: ["research.stage.execute"], executionContext: policies });
      for (let i = 0; i < 10; i++) expect(await worker.tick()).toBe(1);
      expect((await research.findById(workspaceId, run.snapshot.id))?.snapshot.status).toBe("completed");
      expect(calls).toBeGreaterThanOrEqual(8);
      expect([...models].sort()).toEqual(legacyTiers ? ["legacy-executor", "legacy-model"] : ["legacy-model"]);
      if (legacyTiers) {
        const [settings] = await database.client`select research_models, synthesis_models from workspace_ai_settings where workspace_id = ${workspaceId}`;
        expect(settings).toMatchObject({ research_models: ["legacy-model"], synthesis_models: ["legacy-executor"] });
      }
    } finally { provider.stop(true); await database.client`delete from jobs where workspace_id = ${workspaceId}`; }
  });

});
