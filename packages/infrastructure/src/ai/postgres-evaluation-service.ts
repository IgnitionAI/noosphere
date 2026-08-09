import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import { assertSyntheticEvaluationCase } from "@outbound/domain/ai/evaluation";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  aiConfigurations,
  aiFeedbacks,
  aiPromptVersions,
  aiRuns,
  auditLogs,
  evaluationCaseResults,
  evaluationCases,
  evaluationDatasets,
  evaluationRuns,
  jobs,
  knowledgeClaims,
  knowledgeClaimSources,
  knowledgeSources,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Capability = typeof evaluationDatasets.$inferInsert.capability;
type ConfigurationStatus = typeof aiConfigurations.$inferInsert.status;

export class EvaluationServiceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "EvaluationServiceError";
  }
}

export class PostgresEvaluationService {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
  ) {}

  async createDataset(input: {
    workspaceId: string;
    actorUserId: string;
    capability: Capability;
    name: string;
    description?: string | null | undefined;
    rubricVersion: string;
    cases: readonly {
      name: string;
      input: unknown;
      expected: Record<string, unknown>;
      criteria?: Record<string, unknown> | undefined;
      authorizedKnowledgeClaimIds?: readonly string[] | undefined;
    }[];
  }) {
    const name = input.name.trim();
    const rubricVersion = input.rubricVersion.trim();
    if (!name || name.length > 300 || !rubricVersion || rubricVersion.length > 120 || input.cases.length === 0) {
      throw new EvaluationServiceError("EVALUATION_DATASET_INVALID", 422);
    }
    try { assertSyntheticEvaluationCase({ input: { name, description: input.description ?? null }, expected: {} }); }
    catch { throw new EvaluationServiceError("EVALUATION_CASE_PII_FORBIDDEN", 422); }
    for (const item of input.cases) {
      if (!item.name.trim() || item.name.length > 300 || (Object.keys(item.expected).length === 0 && Object.keys(item.criteria ?? {}).length === 0)) {
        throw new EvaluationServiceError("EVALUATION_CASE_EXPECTATION_REQUIRED", 422);
      }
      try { assertSyntheticEvaluationCase({ input: { name: item.name, value: item.input, criteria: item.criteria ?? {} }, expected: item.expected }); }
      catch { throw new EvaluationServiceError("EVALUATION_CASE_PII_FORBIDDEN", 422); }
    }
    const authorizedIds = [...new Set(input.cases.flatMap((item) => item.authorizedKnowledgeClaimIds ?? []))];
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:${input.capability}:${name}`}))`);
      if (authorizedIds.length) await assertAuthorizedClaims(tx, input.workspaceId, authorizedIds, this.clock.now());
      const [previous] = await tx.select({ version: evaluationDatasets.version }).from(evaluationDatasets).where(and(eq(evaluationDatasets.workspaceId, input.workspaceId), eq(evaluationDatasets.capability, input.capability), eq(evaluationDatasets.name, name))).orderBy(desc(evaluationDatasets.version)).limit(1);
      const version = (previous?.version ?? 0) + 1;
      const datasetId = this.ids.generate();
      const [dataset] = await tx.insert(evaluationDatasets).values({
        id: datasetId,
        workspaceId: input.workspaceId,
        capability: input.capability,
        name,
        description: input.description?.trim() || null,
        rubricVersion,
        version,
        createdBy: input.actorUserId,
        createdAt: this.clock.now(),
      }).returning();
      await tx.insert(evaluationCases).values(input.cases.map((item) => ({
        id: this.ids.generate(),
        workspaceId: input.workspaceId,
        datasetId,
        name: item.name.trim(),
        input: item.input as never,
        expected: item.expected,
        criteria: item.criteria ?? {},
        authorizedKnowledgeClaimIds: [...new Set(item.authorizedKnowledgeClaimIds ?? [])],
        createdAt: this.clock.now(),
      })));
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "EvaluationDatasetCreated", subjectType: "EvaluationDataset", subjectId: datasetId, changes: { capability: input.capability, caseCount: input.cases.length, rubricVersion, version } });
      return dataset!;
    });
  }

  async createPromptVersion(input: { workspaceId: string; actorUserId: string; capability: Capability; content: string }) {
    const content = input.content.trim();
    if (!content || content.length > 100_000) throw new EvaluationServiceError("PROMPT_CONTENT_INVALID", 422);
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:${input.capability}`}))`);
      const [previous] = await tx.select().from(aiPromptVersions).where(and(eq(aiPromptVersions.workspaceId, input.workspaceId), eq(aiPromptVersions.capability, input.capability))).orderBy(desc(aiPromptVersions.version)).for("update").limit(1);
      const id = this.ids.generate();
      const version = (previous?.version ?? 0) + 1;
      const [created] = await tx.insert(aiPromptVersions).values({ id, workspaceId: input.workspaceId, capability: input.capability, version, content, previousVersionId: previous?.id ?? null, createdBy: input.actorUserId, createdAt: this.clock.now() }).returning();
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "AiPromptVersionCreated", subjectType: "AiPromptVersion", subjectId: id, changes: { capability: input.capability, version, previousVersionId: previous?.id ?? null } });
      return created!;
    });
  }

  async createConfiguration(input: { workspaceId: string; actorUserId: string; capability: Capability; provider: string; model: string; promptVersionId: string; status?: Exclude<ConfigurationStatus, "active" | "retired"> }) {
    const provider = input.provider.trim();
    const model = input.model.trim();
    if (!provider || !model || provider !== "kimi-code") throw new EvaluationServiceError("AI_CONFIGURATION_PROVIDER_INVALID", 422);
    const policy = await this.modelPolicyReader?.find(input.workspaceId);
    const configuredModels = new Set(policy ? [...policy.researchModels, ...policy.synthesisModels] : ["k3", "k3-256k"]);
    if (!configuredModels.has(model)) throw new EvaluationServiceError("AI_CONFIGURATION_MODEL_NOT_ALLOWED", 422);
    return this.database.transaction(async (tx) => {
      const [prompt] = await tx.select().from(aiPromptVersions).where(and(eq(aiPromptVersions.workspaceId, input.workspaceId), eq(aiPromptVersions.id, input.promptVersionId), eq(aiPromptVersions.capability, input.capability))).limit(1);
      if (!prompt) throw new EvaluationServiceError("AI_PROMPT_VERSION_NOT_FOUND", 422);
      const id = this.ids.generate();
      const [configuration] = await tx.insert(aiConfigurations).values({ id, workspaceId: input.workspaceId, capability: input.capability, provider, model, promptVersionId: prompt.id, status: input.status ?? "candidate", createdBy: input.actorUserId, createdAt: this.clock.now(), updatedAt: this.clock.now() }).returning();
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "AiConfigurationCreated", subjectType: "AiConfiguration", subjectId: id, changes: { capability: input.capability, provider, model, promptVersionId: prompt.id, status: configuration!.status } });
      return configuration!;
    });
  }

  async requestRun(input: { workspaceId: string; actorUserId: string; datasetId: string; configurationId: string; requestKey: string }) {
    const requestKey = input.requestKey.trim();
    if (!requestKey || requestKey.length > 300) throw new EvaluationServiceError("EVALUATION_REQUEST_KEY_INVALID", 422);
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(evaluationRuns).where(and(eq(evaluationRuns.workspaceId, input.workspaceId), eq(evaluationRuns.requestKey, requestKey))).limit(1);
      if (existing) return existing;
      const [dataset] = await tx.select().from(evaluationDatasets).where(and(eq(evaluationDatasets.workspaceId, input.workspaceId), eq(evaluationDatasets.id, input.datasetId))).limit(1);
      const [configuration] = await tx.select().from(aiConfigurations).where(and(eq(aiConfigurations.workspaceId, input.workspaceId), eq(aiConfigurations.id, input.configurationId))).limit(1);
      if (!dataset || !configuration || dataset.capability !== configuration.capability) throw new EvaluationServiceError("EVALUATION_CONFIGURATION_MISMATCH", 422);
      const cases = await tx.select({ id: evaluationCases.id }).from(evaluationCases).where(and(eq(evaluationCases.workspaceId, input.workspaceId), eq(evaluationCases.datasetId, input.datasetId))).orderBy(asc(evaluationCases.createdAt), asc(evaluationCases.id));
      if (!cases.length) throw new EvaluationServiceError("EVALUATION_DATASET_EMPTY", 422);
      const runId = this.ids.generate();
      const [run] = await tx.insert(evaluationRuns).values({ id: runId, workspaceId: input.workspaceId, datasetId: dataset.id, configurationId: configuration.id, requestKey, totalCases: cases.length, createdBy: input.actorUserId, createdAt: this.clock.now(), updatedAt: this.clock.now() }).onConflictDoNothing({ target: [evaluationRuns.workspaceId, evaluationRuns.requestKey] }).returning();
      if (!run) {
        const [winner] = await tx.select().from(evaluationRuns).where(and(eq(evaluationRuns.workspaceId, input.workspaceId), eq(evaluationRuns.requestKey, requestKey))).limit(1);
        if (!winner) throw new EvaluationServiceError("EVALUATION_RUN_CREATE_CONFLICT", 409);
        return winner;
      }
      await tx.insert(evaluationCaseResults).values(cases.map((item) => ({ id: this.ids.generate(), workspaceId: input.workspaceId, evaluationRunId: runId, evaluationCaseId: item.id, createdAt: this.clock.now(), updatedAt: this.clock.now() })));
      const eventId = await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "EvaluationRunStarted", subjectType: "EvaluationRun", subjectId: runId, changes: { datasetId: dataset.id, configurationId: configuration.id, requestKey, totalCases: cases.length } });
      await tx.insert(jobs).values({ id: this.ids.generate(), workspaceId: input.workspaceId, type: "ai.evaluation.execute", payload: { workspaceId: input.workspaceId, runId }, idempotencyKey: `evaluation:${runId}`, correlationId: `evaluation:${eventId}`, maxAttempts: 3, availableAt: this.clock.now() }).onConflictDoNothing();
      return run;
    });
  }

  async retryFailedRun(input: { workspaceId: string; actorUserId: string; runId: string; requestKey: string }) {
    return this.database.transaction(async (tx) => {
      const [run] = await tx.select().from(evaluationRuns).where(and(eq(evaluationRuns.workspaceId, input.workspaceId), eq(evaluationRuns.id, input.runId))).for("update").limit(1);
      if (!run) throw new EvaluationServiceError("EVALUATION_RUN_NOT_FOUND", 404);
      const retryKey = `evaluation-retry:${run.id}:${input.requestKey.trim()}`;
      const [existingRetry] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.workspaceId, input.workspaceId), eq(jobs.type, "ai.evaluation.execute"), eq(jobs.idempotencyKey, retryKey))).limit(1);
      if (existingRetry) return run;
      if (run.status !== "partial" && run.status !== "failed") throw new EvaluationServiceError("EVALUATION_RUN_NOT_RETRYABLE", 409);
      const failed = await tx.update(evaluationCaseResults).set({ status: "pending", errorCode: null, updatedAt: this.clock.now() }).where(and(eq(evaluationCaseResults.workspaceId, input.workspaceId), eq(evaluationCaseResults.evaluationRunId, run.id), eq(evaluationCaseResults.status, "failed"))).returning({ id: evaluationCaseResults.id });
      if (!failed.length) throw new EvaluationServiceError("EVALUATION_RUN_NOT_RETRYABLE", 409);
      await tx.update(evaluationRuns).set({ status: "queued", failedCases: 0, completedAt: null, updatedAt: this.clock.now() }).where(and(eq(evaluationRuns.workspaceId, input.workspaceId), eq(evaluationRuns.id, run.id)));
      await tx.insert(jobs).values({ id: this.ids.generate(), workspaceId: input.workspaceId, type: "ai.evaluation.execute", payload: { workspaceId: input.workspaceId, runId: run.id }, idempotencyKey: retryKey, correlationId: `evaluation-retry:${run.id}`, maxAttempts: 3, availableAt: this.clock.now() }).onConflictDoNothing();
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "EvaluationRunRetried", subjectType: "EvaluationRun", subjectId: run.id, changes: { failedCases: failed.length, requestKey: input.requestKey.trim() } });
      return { ...run, status: "queued" as const };
    });
  }

  async promoteConfiguration(input: { workspaceId: string; actorUserId: string; configurationId: string }) {
    return this.database.transaction(async (tx) => {
      const [candidate] = await tx.select().from(aiConfigurations).where(and(eq(aiConfigurations.workspaceId, input.workspaceId), eq(aiConfigurations.id, input.configurationId))).for("update").limit(1);
      if (!candidate) throw new EvaluationServiceError("AI_CONFIGURATION_NOT_FOUND", 404);
      if (candidate.status === "active") throw new EvaluationServiceError("AI_CONFIGURATION_ALREADY_ACTIVE", 409);
      const [successfulRun] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(eq(evaluationRuns.workspaceId, input.workspaceId), eq(evaluationRuns.configurationId, candidate.id), eq(evaluationRuns.status, "completed"))).limit(1);
      if (!successfulRun) throw new EvaluationServiceError("AI_CONFIGURATION_EVALUATION_REQUIRED", 409);
      await tx.update(aiConfigurations).set({ status: "retired", updatedAt: this.clock.now() }).where(and(eq(aiConfigurations.workspaceId, input.workspaceId), eq(aiConfigurations.capability, candidate.capability), eq(aiConfigurations.status, "active")));
      const [promoted] = await tx.update(aiConfigurations).set({ status: "active", promotedBy: input.actorUserId, promotedAt: this.clock.now(), updatedAt: this.clock.now() }).where(and(eq(aiConfigurations.workspaceId, input.workspaceId), eq(aiConfigurations.id, candidate.id))).returning();
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "AiConfigurationPromoted", subjectType: "AiConfiguration", subjectId: candidate.id, changes: { capability: candidate.capability, evaluationRunId: successfulRun.id } });
      return promoted!;
    });
  }

  async recordFeedback(input: { workspaceId: string; actorUserId: string; aiRunId: string; rating: -1 | 1; reason?: string | null | undefined }) {
    const reason = input.reason?.trim() || null;
    return this.database.transaction(async (tx) => {
      const [run] = await tx.select({ id: aiRuns.id }).from(aiRuns).where(and(eq(aiRuns.workspaceId, input.workspaceId), eq(aiRuns.id, input.aiRunId))).limit(1);
      if (!run) throw new EvaluationServiceError("AI_RUN_NOT_FOUND", 404);
      const [feedback] = await tx.insert(aiFeedbacks).values({ id: this.ids.generate(), workspaceId: input.workspaceId, aiRunId: run.id, rating: input.rating, reason, createdBy: input.actorUserId, createdAt: this.clock.now() }).onConflictDoUpdate({ target: [aiFeedbacks.workspaceId, aiFeedbacks.aiRunId, aiFeedbacks.createdBy], set: { rating: input.rating, reason } }).returning();
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "AiFeedbackRecorded", subjectType: "AiRun", subjectId: run.id, changes: { rating: input.rating, reason } });
      return feedback!;
    });
  }

  async listDatasets(input: { workspaceId: string }) {
    const datasets = await this.database.select().from(evaluationDatasets).where(eq(evaluationDatasets.workspaceId, input.workspaceId)).orderBy(desc(evaluationDatasets.createdAt));
    const counts = await this.database.select({ datasetId: evaluationCases.datasetId, count: sql<number>`count(*)::int` }).from(evaluationCases).where(eq(evaluationCases.workspaceId, input.workspaceId)).groupBy(evaluationCases.datasetId);
    return datasets.map((dataset) => ({ ...dataset, caseCount: counts.find((item) => item.datasetId === dataset.id)?.count ?? 0 }));
  }

  async listConfigurations(input: { workspaceId: string }) {
    return this.database.select({ configuration: aiConfigurations, prompt: aiPromptVersions }).from(aiConfigurations).innerJoin(aiPromptVersions, and(eq(aiPromptVersions.workspaceId, aiConfigurations.workspaceId), eq(aiPromptVersions.id, aiConfigurations.promptVersionId))).where(eq(aiConfigurations.workspaceId, input.workspaceId)).orderBy(asc(aiConfigurations.capability), desc(aiPromptVersions.version));
  }

  async listRuns(input: { workspaceId: string }) {
    return this.database.select().from(evaluationRuns).where(eq(evaluationRuns.workspaceId, input.workspaceId)).orderBy(desc(evaluationRuns.createdAt));
  }

  async getRun(input: { workspaceId: string; runId: string }) {
    const [run] = await this.database.select().from(evaluationRuns).where(and(eq(evaluationRuns.workspaceId, input.workspaceId), eq(evaluationRuns.id, input.runId))).limit(1);
    if (!run) throw new EvaluationServiceError("EVALUATION_RUN_NOT_FOUND", 404);
    const results = await this.database.select().from(evaluationCaseResults).where(and(eq(evaluationCaseResults.workspaceId, input.workspaceId), eq(evaluationCaseResults.evaluationRunId, run.id))).orderBy(asc(evaluationCaseResults.createdAt));
    return { ...run, results };
  }

  async compareRuns(input: { workspaceId: string; leftRunId: string; rightRunId: string }) {
    const [left, right] = await Promise.all([this.getRun({ workspaceId: input.workspaceId, runId: input.leftRunId }), this.getRun({ workspaceId: input.workspaceId, runId: input.rightRunId })]);
    if (left.datasetId !== right.datasetId) throw new EvaluationServiceError("EVALUATION_COMPARISON_DATASET_MISMATCH", 422);
    const leftScores = numericScores(left.aggregateScores);
    const rightScores = numericScores(right.aggregateScores);
    const candidateIsSafe = (rightScores.exactness ?? 0) >= (leftScores.exactness ?? 0)
      && (rightScores.hallucinationRate ?? 0) <= (leftScores.hallucinationRate ?? 0)
      && right.status === "completed";
    return {
      left,
      right,
      recommendation: {
        decision: candidateIsSafe ? "consider_candidate" as const : "keep_baseline" as const,
        requiresHumanApproval: true as const,
        autoApplied: false as const,
        explanation: candidateIsSafe
          ? "La candidate ne régresse ni en exactitude ni en hallucination. Vérifiez le coût, la latence et la qualité avant promotion humaine."
          : "La candidate régresse ou reste incomplète. Conservez la baseline et révisez le prompt ou le modèle.",
      },
    };
  }
}

