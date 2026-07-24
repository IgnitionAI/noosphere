import { and, desc, eq, ne } from "drizzle-orm";
import {
  ProductResearchRun,
  type ProductResearchBrief,
  type ProductResearchEvent,
  type ProductResearchRunSnapshot,
  type ResearchCheckpoint,
  type ResearchStage,
} from "@outbound/domain/gtm/product-research";
import type { NewJob } from "@outbound/application/jobs/job-queue";
import type {
  ProductResearchRepository,
  ResearchAIRun,
} from "@outbound/application/gtm/product-research-ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  aiRuns,
  jobs,
  outboxEvents,
  productResearchRuns,
  researchStageRuns,
} from "@outbound/infrastructure/database/schema";

type DbExecutor = Pick<Database, "insert" | "update">;

export class PostgresProductResearchRepository implements ProductResearchRepository {
  constructor(private readonly db: Database) {}

  async insert(run: ProductResearchRun): Promise<void> {
    await this.db.insert(productResearchRuns).values(toRunRow(run));
  }

  async findById(workspaceId: string, runId: string): Promise<ProductResearchRun | null> {
    const rows = await this.db
      .select()
      .from(productResearchRuns)
      .where(and(eq(productResearchRuns.workspaceId, workspaceId), eq(productResearchRuns.id, runId)))
      .limit(1);
    const row = rows[0];
    return row ? ProductResearchRun.restore(toRunSnapshot(row)) : null;
  }

  async findCompletedCheckpoint(
    workspaceId: string,
    runId: string,
    stage: ResearchStage,
  ): Promise<ResearchCheckpoint | null> {
    const rows = await this.db
      .select()
      .from(researchStageRuns)
      .where(
        and(
          eq(researchStageRuns.workspaceId, workspaceId),
          eq(researchStageRuns.runId, runId),
          eq(researchStageRuns.stage, stage),
          eq(researchStageRuns.status, "completed"),
        ),
      )
      .orderBy(desc(researchStageRuns.attempt))
      .limit(1);
    return rows[0] ? toCheckpoint(rows[0]) : null;
  }

  async listCompletedCheckpoints(
    workspaceId: string,
    runId: string,
  ): Promise<readonly ResearchCheckpoint[]> {
    const rows = await this.db
      .select()
      .from(researchStageRuns)
      .where(
        and(
          eq(researchStageRuns.workspaceId, workspaceId),
          eq(researchStageRuns.runId, runId),
          eq(researchStageRuns.status, "completed"),
        ),
      )
      .orderBy(researchStageRuns.startedAt);
    return rows.map(toCheckpoint);
  }

  async commitRunTransition(
    run: ProductResearchRun,
    job: NewJob | null,
    events: readonly ProductResearchEvent[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await updateRun(tx, run);
      if (job) await insertJob(tx, job);
      await insertEvents(tx, events);
    });
  }

  async commitStageStarted(
    run: ProductResearchRun,
    checkpoint: ResearchCheckpoint,
    events: readonly ProductResearchEvent[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await updateRun(tx, run);
      await tx.insert(researchStageRuns).values(toCheckpointRow(checkpoint)).onConflictDoNothing();
      await insertEvents(tx, events);
    });
  }

  async commitStageCompleted(input: {
    run: ProductResearchRun;
    checkpoint: ResearchCheckpoint;
    aiRun: ResearchAIRun;
    nextJob: NewJob | null;
    events: readonly ProductResearchEvent[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await updateRun(tx, input.run);
      const updated = await tx
        .update(researchStageRuns)
        .set(toCheckpointUpdate(input.checkpoint))
        .where(
          and(
            eq(researchStageRuns.workspaceId, input.checkpoint.workspaceId),
            eq(researchStageRuns.id, input.checkpoint.id),
            ne(researchStageRuns.review, "human_reviewed"),
          ),
        )
        .returning({ id: researchStageRuns.id });
      if (updated.length !== 1) throw new Error("CHECKPOINT_HUMAN_REVIEW_LOCKED");
      await tx.insert(aiRuns).values(toAIRunRow(input.aiRun));
      if (input.nextJob) await insertJob(tx, input.nextJob);
      await insertEvents(tx, input.events);
    });
  }

  async commitStageFailed(
    run: ProductResearchRun,
    checkpoint: ResearchCheckpoint,
    events: readonly ProductResearchEvent[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await updateRun(tx, run);
      const updated = await tx
        .update(researchStageRuns)
        .set(toCheckpointUpdate(checkpoint))
        .where(
          and(
            eq(researchStageRuns.workspaceId, checkpoint.workspaceId),
            eq(researchStageRuns.id, checkpoint.id),
            ne(researchStageRuns.review, "human_reviewed"),
          ),
        )
        .returning({ id: researchStageRuns.id });
      if (updated.length !== 1) throw new Error("CHECKPOINT_HUMAN_REVIEW_LOCKED");
      await insertEvents(tx, events);
    });
  }
}

