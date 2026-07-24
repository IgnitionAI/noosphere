import type { JobQueue } from "@outbound/application/jobs/job-queue";
import type { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import type { Clock } from "@outbound/application/shared/ports";

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
      types: ["research.stage.execute"],
      limit: this.options.batchSize,
      leaseMs: this.options.leaseMs,
      now: this.clock.now(),
    });
    await Promise.all(jobs.map((job) => this.orchestrator.process(job)));
    return jobs.length;
  }
}