function numericScores(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => typeof item === "number" && Number.isFinite(item) ? [[key, item]] : []));
}

async function assertAuthorizedClaims(tx: Transaction, workspaceId: string, claimIds: readonly string[], now: Date) {
  const rows = await tx.selectDistinct({ id: knowledgeClaims.id }).from(knowledgeClaims).innerJoin(knowledgeClaimSources, and(eq(knowledgeClaimSources.workspaceId, knowledgeClaims.workspaceId), eq(knowledgeClaimSources.claimId, knowledgeClaims.id))).innerJoin(knowledgeSources, and(eq(knowledgeSources.workspaceId, knowledgeClaimSources.workspaceId), eq(knowledgeSources.id, knowledgeClaimSources.sourceId))).where(and(eq(knowledgeClaims.workspaceId, workspaceId), inArray(knowledgeClaims.id, [...claimIds]), eq(knowledgeClaims.status, "validated"), eq(knowledgeSources.status, "validated"), sql`${knowledgeSources.freshnessUntil} > ${now}`));
  if (rows.length !== claimIds.length) throw new EvaluationServiceError("EVALUATION_KNOWLEDGE_CLAIM_INVALID", 422);
}

async function recordMutation(tx: Transaction, input: { workspaceId: string; actorUserId: string | null; eventType: string; subjectType: string; subjectId: string; changes: Record<string, unknown> }) {
  const [event] = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: input.subjectType, aggregateId: input.subjectId, eventType: input.eventType, payload: input.changes }).returning({ id: outboxEvents.id });
  if (!event) throw new EvaluationServiceError("EVALUATION_EVENT_FAILED", 409);
  await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: input.eventType, subjectType: input.subjectType, subjectId: input.subjectId, changes: input.changes, sourceEventId: event.id });
  return event.id;
}
