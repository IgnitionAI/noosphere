import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import { PROSPECT_MEMORY_REFRESH_JOB_TYPE } from "@outbound/application/prospect-memory/prospect-memory";
import type { RefreshProspectMemory } from "@outbound/application/prospect-memory/refresh-prospect-memory";

export class ProspectMemoryRefreshJobProcessor {
  constructor(
    private readonly refresh: RefreshProspectMemory,
    private readonly queue: JobQueue,
    private readonly clock: Clock,
  ) {}

  async process(job: LeasedJob): Promise<void> {
    if (job.type !== PROSPECT_MEMORY_REFRESH_JOB_TYPE) throw new Error("PROSPECT_MEMORY_JOB_TYPE_INVALID");
    const payload = parsePayload(job);
    const result = await this.refresh.execute({
      ...payload,
      requestKey: `${PROSPECT_MEMORY_REFRESH_JOB_TYPE}:${job.id}:${job.attempts}`,
    });
    if (result.outcome === "budget_blocked") {
      await this.queue.defer({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: result.retryAt,
        errorCode: "PROSPECT_MEMORY_BUDGET_BLOCKED",
        errorMessage: "Semantic refresh budget is exhausted; the durable job will resume later.",
      });
      return;
    }
    if (result.outcome === "concurrent_update") {
      await this.queue.defer({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 1_000),
        errorCode: "PROSPECT_MEMORY_CAS_RETRY",
        errorMessage: "A newer snapshot won the compare-and-swap; rebuild from the new watermark.",
      });
      return;
    }
    if (result.outcome === "published" && result.hasMore) {
      await this.queue.defer({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 10),
        errorCode: "PROSPECT_MEMORY_PAGE_CONTINUE",
        errorMessage: "The snapshot page was published; the same durable job will continue from its watermark.",
      });
      return;
    }
    await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
  }
}

function parsePayload(job: LeasedJob): {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly targetSequenceId: number;
  readonly privacyEpoch: number;
} {
  const payload = job.payload;
  if (!isRecord(payload)) throw new Error("PROSPECT_MEMORY_JOB_PAYLOAD_INVALID");
  const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId : job.workspaceId;
  if (workspaceId !== job.workspaceId) throw new Error("PROSPECT_MEMORY_JOB_WORKSPACE_MISMATCH");
  if (
    typeof payload.contactId !== "string"
    || !Number.isSafeInteger(payload.targetSequenceId)
    || Number(payload.targetSequenceId) < 1
    || !Number.isSafeInteger(payload.privacyEpoch)
    || Number(payload.privacyEpoch) < 0
  ) throw new Error("PROSPECT_MEMORY_JOB_PAYLOAD_INVALID");
  return {
    workspaceId,
    contactId: payload.contactId,
    targetSequenceId: Number(payload.targetSequenceId),
    privacyEpoch: Number(payload.privacyEpoch),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
