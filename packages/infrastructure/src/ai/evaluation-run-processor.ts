import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { EvaluationExecutor } from "@outbound/application/ai/evaluation-executor";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import { scoreEvaluationOutput, type EvaluationOutput } from "@outbound/domain/ai/evaluation";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  aiConfigurations,
  aiPromptVersions,
  aiRuns,
  auditLogs,
  evaluationCaseResults,
  evaluationCases,
  evaluationRuns,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";
import { isModelUnavailableError, isProviderQuotaError } from "@outbound/infrastructure/ai/langchain-research-agent-executor";

const payloadSchema = z.object({ workspaceId: z.string().uuid(), runId: z.string().uuid() }).strict();

export class EvaluationRunProcessor {
  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly executor: EvaluationExecutor,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async process(job: LeasedJob): Promise<void> {
    const payload = payloadSchema.parse(job.payload);
    if (payload.workspaceId !== job.workspaceId) throw new Error("EVALUATION_JOB_WORKSPACE_MISMATCH");
    const context = await this.loadContext(payload.workspaceId, payload.runId);
    if (["completed", "partial", "failed"].includes(context.run.status) && context.pending.length === 0) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    await this.database.update(evaluationRuns).set({ status: "running", startedAt: context.run.startedAt ?? this.clock.now(), updatedAt: this.clock.now() }).where(and(eq(evaluationRuns.workspaceId, payload.workspaceId), eq(evaluationRuns.id, payload.runId)));

    for (const item of context.pending) {
      await this.executeCase(context, item);
    }
    await this.complete(payload.workspaceId, payload.runId);
    await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
  }

  private async loadContext(workspaceId: string, runId: string) {
    const [row] = await this.database.select({ run: evaluationRuns, configuration: aiConfigurations, prompt: aiPromptVersions }).from(evaluationRuns).innerJoin(aiConfigurations, and(eq(aiConfigurations.workspaceId, evaluationRuns.workspaceId), eq(aiConfigurations.id, evaluationRuns.configurationId))).innerJoin(aiPromptVersions, and(eq(aiPromptVersions.workspaceId, aiConfigurations.workspaceId), eq(aiPromptVersions.id, aiConfigurations.promptVersionId))).where(and(eq(evaluationRuns.workspaceId, workspaceId), eq(evaluationRuns.id, runId))).limit(1);
    if (!row) throw new Error("EVALUATION_RUN_NOT_FOUND");
    const pending = await this.database.select({ result: evaluationCaseResults, evaluationCase: evaluationCases }).from(evaluationCaseResults).innerJoin(evaluationCases, and(eq(evaluationCases.workspaceId, evaluationCaseResults.workspaceId), eq(evaluationCases.id, evaluationCaseResults.evaluationCaseId))).where(and(eq(evaluationCaseResults.workspaceId, workspaceId), eq(evaluationCaseResults.evaluationRunId, runId), eq(evaluationCaseResults.status, "pending"))).orderBy(asc(evaluationCaseResults.createdAt), asc(evaluationCaseResults.id));
    return { ...row, pending };
  }

