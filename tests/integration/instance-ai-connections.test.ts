import { CreateProductResearchRun, StartProductResearchRun } from "@outbound/application/gtm/product-research-use-cases";
import { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import { CryptoIdGenerator } from "@outbound/application/shared/ports";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { workspaces } from "@outbound/infrastructure/database/schema";
import { v3ResearchStages, type ResearchStage } from "@outbound/domain/gtm/product-research";
import { InstanceWorkspaceAiPolicyReader, createInstanceApiKeyGateways, createInstanceWorkspaceAiAvailability } from "@outbound/infrastructure/ai/instance-ai-runtime";
import { createWorkspaceStructuredModelFromEnvironment } from "@outbound/infrastructure/ai/model-runtime-from-environment";
import { LangChainResearchAgentExecutor, resolveResearchModelConfigurationFromEnvironment } from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import { validOutputFor } from "../fixtures/research-agent-fixtures";
import { InstanceAiConnectionsApplication } from "@outbound/application/ai/instance-ai-connections";
import { InstanceModelConnectionTester } from "@outbound/infrastructure/ai/instance-ai-connection-tester";
import { createInstanceAiConnectionsHttpHandler } from "@outbound/interface/http/instance-ai-connections-handler";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresInstanceAiConnectionsRepository } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
import { encryptSecret, decryptSecret } from "@outbound/infrastructure/security/secret-crypto";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("encrypted instance AI connections", () => {
  if (!url) return;
  const database = createDatabase(url);
  const masterKey = "test-only-instance-key-01234567890123456789";
  const cipher = { encrypt: (value: string) => encryptSecret(value, masterKey), decrypt: (value: string) => decryptSecret(value, masterKey) };
  const repository = new PostgresInstanceAiConnectionsRepository(database.db, cipher);
  beforeAll(() => migrate(database.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` }));
  afterAll(() => database.close());

  test("authenticated API saves no plaintext, probes the controlled provider and exposes only a current validated default", async () => {
    let invocations = 0;
    const provider = Bun.serve({ port: 0, fetch(request) {
      invocations++;
      expect(request.headers.get("authorization")).toBe("Bearer controlled-key");
      return Response.json({ output: [{ type: "function_call", name: "connection_probe", arguments: '{"ok":true}' }] });
    } });
    try {
      const tester = new InstanceModelConnectionTester(repository, (_url, options) => fetch(provider.url, options));
      const application = new InstanceAiConnectionsApplication({ async isAdministrator(id) { return id === "admin"; } }, repository, tester);
      const handle = createInstanceAiConnectionsHttpHandler({ application, sessions: { async getSession(headers) { const userId = headers.get("x-test-user"); return userId ? { userId, sessionId: "test-session" } : null; } } });
      const call = (path: string, body?: unknown, user = "admin") => handle(new Request(`http://localhost/api/v1/instance/ai${path}`, { method: body === undefined ? "GET" : "POST", headers: { "x-test-user": user, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      const input = { name: "Controlled OpenAI", provider: "openai-api", apiKey: "controlled-key", models: [{ model: "controlled-model", reasoningEffort: "low" }] };
      expect((await call("/connections", input, "workspace-owner")).status).toBe(403);
      const saved = await call("/connections", input);
      expect(saved.status).toBe(201);
      const text = await saved.text();
      expect(text).not.toContain("controlled-key");
      expect(text).not.toContain("encryptedApiKey");
      const connection = JSON.parse(text);
      const selection = { connectionId: connection.id, model: "controlled-model" };
      expect((await call("/default", selection)).status).toBe(409);
      expect(invocations).toBe(0);
      expect(await (await call("/test", selection)).json()).toMatchObject({ status: "ready", errorCode: null });
      expect(invocations).toBe(1);
      expect((await call("/default", selection)).status).toBe(200);
      expect((await call("", undefined, "workspace-owner")).status).toBe(403);
      const summary = await call("");
      expect(await summary.json()).toMatchObject({ defaultModel: { connectionId: connection.id, model: "controlled-model" } });
    } finally { provider.stop(true); }
  });

  for (const providerId of ["openai-api", "anthropic", "openrouter", "openai-compatible"] as const) test(`${providerId}: a separately composed worker completes a research mission with the persisted default and no environment API key`, async () => {
    let calls = 0;
    const provider = Bun.serve({ port: 0, async fetch(request) {
      calls++;
      expect(request.headers.get(providerId === "anthropic" ? "x-api-key" : "authorization")).toBe(providerId === "anthropic" ? "persisted-worker-key" : "Bearer persisted-worker-key");
      const body = await request.json() as { model: string; tools: { name?: string; function?: { name: string } }[] };
      expect(body.model).toBe("persisted-worker-model");
      const name = body.tools[0]!.name ?? body.tools[0]!.function!.name;
      const stage = name.replace(/^submit_/, "") as ResearchStage;
      const output = name === "connection_probe" ? { ok: true }
        : name === "submit_research_tool_plan" ? { approach: "Use controlled fixture evidence", calls: [] }
        : validOutputFor(stage);
      return Response.json(providerId === "openai-api" ? { output: [{ type: "function_call", name, arguments: JSON.stringify(output) }] }
        : providerId === "anthropic" ? { content: [{ type: "tool_use", name, input: output }] }
        : { choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(output) } }] } }] });
    } });
    try {
      const saved = await repository.save({ name: "Worker provider", provider: providerId, apiKey: "persisted-worker-key", baseUrl: provider.url.toString().replace(/\/$/, ""), models: [{ model: "persisted-worker-model", reasoningEffort: "low" }] });
      // Generic destinations are exercised through a controlled HTTP transport here;
      // the public-DNS/TLS boundary has its own rejection and pinning tests.
      const controlledFetch = (_url: string, options?: RequestInit) => fetch(provider.url, options);
      const application = new InstanceAiConnectionsApplication({ async isAdministrator() { return true; } }, repository, new InstanceModelConnectionTester(repository, controlledFetch));
      const selection = { connectionId: saved.id, model: "persisted-worker-model" };
      expect((await application.test("admin", selection)).status).toBe("ready");
      await application.setDefault("admin", selection);
      const workerDb = createDatabase(url);
      const workspaceId = crypto.randomUUID();
      try {
        const workerRepository = new PostgresInstanceAiConnectionsRepository(workerDb.db, cipher);
        const policies = new InstanceWorkspaceAiPolicyReader({ async find() { return null; } }, workerRepository);
        const available = createInstanceWorkspaceAiAvailability({}, policies, workerRepository);
        expect(await available("workspace", "icp_research")).toBe(true);
        const routedModel = createWorkspaceStructuredModelFromEnvironment({}, policies, createInstanceApiKeyGateways(workerRepository, {}, controlledFetch));
        const executor = new LangChainResearchAgentExecutor({ ...resolveResearchModelConfigurationFromEnvironment({}), crawlerServiceUrl: "http://127.0.0.1:1", crawlerApiKey: "unused", modelPolicyReader: policies, routedModel });
        await workerDb.db.insert(workspaces).values({ id: workspaceId, slug: `instance-ai-${workspaceId}`, name: "Instance AI mission verification" });
        const research = new PostgresProductResearchRepository(workerDb.db);
        const queue = new PostgresJobQueue(workerDb.client);
        const ids = new CryptoIdGenerator();
        const clock = { now: () => new Date() };
        const run = await new CreateProductResearchRun(research, ids, clock).execute({ workspaceId,
          brief: { productUrl: "https://example.com", productName: "Noosphere", description: "B2B growth platform", geography: "France", languages: ["fr"], salesMotion: "hybrid", knownCompetitors: [], internalDocumentIds: [], depth: "quick", audienceGoal: "end_customers", buyerConstraints: "", researchVersion: 3 },
        });
        await new StartProductResearchRun(research, ids, clock).execute({ workspaceId, runId: run.snapshot.id, correlationId: "persisted-instance-ai" });
        const orchestrator = new ResearchOrchestrator(research, queue, executor, ids, clock, new Sha256ContentHasher());
        for (let index = 0; index < 10; index++) {
          const [job] = await queue.lease({ workerId: "instance-ai-mission-test", types: ["research.stage.execute"], limit: 1, leaseMs: 30_000, now: clock.now() });
          expect(job).toBeDefined();
          expect(job?.workspaceId).toBe(workspaceId);
          expect((await orchestrator.process(job!)).outcome).toBe("completed");
        }
        const completed = await research.findById(workspaceId, run.snapshot.id);
        expect(completed?.snapshot.status).toBe("completed");
        expect(completed?.snapshot.completedStages).toEqual([...v3ResearchStages]);
        expect((await research.getReport(workspaceId, run.snapshot.id)).proposals.length).toBeGreaterThan(0);
        expect(calls).toBeGreaterThanOrEqual(8);
      } finally {
        await workerDb.client`delete from jobs where workspace_id = ${workspaceId}`;
        await workerDb.close();
      }
    } finally { provider.stop(true); }
  });

  test("persists encrypted credentials and binds readiness to model and connection revision", async () => {
    const secret = `test-key-${crypto.randomUUID()}`;
    const saved = await repository.save({ name: "OpenAI test", provider: "openai-api", apiKey: secret, models: [{ model: "model-a", reasoningEffort: "high" }, { model: "model-b", reasoningEffort: "low" }] });
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(saved.models.every((model) => model.status === "untested")).toBe(true);
    const [raw] = await database.client`select encrypted_api_key from instance_ai_connections where id = ${saved.id}`;
    expect(raw!.encrypted_api_key).not.toContain(secret);
    expect(decryptSecret(raw!.encrypted_api_key, masterKey)).toBe(secret);
    expect(await repository.setDefault({ connectionId: saved.id, model: "model-a" })).toBe(false);
    const lease = await repository.beginTest({ connectionId: saved.id, model: "model-a" });
    expect(await repository.finishTest({ ...lease, errorCode: null })).toBe(true);
    expect(await repository.setDefault({ connectionId: saved.id, model: "model-a" })).toBe(true);
    expect(await repository.getDefault()).toMatchObject({ connectionId: saved.id, provider: "openai-api", model: "model-a" });
    expect(await repository.setDefault({ connectionId: saved.id, model: "model-b" })).toBe(false);
    const oldLease = await repository.beginTest({ connectionId: saved.id, model: "model-a" });
    const updated = await repository.save({ id: saved.id, name: saved.name, provider: "openai-api", apiKey: "replacement-test-key", models: [{ model: "model-a", reasoningEffort: "high" }] });
    expect(updated.version).toBe(saved.version + 1);
    expect(await repository.finishTest({ ...oldLease, errorCode: null })).toBe(false);
    expect(await repository.getDefault()).toBeNull();
    const policies = new InstanceWorkspaceAiPolicyReader({ async find() { return null; } }, repository);
    const available = createInstanceWorkspaceAiAvailability({ AI_PROVIDER: "kimi-code", KIMI_CODE_API_KEY: "legacy-key-must-not-be-used" }, policies, repository);
    expect((await policies.find("workspace"))?.defaultRoutes?.[0]?.connectionId).toBe(saved.id);
    expect(await available("workspace", "icp_research")).toBe(false);
    const reopened = createDatabase(url);
    try {
      const restored = new PostgresInstanceAiConnectionsRepository(reopened.db, cipher);
      expect((await restored.list()).find((item) => item.id === saved.id)?.models[0]?.status).toBe("untested");
      expect((await restored.getCredential(saved.id, updated.version))?.apiKey).toBe("replacement-test-key");
    } finally { await reopened.close(); }
  });
});