function toAIRunRow(aiRun: ResearchAIRun): typeof aiRuns.$inferInsert {
  return {
    id: aiRun.id,
    workspaceId: aiRun.workspaceId,
    productResearchRunId: aiRun.productResearchRunId,
    researchStageRunId: aiRun.researchStageRunId,
    purpose: aiRun.purpose,
    provider: aiRun.provider,
    model: aiRun.model,
    promptVersion: aiRun.promptVersion,
    inputHash: aiRun.inputHash,
    parameters: aiRun.parameters,
    output: aiRun.output,
    status: aiRun.status,
    cost: aiRun.cost === null ? null : String(aiRun.cost),
    latencyMs: aiRun.latencyMs,
    createdAt: aiRun.createdAt,
  };
}

function toRunRow(run: ProductResearchRun): typeof productResearchRuns.$inferInsert {
  const snapshot = run.snapshot;
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    brief: snapshot.brief,
    status: snapshot.status,
    activeStage: snapshot.activeStage,
    completedStages: snapshot.completedStages,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function toRunSnapshot(row: typeof productResearchRuns.$inferSelect): ProductResearchRunSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    brief: row.brief as ProductResearchBrief,
    status: row.status,
    activeStage: row.activeStage,
    completedStages: row.completedStages as ResearchStage[],
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCheckpoint(row: typeof researchStageRuns.$inferSelect): ResearchCheckpoint {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runId: row.runId,
    stage: row.stage,
    attempt: row.attempt,
    status: row.status,
    review: row.review,
    inputHash: row.inputHash,
    outputHash: row.outputHash,
    output: row.output,
    errorCode: row.errorCode,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function toCheckpointRow(checkpoint: ResearchCheckpoint): typeof researchStageRuns.$inferInsert {
  return {
    id: checkpoint.id,
    workspaceId: checkpoint.workspaceId,
    runId: checkpoint.runId,
    stage: checkpoint.stage,
    attempt: checkpoint.attempt,
    status: checkpoint.status,
    review: checkpoint.review,
    inputHash: checkpoint.inputHash,
    outputHash: checkpoint.outputHash,
    output: checkpoint.output,
    errorCode: checkpoint.errorCode,
    startedAt: checkpoint.startedAt,
    completedAt: checkpoint.completedAt,
  };
}

function toCheckpointUpdate(checkpoint: ResearchCheckpoint) {
  return {
    status: checkpoint.status,
    review: checkpoint.review,
    outputHash: checkpoint.outputHash,
    output: checkpoint.output,
    errorCode: checkpoint.errorCode,
    completedAt: checkpoint.completedAt,
  };
}

async function updateRun(executor: DbExecutor, run: ProductResearchRun): Promise<void> {
  const snapshot = run.snapshot;
  await executor
    .update(productResearchRuns)
    .set({
      status: snapshot.status,
      activeStage: snapshot.activeStage,
      completedStages: snapshot.completedStages,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
    })
    .where(
      and(
        eq(productResearchRuns.workspaceId, snapshot.workspaceId),
        eq(productResearchRuns.id, snapshot.id),
      ),
    );
}

async function insertJob(executor: DbExecutor, job: NewJob): Promise<void> {
  await executor
    .insert(jobs)
    .values({
      id: job.id,
      workspaceId: job.workspaceId,
      type: job.type,
      payload: job.payload,
      idempotencyKey: job.idempotencyKey,
      correlationId: job.correlationId,
      maxAttempts: job.maxAttempts,
      availableAt: job.availableAt,
    })
    .onConflictDoNothing({
      target: [jobs.workspaceId, jobs.type, jobs.idempotencyKey],
    });
}

async function insertEvents(executor: DbExecutor, events: readonly ProductResearchEvent[]): Promise<void> {
  if (!events.length) return;
  await executor.insert(outboxEvents).values(
    events.map((event) => ({
      workspaceId: event.workspaceId,
      aggregateType: "ProductResearchRun",
      aggregateId: event.runId,
      eventType: event.type,
      payload: event,
    })),
  );
}
