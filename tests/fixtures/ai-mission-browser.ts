import assert from "node:assert/strict";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { createInstanceAiRepository, createInstanceApiKeyGateways } from "@outbound/infrastructure/ai/instance-ai-runtime";
import { TaskAiPolicyScope } from "@outbound/infrastructure/ai/task-ai-policy-scope";
import { PostgresTaskAiPolicyReader } from "@outbound/infrastructure/ai/postgres-task-ai-policy-reader";
import { createWorkspaceStructuredModelFromEnvironment } from "@outbound/infrastructure/ai/model-runtime-from-environment";
import { LangChainResearchAgentExecutor, resolveResearchModelConfigurationFromEnvironment } from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { CreateProductResearchRun, StartProductResearchRun } from "@outbound/application/gtm/product-research-use-cases";
import { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import { ResearchWorker } from "../../apps/worker/src/research-worker";
import { CryptoIdGenerator } from "@outbound/application/shared/ports";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { validOutputFor } from "./research-agent-fixtures";

const [mode, workspaceId, suppliedRunId] = process.argv.slice(2);
assert(workspaceId);
const url = process.env.TEST_DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_e2e"), "Browser fixture requires disposable E2E database");
const database = createDatabase(url);
try {
  const instance = createInstanceAiRepository(database.db, process.env);
  const research = new PostgresProductResearchRepository(database.db);
  const queue = new PostgresJobQueue(database.client);
  const ids = new CryptoIdGenerator(), clock = { now: () => new Date() };
  let runId = suppliedRunId;
  if (mode === "pause") {
    const connection = await instance.save({ name: "Controlled browser mission", provider: "openrouter", apiKey: "controlled-not-live", models: [{ model: "controlled/original", reasoningEffort: "low" }] });
    const selection = { connectionId: connection.id, model: "controlled/original" };
    const lease = await instance.beginTest(selection);
    assert(await instance.finishTest({ ...lease, errorCode: null }));
    assert(await instance.setDefault(selection));
    const run = await new CreateProductResearchRun(research, ids, clock).execute({ workspaceId, brief: { productUrl: "https://example.com", productName: "Browser mission", description: "B2B growth platform", geography: "France", languages: ["fr"], salesMotion: "hybrid", knownCompetitors: [], internalDocumentIds: [], depth: "quick", audienceGoal: "end_customers", buyerConstraints: "", researchVersion: 3 } });
    runId = run.snapshot.id;
    await new StartProductResearchRun(research, ids, clock).execute({ workspaceId, runId, correlationId: runId });
  }
  assert(runId);
  let firstStageCalls = 0;
  const policies = new TaskAiPolicyScope({ async find() { return null; } }, new PostgresTaskAiPolicyReader(database.client));
  const fetcher = async (_url: string, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "controlled/original");
    const name = body.tools[0].function.name as string;
    if (name === "submit_product_truth") firstStageCalls++;
    if (mode === "pause" && name === "submit_problem_mapping") return Response.json({ error: { code: "insufficient_quota", message: "controlled quota" } }, { status: 429 });
    const output = name === "submit_research_tool_plan" ? { approach: "Controlled evidence", calls: [] } : validOutputFor(name.replace(/^submit_/, "") as Parameters<typeof validOutputFor>[0]);
    return Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(output) } }] } }] });
  };
  const model = createWorkspaceStructuredModelFromEnvironment(process.env, policies, createInstanceApiKeyGateways(instance, process.env, fetcher));
  const executor = new LangChainResearchAgentExecutor({ ...resolveResearchModelConfigurationFromEnvironment(process.env), crawlerServiceUrl: "http://127.0.0.1:1", crawlerApiKey: "unused", modelPolicyReader: policies, routedModel: model });
  const worker = new ResearchWorker(queue, new ResearchOrchestrator(research, queue, executor, ids, clock, new Sha256ContentHasher()), clock, { workerId: `browser-${mode}`, leaseMs: 30_000, batchSize: 1, pollIntervalMs: 1, jobTypes: ["research.stage.execute"], executionContext: policies });
  if (mode === "pause") {
    assert.equal(await worker.tick(), 1);
    assert.equal(await worker.tick(), 1);
    assert.equal((await research.findById(workspaceId, runId))?.snapshot.status, "paused");
    assert.equal(await worker.tick(), 0);
    assert.equal(firstStageCalls, 1);
  } else if (mode === "verify-paused") {
    assert.equal(await worker.tick(), 0);
    assert.equal((await research.findById(workspaceId, runId))?.snapshot.status, "paused");
  } else {
    for (let i = 0; i < 9; i++) assert.equal(await worker.tick(), 1);
    assert.equal((await research.findById(workspaceId, runId))?.snapshot.status, "completed");
    assert.equal(firstStageCalls, 0);
  }
  console.log(`RESULT:${JSON.stringify({ runId })}`);
} finally { await database.close(); }
