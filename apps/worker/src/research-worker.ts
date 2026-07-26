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

export class ResearchWorker {
  #stopping = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly orchestrator: ResearchOrchestrator,
    private readonly clock: Clock,
    private readonly options: ResearchWorkerOptions,
    private readonly documentProcessor?: { process(job: LeasedJob): Promise<void> },
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
    return jobs.length;
  }

  async #processSafely(job: LeasedJob): Promise<void> {
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
      await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 30_000),
        errorCode: "WORKER_UNHANDLED_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
