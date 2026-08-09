import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { EvaluationExecutor } from "@outbound/application/ai/evaluation-executor";
import { EvaluationRunProcessor } from "@outbound/infrastructure/ai/evaluation-run-processor";
import { PostgresActiveAiConfigurationReader } from "@outbound/infrastructure/ai/postgres-active-ai-configuration-reader";
import { PostgresAiRunRecorder } from "@outbound/infrastructure/ai/postgres-ai-run-recorder";
import { PostgresEvaluationService } from "@outbound/infrastructure/ai/postgres-evaluation-service";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  aiConfigurations,
  aiRuns,
  authUsers,
  evaluationDatasets,
  evaluationRuns,
  messages,
  outreachActions,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("AI-140 continuous AI evaluation", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const clock = { now: () => new Date("2026-08-09T18:00:00.000Z") };
  const ids = { generate: () => crypto.randomUUID() };
  const service = new PostgresEvaluationService(database.db, clock, ids);
  const queue = new PostgresJobQueue(database.client);
  let executionCount = 0;
  const executor: EvaluationExecutor = {
    async execute(input) {
      executionCount += 1;
      return {
        output: { classification: "qualified", ctaPresent: true, knowledgeClaimIds: [], modelUsed: input.model },
        cost: input.model === "k3" ? 0.02 : 0.01,
        latencyMs: input.model === "k3" ? 250 : 100,
      };
    },
  };
  const processor = new EvaluationRunProcessor(database.db, queue, executor, clock, ids);

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `ai140-${workspaceId}`, name: "AI-140" },
      { id: otherWorkspaceId, slug: `ai140-other-${otherWorkspaceId}`, name: "AI-140 Other" },
    ]);
    await database.db.insert(authUsers).values({ id: ownerId, name: "AI-140 Owner", email: `ai140-${ownerId}@example.com` });
  });

  afterAll(async () => {
    await database.client.begin(async (tx) => {
      await tx`delete from ai_feedbacks where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from evaluation_case_results where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from evaluation_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from ai_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from ai_configurations where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from ai_prompt_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from evaluation_cases where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from evaluation_datasets where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`alter table audit_logs disable trigger user`;
      await tx`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await tx`alter table audit_logs enable trigger user`;
      await tx`delete from auth_users where id = ${ownerId}`;
      await tx`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  test("runs the same dataset idempotently in shadow, compares configurations and promotes only after evaluation", async () => {
    const dataset = await service.createDataset({
      workspaceId,
      actorUserId: ownerId,
      capability: "setter",
      name: "Setter qualification reference",
      rubricVersion: "setter-rubric-v1",
      cases: [{ name: "synthetic qualified lead", input: { message: "Bonjour, je souhaite une démonstration pour ENTREPRISE_EXEMPLE" }, expected: { classification: "qualified", ctaPresent: true } }],
    });
    const promptV1 = await service.createPromptVersion({ workspaceId, actorUserId: ownerId, capability: "setter", content: "Qualifie le besoin sans inventer de fait." });
    const configV1 = await service.createConfiguration({ workspaceId, actorUserId: ownerId, capability: "setter", provider: "kimi-code", model: "k3-256k", promptVersionId: promptV1.id, status: "shadow" });
    const [first, replay] = await Promise.all([
      service.requestRun({ workspaceId, actorUserId: ownerId, datasetId: dataset.id, configurationId: configV1.id, requestKey: "setter-baseline-v1" }),
      service.requestRun({ workspaceId, actorUserId: ownerId, datasetId: dataset.id, configurationId: configV1.id, requestKey: "setter-baseline-v1" }),
    ]);
    expect(replay.id).toBe(first.id);

    const beforeMessages = await countRows(database.client, "messages", workspaceId);
    const beforeActions = await countRows(database.client, "outreach_actions", workspaceId);
    const [job] = await queue.lease({ workerId: "ai140-worker", types: ["ai.evaluation.execute"], limit: 1, leaseMs: 30_000, now: clock.now() });
    await processor.process(job!);
    const completedV1 = await service.getRun({ workspaceId, runId: first.id });
    expect(completedV1).toMatchObject({ status: "completed", completedCases: 1, failedCases: 0, totalLatencyMs: 100 });
    expect(completedV1.aggregateScores).toMatchObject({ exactness: 1, hallucinationRate: 0 });
    expect(await countRows(database.client, "messages", workspaceId)).toBe(beforeMessages);
    expect(await countRows(database.client, "outreach_actions", workspaceId)).toBe(beforeActions);
    expect((await database.db.select().from(aiRuns).where(and(eq(aiRuns.workspaceId, workspaceId), eq(aiRuns.aiConfigurationId, configV1.id))))[0]).toMatchObject({ shadow: true, promptVersionId: promptV1.id, model: "k3-256k" });
    await queue.enqueue({ id: crypto.randomUUID(), workspaceId, type: "ai.evaluation.execute", payload: { workspaceId, runId: first.id }, idempotencyKey: `simulated-redelivery:${first.id}`, correlationId: `simulated-redelivery:${first.id}`, maxAttempts: 1, availableAt: clock.now() });
    const [redelivery] = await queue.lease({ workerId: "ai140-redelivery", types: ["ai.evaluation.execute"], limit: 1, leaseMs: 30_000, now: clock.now() });
    await processor.process(redelivery!);
    expect(await database.db.select().from(aiRuns).where(and(eq(aiRuns.workspaceId, workspaceId), eq(aiRuns.aiConfigurationId, configV1.id)))).toHaveLength(1);
    await service.promoteConfiguration({ workspaceId, actorUserId: ownerId, configurationId: configV1.id });

    const promptV2 = await service.createPromptVersion({ workspaceId, actorUserId: ownerId, capability: "setter", content: "Qualifie et propose un CTA clair sans inventer de fait." });
    const configV2 = await service.createConfiguration({ workspaceId, actorUserId: ownerId, capability: "setter", provider: "kimi-code", model: "k3", promptVersionId: promptV2.id, status: "shadow" });
    await expect(service.promoteConfiguration({ workspaceId, actorUserId: ownerId, configurationId: configV2.id })).rejects.toThrow("AI_CONFIGURATION_EVALUATION_REQUIRED");
    const candidateRun = await service.requestRun({ workspaceId, actorUserId: ownerId, datasetId: dataset.id, configurationId: configV2.id, requestKey: "setter-candidate-v2" });
    const [candidateJob] = await queue.lease({ workerId: "ai140-worker", types: ["ai.evaluation.execute"], limit: 1, leaseMs: 30_000, now: clock.now() });
    await processor.process(candidateJob!);
    const comparison = await service.compareRuns({ workspaceId, leftRunId: first.id, rightRunId: candidateRun.id });
    expect(comparison.left.totalLatencyMs).toBe(100);
    expect(comparison.right.totalLatencyMs).toBe(250);
    expect(comparison.recommendation).toMatchObject({ requiresHumanApproval: true, autoApplied: false });
    const campaignsBeforePromotion = await countRows(database.client, "campaigns", workspaceId);
    await service.promoteConfiguration({ workspaceId, actorUserId: ownerId, configurationId: configV2.id });
    expect(await countRows(database.client, "campaigns", workspaceId)).toBe(campaignsBeforePromotion);
    expect(await new PostgresActiveAiConfigurationReader(database.db).find(workspaceId, "setter")).toMatchObject({ configurationId: configV2.id, promptVersionId: promptV2.id, model: "k3", promptContent: "Qualifie et propose un CTA clair sans inventer de fait." });
    const productionTrace = await new PostgresAiRunRecorder(database.db, clock, ids).record({ workspaceId, purpose: "setter", provider: "kimi-code", model: "k3", promptVersion: "setter-v2", promptVersionId: promptV2.id, aiConfigurationId: configV2.id, shadow: false, inputHash: "synthetic-production-input", output: { intent: "positive" }, status: "completed", cost: null, latencyMs: 120 });
    expect((await database.db.select().from(aiRuns).where(eq(aiRuns.id, productionTrace.id)))[0]).toMatchObject({ shadow: false, aiConfigurationId: configV2.id, promptVersionId: promptV2.id, promptVersion: "setter-v2" });
    expect(await database.db.select().from(aiConfigurations).where(and(eq(aiConfigurations.workspaceId, workspaceId), eq(aiConfigurations.status, "active")))).toHaveLength(1);
    expect((await database.db.select().from(aiConfigurations).where(eq(aiConfigurations.id, configV1.id)))[0]!.status).toBe("retired");
    expect(executionCount).toBe(2);
    await expect(service.getRun({ workspaceId: otherWorkspaceId, runId: first.id })).rejects.toThrow("EVALUATION_RUN_NOT_FOUND");
  });

  test("enforces prompt immutability in PostgreSQL, outside the service layer", async () => {
    const prompt = await service.createPromptVersion({ workspaceId, actorUserId: ownerId, capability: "message_generation", content: "Version immuable" });
    let code = "";
    try { await database.client`update ai_prompt_versions set content = 'mutation interdite' where id = ${prompt.id}`; }
    catch (error) { code = error instanceof Error ? error.message : String(error); }
    expect(code).toContain("AI_PROMPT_VERSION_IMMUTABLE");
  });

  test("creates a new immutable dataset version instead of mutating reference cases", async () => {
    const input = { workspaceId, actorUserId: ownerId, capability: "icp_research" as const, name: "ICP synthetic reference", rubricVersion: "icp-v1", cases: [{ name: "synthetic brief", input: { product: "PRODUIT_EXEMPLE" }, expected: { classification: "viable" } }] };
    const v1 = await service.createDataset(input);
    const v2 = await service.createDataset({ ...input, rubricVersion: "icp-v2" });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    let code = "";
    try { await database.client`update evaluation_datasets set name = 'mutation interdite' where id = ${v1.id}`; }
    catch (error) { code = error instanceof Error ? error.message : String(error); }
    expect(code).toContain("EVALUATION_REFERENCE_IMMUTABLE");
  });

  test("rejects PII before persisting an evaluation dataset", async () => {
    await expect(service.createDataset({
      workspaceId,
      actorUserId: ownerId,
      capability: "message_generation",
      name: "Forbidden real contact",
      rubricVersion: "message-v1",
      cases: [{ name: "real contact", input: { email: "real.person@example.com" }, expected: { ctaPresent: true } }],
    })).rejects.toThrow("EVALUATION_CASE_PII_FORBIDDEN");
    expect(await database.db.select().from(evaluationDatasets).where(and(eq(evaluationDatasets.workspaceId, workspaceId), eq(evaluationDatasets.name, "Forbidden real contact")))).toHaveLength(0);
  });

  test("rejects a Kimi model that is not configured for the workspace", async () => {
    const prompt = await service.createPromptVersion({ workspaceId, actorUserId: ownerId, capability: "setter", content: "Prompt de contrôle" });
    await expect(service.createConfiguration({ workspaceId, actorUserId: ownerId, capability: "setter", provider: "kimi-code", model: "kimi-for-coding", promptVersionId: prompt.id, status: "shadow" })).rejects.toThrow("AI_CONFIGURATION_MODEL_NOT_ALLOWED");
  });

  test("retries only failed cases and deduplicates the retry request", async () => {
    const dataset = await service.createDataset({ workspaceId, actorUserId: ownerId, capability: "message_generation", name: "Retry synthetic reference", rubricVersion: "retry-v1", cases: [{ name: "synthetic message", input: { company: "ENTREPRISE_RETRY" }, expected: { ctaPresent: true } }] });
    const prompt = await service.createPromptVersion({ workspaceId, actorUserId: ownerId, capability: "message_generation", content: "Écris un CTA synthétique." });
    const configuration = await service.createConfiguration({ workspaceId, actorUserId: ownerId, capability: "message_generation", provider: "kimi-code", model: "k3", promptVersionId: prompt.id, status: "shadow" });
    const run = await service.requestRun({ workspaceId, actorUserId: ownerId, datasetId: dataset.id, configurationId: configuration.id, requestKey: "retry-run" });
    let attempts = 0;
    const flakyProcessor = new EvaluationRunProcessor(database.db, queue, {
      async execute() {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("quota reached"), { status: 403 });
        return { output: { content: "Souhaitez-vous une démonstration ?", ctaPresent: true, knowledgeClaimIds: [] }, cost: 0.01, latencyMs: 90 };
      },
    }, clock, ids);
    const [firstJob] = await queue.lease({ workerId: "ai140-flaky", types: ["ai.evaluation.execute"], limit: 1, leaseMs: 30_000, now: clock.now() });
    await flakyProcessor.process(firstJob!);
    expect(await service.getRun({ workspaceId, runId: run.id })).toMatchObject({ status: "failed", failedCases: 1 });
    const firstRetry = await service.retryFailedRun({ workspaceId, actorUserId: ownerId, runId: run.id, requestKey: "retry-failed-once" });
    const replayRetry = await service.retryFailedRun({ workspaceId, actorUserId: ownerId, runId: run.id, requestKey: "retry-failed-once" });
    expect([firstRetry.status, replayRetry.status]).toEqual(["queued", "queued"]);
    const [retryJob] = await queue.lease({ workerId: "ai140-flaky", types: ["ai.evaluation.execute"], limit: 1, leaseMs: 30_000, now: clock.now() });
    await flakyProcessor.process(retryJob!);
    expect(await service.getRun({ workspaceId, runId: run.id })).toMatchObject({ status: "completed", completedCases: 1, failedCases: 0 });
    expect(attempts).toBe(2);
  });
});

async function countRows(client: ReturnType<typeof createDatabase>["client"], table: "messages" | "outreach_actions" | "campaigns", workspaceId: string) {
  const rows = await client<{ count: number }[]>`select count(*)::int as count from ${client(table)} where workspace_id = ${workspaceId}`;
  return rows[0]?.count ?? 0;
}