  private async executeCase(
    context: Awaited<ReturnType<EvaluationRunProcessor["loadContext"]>>,
    item: Awaited<ReturnType<EvaluationRunProcessor["loadContext"]>>["pending"][number],
  ) {
    const startedAt = this.clock.now();
    try {
      const execution = await this.executor.execute({
        workspaceId: context.run.workspaceId,
        capability: context.configuration.capability,
        provider: context.configuration.provider,
        model: context.configuration.model,
        prompt: context.prompt.content,
        caseInput: item.evaluationCase.input,
      });
      const output = execution.output;
      const scores = scoreEvaluationOutput({
        actual: output,
        expected: asEvaluationOutput(item.evaluationCase.expected),
        criteria: asRecord(item.evaluationCase.criteria),
        authorizedKnowledgeClaimIds: stringArray(item.evaluationCase.authorizedKnowledgeClaimIds),
      });
      await this.database.transaction(async (tx) => {
        const aiRunId = this.ids.generate();
        await tx.insert(aiRuns).values({
          id: aiRunId,
          workspaceId: context.run.workspaceId,
          purpose: `evaluation:${context.configuration.capability}`,
          provider: context.configuration.provider,
          model: context.configuration.model,
          promptVersion: `${context.configuration.capability}-v${context.prompt.version}`,
          promptVersionId: context.prompt.id,
          aiConfigurationId: context.configuration.id,
          shadow: true,
          inputHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(item.evaluationCase.input)).digest("hex"),
          parameters: { evaluationRunId: context.run.id, evaluationCaseId: item.evaluationCase.id },
          output,
          status: "completed",
          cost: execution.cost === null ? null : String(execution.cost),
          latencyMs: execution.latencyMs,
          createdAt: startedAt,
        });
        await tx.update(evaluationCaseResults).set({ aiRunId, status: "completed", output, scores, cost: execution.cost === null ? null : String(execution.cost), latencyMs: execution.latencyMs, errorCode: null, updatedAt: this.clock.now() }).where(and(eq(evaluationCaseResults.workspaceId, context.run.workspaceId), eq(evaluationCaseResults.id, item.result.id)));
      });
    } catch (error) {
      const errorCode = evaluationErrorCode(error);
      await this.database.update(evaluationCaseResults).set({ status: "failed", errorCode, latencyMs: Math.max(0, this.clock.now().getTime() - startedAt.getTime()), updatedAt: this.clock.now() }).where(and(eq(evaluationCaseResults.workspaceId, context.run.workspaceId), eq(evaluationCaseResults.id, item.result.id)));
    }
  }

  private async complete(workspaceId: string, runId: string) {
    await this.database.transaction(async (tx) => {
      const aggregates = await tx.select({
        status: evaluationCaseResults.status,
        count: sql<number>`count(*)::int`,
        cost: sql<string>`coalesce(sum(${evaluationCaseResults.cost}), 0)::text`,
        latency: sql<number>`coalesce(sum(${evaluationCaseResults.latencyMs}), 0)::int`,
        exactness: sql<number>`coalesce(avg((${evaluationCaseResults.scores}->>'exactness')::numeric), 0)::float8`,
        ctaQuality: sql<number>`coalesce(avg((${evaluationCaseResults.scores}->>'ctaQuality')::numeric), 0)::float8`,
        messageQuality: sql<number>`coalesce(avg((${evaluationCaseResults.scores}->>'messageQuality')::numeric), 0)::float8`,
        claimCompliance: sql<number>`coalesce(avg((${evaluationCaseResults.scores}->>'claimCompliance')::numeric), 0)::float8`,
        hallucinationRate: sql<number>`coalesce(avg((${evaluationCaseResults.scores}->>'hallucinationRate')::numeric), 0)::float8`,
      }).from(evaluationCaseResults).where(and(eq(evaluationCaseResults.workspaceId, workspaceId), eq(evaluationCaseResults.evaluationRunId, runId))).groupBy(evaluationCaseResults.status);
      const completed = aggregates.find((item) => item.status === "completed");
      const failed = aggregates.find((item) => item.status === "failed");
      const completedCases = completed?.count ?? 0;
      const failedCases = failed?.count ?? 0;
      const status = failedCases === 0 ? "completed" as const : completedCases > 0 ? "partial" as const : "failed" as const;
      const aggregateScores = {
        exactness: completed?.exactness ?? 0,
        ctaQuality: completed?.ctaQuality ?? 0,
        messageQuality: completed?.messageQuality ?? 0,
        claimCompliance: completed?.claimCompliance ?? 0,
        hallucinationRate: completed?.hallucinationRate ?? 0,
      };
      const [run] = await tx.update(evaluationRuns).set({ status, completedCases, failedCases, aggregateScores, totalCost: completed?.cost ?? "0", totalLatencyMs: completed?.latency ?? 0, completedAt: this.clock.now(), updatedAt: this.clock.now() }).where(and(eq(evaluationRuns.workspaceId, workspaceId), eq(evaluationRuns.id, runId))).returning();
      if (!run) throw new Error("EVALUATION_RUN_NOT_FOUND");
      const [event] = await tx.insert(outboxEvents).values({ workspaceId, aggregateType: "EvaluationRun", aggregateId: runId, eventType: "EvaluationRunCompleted", payload: { status, completedCases, failedCases, aggregateScores } }).returning({ id: outboxEvents.id });
      if (!event) throw new Error("EVALUATION_EVENT_FAILED");
      await tx.insert(auditLogs).values({ workspaceId, actorUserId: run.createdBy, action: "EvaluationRunCompleted", subjectType: "EvaluationRun", subjectId: runId, changes: { status, completedCases, failedCases, aggregateScores }, sourceEventId: event.id });
    });
  }
}

function asEvaluationOutput(value: unknown): EvaluationOutput {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as EvaluationOutput : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function evaluationErrorCode(error: unknown): string {
  if (isProviderQuotaError(error)) return "MODEL_PROVIDER_QUOTA_EXHAUSTED";
  if (isModelUnavailableError(error)) return "EVALUATION_MODEL_UNAVAILABLE";
  return "EVALUATION_PROVIDER_ERROR";
}
