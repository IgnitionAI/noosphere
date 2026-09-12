import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ModelFallbackObservation, ModelFallbackRecorder } from "@outbound/application/ai/model-fallback-recorder";
import type { Database } from "@outbound/infrastructure/database/client";
import { jobs, outboxEvents } from "@outbound/infrastructure/database/schema";

export class PostgresModelFallbackRecorder implements ModelFallbackRecorder {
  constructor(private readonly database: Database, private readonly currentJobId: (workspaceId: string) => string | undefined = () => undefined) {}
  async record(input: ModelFallbackObservation): Promise<void> {
    const jobId = this.currentJobId(input.workspaceId);
    const [job] = jobId ? await this.database.select({ id: jobs.id, correlationId: jobs.correlationId }).from(jobs).where(and(eq(jobs.workspaceId, input.workspaceId), eq(jobs.id, jobId))).limit(1) : [];
    if (jobId && !job) throw new Error("JOB_AI_CONTEXT_NOT_FOUND");
    const hash = createHash("sha256").update(JSON.stringify([input.workspaceId, jobId ?? null, input.requestKey, input.capability, input.selected, input.reason])).digest("hex");
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const now = new Date();
    await this.database.insert(outboxEvents).values({ id, workspaceId: input.workspaceId, aggregateType: job ? "job" : "ai_invocation", aggregateId: job?.id ?? id, eventType: "AiFallbackUsed", payload: { ...(job ? { jobId: job.id } : {}), correlationId: job?.correlationId ?? `ai:${id}`, capability: input.capability, primary: input.primary, selected: input.selected, reason: input.reason }, availableAt: now, createdAt: now }).onConflictDoNothing({ target: outboxEvents.id });
  }
}
