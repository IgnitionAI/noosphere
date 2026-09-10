import { EditorialStrategyApplication } from "@outbound/application/content/editorial-strategy";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";

/** Prepares a durable draft only; activation/publication remains a separate operation. */
export class ResearchInboundPreparationProcessor {
  constructor(private readonly application: EditorialStrategyApplication, private readonly queue: JobQueue, private readonly clock: Clock) {}

  async process(job: LeasedJob): Promise<void> {
    const payload = job.payload as Record<string, unknown>;
    if (!payload || payload.workspaceId !== job.workspaceId || ["runId", "offerVersionId", "icpVersionId"].some((key) => typeof payload[key] !== "string")) throw new Error("INVALID_RESEARCH_INBOUND_JOB");
    await this.application.derive({
      workspaceId: job.workspaceId, userId: null, requestKey: typeof payload.requestKey === "string" ? payload.requestKey : `research-inbound:${payload.runId}`,
      ...(payload.expectedUpdatedAt === null || typeof payload.expectedUpdatedAt === "string" ? { expectedUpdatedAt: payload.expectedUpdatedAt } : {}),
      sources: { offerVersionId: payload.offerVersionId as string, icpVersionId: payload.icpVersionId as string },
    });
    await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
  }
}
