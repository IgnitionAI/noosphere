import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { PostgresInstanceAiConnectionsRepository } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("AI mission manual resume", () => {
  if (!url) return;
  const database = createDatabase(url);
  beforeAll(() => migrate(database.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` }));
  afterAll(() => database.close());
  test.each([false, true])("quota pause preserves checkpoints; explicitly use current models: %s", async (useCurrentModels) => {
    const { registerRuntimeAiDefaults } = await import("@outbound/infrastructure/ai/register-runtime-ai-defaults");
    const { TaskAiPolicyScope } = await import("@outbound/infrastructure/ai/task-ai-policy-scope");
    const { PostgresTaskAiPolicyReader } = await import("@outbound/infrastructure/ai/postgres-task-ai-policy-reader");
    const { resolveResearchModelPolicyFromEnvironment, resolveResearchModelConfigurationFromEnvironment, LangChainResearchAgentExecutor } = await import("@outbound/infrastructure/ai/langchain-research-agent-executor");
    const { createWorkspaceStructuredModelFromEnvironment } = await import("@outbound/infrastructure/ai/model-runtime-from-environment");
    const { createInstanceApiKeyGateways } = await import("@outbound/infrastructure/ai/instance-ai-runtime");
    const { PostgresProductResearchRepository } = await import("@outbound/infrastructure/gtm/postgres-product-research-repository");
    const { CreateProductResearchRun, StartProductResearchRun, ResumeProductResearchRun } = await import("@outbound/application/gtm/product-research-use-cases");
    const { ResearchOrchestrator } = await import("@outbound/application/gtm/research-orchestrator");
    const { ResearchWorker } = await import("../../apps/worker/src/research-worker");
    const { CryptoIdGenerator } = await import("@outbound/application/shared/ports");
    const { Sha256ContentHasher } = await import("@outbound/infrastructure/shared/sha256-content-hasher");
    const { validOutputFor } = await import("../fixtures/research-agent-fixtures");
    let calls = 0, firstStageCalls = 0, providerHealthy = false;
    const provider = Bun.serve({ port: 0, async fetch(request) {
      calls++;
      const body = await request.json() as { model: string; tools: { function: { name: string } }[] };
      expect(body.model).toBe(providerHealthy && useCurrentModels ? "future-model" : "legacy-model");
      const name = body.tools[0]!.function.name;
      if (name === "submit_product_truth") firstStageCalls++;
      if (name === "submit_problem_mapping" && !providerHealthy) return Response.json({ error: { code: "insufficient_quota", message: "quota exhausted" } }, { status: 429 });
      const output = name === "submit_research_tool_plan" ? { approach: "Controlled evidence", calls: [] } : validOutputFor(name.replace(/^submit_/, "") as Parameters<typeof validOutputFor>[0]);
      return Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(output) } }] } }] });
    } });
    const workspaceId = crypto.randomUUID();
    try {
      await database.client`delete from instance_ai_defaults`;
      await database.db.insert(workspaces).values({ id: workspaceId, slug: `legacy-${workspaceId}`, name: "Legacy mission" });
      const environment = { KIMI_CODE_API_KEY: "controlled", KIMI_CODE_BASE_URL: provider.url.toString(), KIMI_RESEARCH_MODEL: "legacy-model", KIMI_SYNTHESIS_MODEL: "legacy-model" };
      const initial = resolveResearchModelPolicyFromEnvironment(environment);
      await registerRuntimeAiDefaults(database.client, initial);
      const instance = new PostgresInstanceAiConnectionsRepository(database.db, { encrypt: (value) => value, decrypt: (value) => value });
      const policies = new TaskAiPolicyScope({ async find() { return initial; } }, new PostgresTaskAiPolicyReader(database.client));
      const model = createWorkspaceStructuredModelFromEnvironment(environment, policies, createInstanceApiKeyGateways(instance, environment));
      const executor = new LangChainResearchAgentExecutor({ ...resolveResearchModelConfigurationFromEnvironment(environment), crawlerServiceUrl: "http://127.0.0.1:1", crawlerApiKey: "unused", modelPolicyReader: policies, routedModel: model });
      const research = new PostgresProductResearchRepository(database.db), queue = new PostgresJobQueue(database.client);
      const ids = new CryptoIdGenerator(), clock = { now: () => new Date() };
      const run = await new CreateProductResearchRun(research, ids, clock).execute({ workspaceId, brief: { productUrl: "https://example.com", productName: "Noosphere", description: "B2B growth platform", geography: "France", languages: ["fr"], salesMotion: "hybrid", knownCompetitors: [], internalDocumentIds: [], depth: "quick", audienceGoal: "end_customers", buyerConstraints: "", researchVersion: 3 } });
      await new StartProductResearchRun(research, ids, clock).execute({ workspaceId, runId: run.snapshot.id, correlationId: "legacy-capture" });
      await registerRuntimeAiDefaults(database.client, resolveResearchModelPolicyFromEnvironment({ ...environment, KIMI_RESEARCH_MODEL: "future-model", KIMI_SYNTHESIS_MODEL: "future-model" }));
      const orchestrator = new ResearchOrchestrator(research, queue, executor, ids, clock, new Sha256ContentHasher());
      const worker = new ResearchWorker(queue, orchestrator, clock, { workerId: "legacy-capture", leaseMs: 30_000, batchSize: 1, pollIntervalMs: 1, jobTypes: ["research.stage.execute"], executionContext: policies });
      expect(await worker.tick()).toBe(1);
      expect(await worker.tick()).toBe(1);
      expect((await research.findById(workspaceId, run.snapshot.id))?.snapshot.status).toBe("paused");
      const beforeRecovery = calls;
      expect(await worker.tick()).toBe(0);
      providerHealthy = true;
      const restarted = createDatabase(url);
      try {
        const { createTaskAiResumePreparation } = await import("@outbound/infrastructure/ai/postgres-task-ai-resume");
        const restartedResearch = new PostgresProductResearchRepository(restarted.db, createTaskAiResumePreparation(environment));
        const restartedQueue = new PostgresJobQueue(restarted.client);
        const restartedPolicies = new TaskAiPolicyScope({ async find() { return null; } }, new PostgresTaskAiPolicyReader(restarted.client));
        const restartedModel = createWorkspaceStructuredModelFromEnvironment(environment, restartedPolicies, createInstanceApiKeyGateways(new PostgresInstanceAiConnectionsRepository(restarted.db, { encrypt: (value) => value, decrypt: (value) => value }), environment));
        const restartedExecutor = new LangChainResearchAgentExecutor({ ...resolveResearchModelConfigurationFromEnvironment(environment), crawlerServiceUrl: "http://127.0.0.1:1", crawlerApiKey: "unused", modelPolicyReader: restartedPolicies, routedModel: restartedModel });
        const restartedWorker = new ResearchWorker(restartedQueue, new ResearchOrchestrator(restartedResearch, restartedQueue, restartedExecutor, ids, clock, new Sha256ContentHasher()), clock, { workerId: "restarted", leaseMs: 30_000, batchSize: 1, pollIntervalMs: 1, jobTypes: ["research.stage.execute"], executionContext: restartedPolicies });
        expect(await restartedWorker.tick()).toBe(0);
        expect(calls).toBe(beforeRecovery);
        if (useCurrentModels) {
          const [paused] = await restarted.client`select id from jobs where workspace_id = ${workspaceId} and status = 'paused' limit 1`;
          expect(paused).toBeDefined();
          await restarted.client`update jobs set status = 'running', locked_until = now() + interval '1 minute' where id = ${paused!.id}`;
          await expect(new ResumeProductResearchRun(restartedResearch, ids, clock).execute({ workspaceId, runId: run.snapshot.id, correlationId: "busy-model-change", useCurrentModels: true })).rejects.toThrow("RESEARCH_MODEL_CHANGE_BUSY");
          expect((await restartedResearch.findById(workspaceId, run.snapshot.id))?.snapshot.status).toBe("paused");
          await restarted.client`update jobs set status = 'paused', locked_until = null where id = ${paused!.id}`;
        }
        await Promise.all([1, 2].map(() => new ResumeProductResearchRun(restartedResearch, ids, clock).execute({ workspaceId, runId: run.snapshot.id, correlationId: "manual-resume", useCurrentModels })));
        for (let i = 0; i < 9; i++) expect(await restartedWorker.tick()).toBe(1);
        expect((await restartedResearch.findById(workspaceId, run.snapshot.id))?.snapshot.status).toBe("completed");
        expect(firstStageCalls).toBe(1);
      } finally { await restarted.close(); }
      expect(calls).toBeGreaterThanOrEqual(8);
    } finally { provider.stop(true); await database.client`delete from jobs where workspace_id = ${workspaceId}`; }
  });

});
