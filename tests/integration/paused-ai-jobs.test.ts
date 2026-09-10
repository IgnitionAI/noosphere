import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("paused AI job persistence", () => {
  if (!url) return;
  const database = createDatabase(url);
  beforeAll(() => migrate(database.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` }));
  afterAll(() => database.close());
  test("a paused job remains unleased after time passes and the worker reconnects", async () => {
    const workspaceId = crypto.randomUUID(), id = crypto.randomUUID(), now = new Date();
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `pause-${workspaceId}`, name: "Pause verification" });
    const queue = new PostgresJobQueue(database.client);
    await queue.enqueue({ id, workspaceId, type: "test.ai.pause", payload: {}, idempotencyKey: id, correlationId: id, maxAttempts: 5, availableAt: now });
    const request = { workerId: "pause-test", types: ["test.ai.pause"], limit: 1, leaseMs: 1000, now };
    expect((await queue.lease(request))[0]?.id).toBe(id);
    const reason = { capability: "message_generation" as const, jobId: id, workerId: request.workerId, errorCode: "AI_PROVIDER_QUOTA_EXHAUSTED", errorMessage: "AI_PROVIDER_QUOTA_EXHAUSTED" };
    await queue.pause(reason);
    await queue.pause(reason);
    const restarted = createDatabase(url);
    try {
      expect(await new PostgresJobQueue(restarted.client).lease({ ...request, now: new Date(now.getTime() + 86_400_000) })).toEqual([]);
      const [row] = await restarted.client`select status, attempts, locked_by, last_error_code, ai_pause_capability from jobs where id = ${id}`;
      expect(row).toMatchObject({ status: "paused", ai_pause_capability: "message_generation", attempts: 1, locked_by: null, last_error_code: "AI_PROVIDER_QUOTA_EXHAUSTED" });
    } finally { await restarted.close(); }
  });
});

(url ? test : test.skip)("concurrent research resumes emit one transition and one replacement job", async () => {
  if (!url) return;
  const database = createDatabase(url);
  const { PostgresProductResearchRepository } = await import("@outbound/infrastructure/gtm/postgres-product-research-repository");
  const { CreateProductResearchRun, StartProductResearchRun, PauseProductResearchRun, ResumeProductResearchRun } = await import("@outbound/application/gtm/product-research-use-cases");
  const { CryptoIdGenerator } = await import("@outbound/application/shared/ports");
  const { createTaskAiResumePreparation } = await import("@outbound/infrastructure/ai/postgres-task-ai-resume");
  const repository = new PostgresProductResearchRepository(database.db, createTaskAiResumePreparation({}));
  const ids = new CryptoIdGenerator(), clock = { now: () => new Date() }, workspaceId = ids.generate();
  const { ProductResearchApplication } = await import("@outbound/application/gtm/product-research-application");
  const application = new ProductResearchApplication(repository, repository, ids, clock, async () => false);
  try {
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `resume-${workspaceId}`, name: "Concurrent resume" });
    const run = await new CreateProductResearchRun(repository, ids, clock).execute({ workspaceId, brief: { productUrl: "https://example.com", productName: "Noosphere", description: "B2B", geography: "France", languages: ["fr"], salesMotion: "hybrid", knownCompetitors: [], internalDocumentIds: [], depth: "quick", audienceGoal: "end_customers", buyerConstraints: "", researchVersion: 3 } });
    const input = { workspaceId, runId: run.snapshot.id, correlationId: "resume" };
    await new StartProductResearchRun(repository, ids, clock).execute(input);
    await new PauseProductResearchRun(repository, clock).execute(input);
    const connectionId = crypto.randomUUID();
    const policy = { defaultRoutes: [{ provider: "openai-api", model: "pinned", reasoningEffort: "low", connectionId, connectionVersion: 1 }], capabilityRoutes: {}, researchModels: ["pinned"], synthesisModels: ["pinned"] };
    await database.client`update task_ai_contexts set policy = ${JSON.stringify(policy)}::jsonb where workspace_id = ${workspaceId}`;
    await expect(application.resume(input)).rejects.toThrow("AI_SETUP_REQUIRED");
    expect((await repository.findById(workspaceId, input.runId))?.snapshot.status).toBe("paused");
    await database.client`insert into instance_ai_connections(id, name, provider, base_url, encrypted_api_key, version) values (${connectionId}, 'Resume test', 'openai-api', 'https://api.openai.com/v1', 'test-only', 2)`;
    await database.client`insert into instance_ai_models(connection_id, model, reasoning_effort, connection_version, status) values (${connectionId}, 'pinned', 'high', 2, 'ready')`;
    await Promise.all([1, 2].map(() => application.resume(input)));
    const [events] = await database.client`select count(*)::int as count from outbox_events where aggregate_id = ${input.runId} and event_type = 'ProductResearchResumed'`;
    expect(events?.count).toBe(1);
    const [jobs] = await database.client`select count(*)::int as count from jobs where workspace_id = ${workspaceId}`;
    expect(jobs?.count).toBe(2);
    const [resumedJob] = await database.client`select ai_policy from jobs where workspace_id = ${workspaceId} and idempotency_key like '%:resume:%'`;
    expect(resumedJob?.ai_policy.defaultRoutes).toEqual([{ ...policy.defaultRoutes[0], connectionVersion: 2 }]);
    await database.client`delete from instance_ai_connections where id = ${connectionId}`;

  } finally { await database.client`delete from jobs where workspace_id = ${workspaceId}`; await database.close(); }
});
