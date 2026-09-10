import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { createTaskAiResumePreparation } from "@outbound/infrastructure/ai/postgres-task-ai-resume";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { ModelGateway } from "@outbound/application/ai/model-gateway";
import { ModelRouter } from "@outbound/application/ai/model-router";
import { InstanceAiConnectionsApplication } from "@outbound/application/ai/instance-ai-connections";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, workspaces, evaluationRuns, evaluationCaseResults, taskAiContexts } from "@outbound/infrastructure/database/schema";
import { PostgresInstanceAiConnectionsRepository } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
import { InstanceWorkspaceAiPolicyReader } from "@outbound/infrastructure/ai/instance-ai-runtime";
import { PostgresTaskAiPolicyReader } from "@outbound/infrastructure/ai/postgres-task-ai-policy-reader";
import { TaskAiPolicyScope } from "@outbound/infrastructure/ai/task-ai-policy-scope";
import { PostgresEvaluationService } from "@outbound/infrastructure/ai/postgres-evaluation-service";
import { LangChainEvaluationExecutor } from "@outbound/infrastructure/ai/langchain-evaluation-executor";
import { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";
import { encryptSecret, decryptSecret } from "@outbound/infrastructure/security/secret-crypto";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("managed evaluation routing", () => {
  if (!url) return;
  const database = createDatabase(url);
  beforeAll(() => migrate(database.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` }));
  afterAll(() => database.close());
  test("queues an instance-only candidate, preserves its connection after default change and isolates its snapshot", async () => {
    const workspaceId = crypto.randomUUID(), actorUserId = crypto.randomUUID();
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `eval-${workspaceId}`, name: "Synthetic evaluation" });
    await database.db.insert(authUsers).values({ id: actorUserId, name: "Synthetic owner", email: `${actorUserId}@example.com` });
    const repository = new PostgresInstanceAiConnectionsRepository(database.db, { encrypt: value => encryptSecret(value, "evaluation-fixture"), decrypt: value => decryptSecret(value, "evaluation-fixture") });
    const app = new InstanceAiConnectionsApplication({ async isAdministrator() { return true; } }, repository, { async test() {} });
    const connection = await repository.save({ name: "Synthetic provider", provider: "openrouter", apiKey: "fixture", models: [{ model: "vendor/candidate", reasoningEffort: "medium" }, { model: "vendor/next", reasoningEffort: "low" }] });
    for (const model of ["vendor/candidate", "vendor/next"]) await app.test(actorUserId, { connectionId: connection.id, model });
    await repository.setDefault({ connectionId: connection.id, model: "vendor/candidate" });
    const policies = new InstanceWorkspaceAiPolicyReader({ async find() { return null; } }, repository);
    const prepareResume = createTaskAiResumePreparation({ APP_ENCRYPTION_KEY: "evaluation-fixture" });
    const service = new PostgresEvaluationService(database.db, { now: () => new Date() }, { generate: () => crypto.randomUUID() }, policies, async route => !!route.connectionId && !!await repository.getReadyRoute({ connectionId: route.connectionId, model: route.model }), prepareResume);
    const prompt = await service.createPromptVersion({ workspaceId, actorUserId, capability: "setter", content: "Classify the synthetic case." });
    const configuration = await service.createConfiguration({ workspaceId, actorUserId, capability: "setter", provider: "openrouter", model: "vendor/candidate", promptVersionId: prompt.id });
    const dataset = await service.createDataset({ workspaceId, actorUserId, capability: "setter", name: "Synthetic dataset", rubricVersion: "v1", cases: [{ name: "synthetic", input: { message: "EXEMPLE" }, expected: { classification: "qualified" } }] });
    const request = { workspaceId, actorUserId, datasetId: dataset.id, configurationId: configuration.id, requestKey: "managed-candidate" };
    const run = await service.requestRun(request);
    expect((await service.requestRun(request)).id).toBe(run.id);
    const jobRows = await database.client`select id from jobs where workspace_id = ${workspaceId} and payload->>'runId' = ${run.id}`;
    expect(jobRows).toHaveLength(1);
    const jobId = String(jobRows[0]!.id);
    await repository.setDefault({ connectionId: connection.id, model: "vendor/next" });
    const snapshots = new PostgresTaskAiPolicyReader(database.client);
    await expect(snapshots.find(jobId, crypto.randomUUID())).rejects.toThrow("JOB_AI_CONTEXT_NOT_FOUND");
    const scope = new TaskAiPolicyScope(policies, snapshots);
    const seen: unknown[] = [];
    const gateway: ModelGateway = { provider: "openrouter", transport: "chat-completions", async invokeStructured(request) {
      seen.push({ connectionId: request.connectionId, model: request.model, version: request.connectionVersion });
      return { output: request.parse({ classification: "qualified" }), metadata: { provider: "openrouter", model: request.model, reasoningEffort: request.reasoningEffort, transport: "chat-completions", latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, source: "reported" } } };
    } };
    const executor = new LangChainEvaluationExecutor({}, new WorkspaceStructuredModel(new ModelRouter([gateway]), scope), scope);
    const execution = await scope.run({ id: jobId, workspaceId }, () => executor.execute({ workspaceId, capability: "setter", provider: "openrouter", model: configuration.model, prompt: prompt.content, caseInput: {} }));
    expect(seen).toEqual([{ connectionId: connection.id, model: "vendor/candidate", version: connection.version }]);
    expect(execution.route).toMatchObject({ connectionId: connection.id, model: "vendor/candidate", connectionVersion: connection.version });
    await expect(service.requestRun({ ...request, requestKey: "unselected-now" })).rejects.toThrow("AI_SETUP_REQUIRED");
    // A failed evaluation keeps its candidate when live defaults move elsewhere.
    await database.db.update(evaluationRuns).set({ status: "failed" }).where(eq(evaluationRuns.id, run.id));
    await database.db.update(evaluationCaseResults).set({ status: "failed" }).where(eq(evaluationCaseResults.evaluationRunId, run.id));
    const retry = { workspaceId, actorUserId, runId: run.id, requestKey: "retry-after-default-change" };
    await service.retryFailedRun(retry);
    await service.retryFailedRun(retry);
    const retryJobs = await database.client`select id from jobs where workspace_id = ${workspaceId} and idempotency_key = ${`evaluation-retry:${run.id}:${retry.requestKey}`}`;
    expect(retryJobs).toHaveLength(1);
    expect((await snapshots.find(String(retryJobs[0]!.id), workspaceId))?.capabilityRoutes?.evaluation).toMatchObject([{ connectionId: connection.id, model: "vendor/candidate" }]);

    // Simulate a historical full-chain snapshot: a healthy alternate must not
    // make an unavailable evaluation candidate eligible for manual resume.
    const contextWhere = and(eq(taskAiContexts.workspaceId, workspaceId), eq(taskAiContexts.taskKey, `ai:run:${run.id}`));
    await database.db.update(taskAiContexts).set({ policy: { researchModels: [], synthesisModels: [], defaultRoutes: [
      { provider: "openrouter", connectionId: connection.id, connectionVersion: connection.version, model: "vendor/candidate", reasoningEffort: "medium" },
      { provider: "openrouter", connectionId: connection.id, connectionVersion: connection.version, model: "vendor/next", reasoningEffort: "low" },
    ], capabilityRoutes: {} } }).where(contextWhere);
    await repository.save({ id: connection.id, name: connection.name, provider: "openrouter", models: [{ model: "vendor/next", reasoningEffort: "low" }] });
    await app.test(actorUserId, { connectionId: connection.id, model: "vendor/next" });
    const resumeInput = { workspaceId, taskKey: `ai:run:${run.id}`, capability: "evaluation" as const };
    await expect(database.db.transaction(tx => prepareResume(tx, resumeInput))).rejects.toThrow("AI_SETUP_REQUIRED");
    const renewed = await repository.save({ id: connection.id, name: connection.name, provider: "openrouter", apiKey: "fixture-renewed", models: [{ model: "vendor/candidate", reasoningEffort: "medium" }, { model: "vendor/next", reasoningEffort: "low" }] });
    await app.test(actorUserId, { connectionId: connection.id, model: "vendor/candidate" });
    const resumed = await database.db.transaction(tx => prepareResume(tx, resumeInput));
    expect(resumed.capabilityRoutes?.evaluation).toEqual([{ provider: "openrouter", connectionId: connection.id, connectionVersion: renewed.version, model: "vendor/candidate", reasoningEffort: "medium" }]);

  });
});
