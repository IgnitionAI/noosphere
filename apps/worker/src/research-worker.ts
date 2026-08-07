import type { JobQueue } from "@outbound/application/jobs/job-queue";
import type { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import type { Clock } from "@outbound/application/shared/ports";
import type { LeasedJob } from "@outbound/application/jobs/job-queue";

export interface ResearchWorkerOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
}

export interface OutboxDispatcher {
  dispatchBatch(): Promise<number>;
}

export class ResearchWorker {
  #stopping = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly orchestrator: ResearchOrchestrator,
    private readonly clock: Clock,
    private readonly options: ResearchWorkerOptions,
    private readonly documentProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly outboxDispatcher?: OutboxDispatcher,
  ) {}

  stop(): void {
    this.#stopping = true;
  }

  async run(): Promise<void> {
    while (!this.#stopping) {
      const processed = await this.tick();
      if (processed === 0) await Bun.sleep(this.options.pollIntervalMs);
    }
  }

  async tick(): Promise<number> {
    const jobs = await this.queue.lease({
      workerId: this.options.workerId,
      types: ["research.stage.execute", "research.document.process"],
      limit: this.options.batchSize,
      leaseMs: this.options.leaseMs,
      now: this.clock.now(),
    });
    await Promise.all(
      jobs.map((job) =>
        this.#processSafely(job),
      ),
    );
    const delivered = this.outboxDispatcher ? await this.outboxDispatcher.dispatchBatch() : 0;
    return jobs.length + delivered;
  }

  async #processSafely(job: LeasedJob): Promise<void> {
    const stopHeartbeat = this.#startLeaseHeartbeat(job);
    try {
      if (job.type === "research.document.process" && this.documentProcessor) {
        await this.documentProcessor.process(job);
      } else {
        await this.orchestrator.process(job);
      }
    } catch (error) {
      // A poisoned job must never kill the worker: requeue it with backoff and
      // let the job table keep the error trail.
      console.error(
        JSON.stringify({
          event: "research_worker_job_error",
          jobId: job.id,
          jobType: job.type,
          attempts: job.attempts,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      try {
        await this.queue.retry({
          jobId: job.id,
          workerId: job.lockedBy,
          availableAt: new Date(this.clock.now().getTime() + 30_000),
          errorCode: "WORKER_UNHANDLED_ERROR",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch (retryError) {
        // Another worker may have reclaimed/finished the job after a lease
        // race. Logging is sufficient: throwing here would contradict the
        // worker's poison-job isolation and stop all unrelated research.
        console.error(
          JSON.stringify({
            event: "research_worker_retry_error",
            jobId: job.id,
            error: retryError instanceof Error ? retryError.message : String(retryError),
          }),
        );
      }
    } finally {
      stopHeartbeat();
    }
  }

  #startLeaseHeartbeat(job: LeasedJob): () => void {
    const intervalMs = Math.max(50, Math.floor(this.options.leaseMs / 3));
    let renewalInFlight = false;
    const timer = setInterval(async () => {
      if (renewalInFlight) return;
      renewalInFlight = true;
      try {
        const renewed = await this.queue.renewLease(
          job.id,
          job.lockedBy,
          new Date(this.clock.now().getTime() + this.options.leaseMs),
        );
        if (!renewed) clearInterval(timer);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "research_worker_lease_renewal_error",
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        renewalInFlight = false;
      }
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
