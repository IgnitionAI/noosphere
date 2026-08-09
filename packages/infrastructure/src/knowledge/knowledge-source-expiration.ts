import { z } from "zod";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import type { PostgresKnowledgeService } from "@outbound/infrastructure/knowledge/postgres-knowledge-service";

const payloadSchema = z.object({ workspaceId: z.string().uuid(), sourceId: z.string().uuid() }).strict();

export class KnowledgeSourceExpirationProcessor {
  constructor(
    private readonly service: Pick<PostgresKnowledgeService, "expireSource">,
    private readonly queue: JobQueue,
    private readonly clock: Clock,
  ) {}

  async process(job: LeasedJob): Promise<void> {
    const payload = payloadSchema.parse(job.payload);
    await this.service.expireSource(payload);
    await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
  }
}
