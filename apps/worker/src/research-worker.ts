import type { JobQueue } from "@outbound/application/jobs/job-queue";
import type { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import type { Clock } from "@outbound/application/shared/ports";
import type { LeasedJob } from "@outbound/application/jobs/job-queue";

export interface ResearchWorkerOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly leaseHeartbeatMs?: number;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly jobTypes?: readonly string[];
  readonly excludedJobTypes?: readonly string[];
}

export interface OutboxDispatcher {
  dispatchBatch(): Promise<number>;
}

export interface OutreachSchedulerProcessor {
  markDue(input: { now: Date; queue: JobQueue }): Promise<number>;
  execute(input: { workspaceId: string; actionId: string; now: Date }): Promise<unknown>;
}

export class ResearchWorker {
  #stopping = false;
  #lastMaintenanceAt = 0;
  #maintenanceInFlight: Promise<void> | null = null;

  constructor(
    private readonly queue: JobQueue,
    private readonly orchestrator: ResearchOrchestrator,
    private readonly clock: Clock,
    private readonly options: ResearchWorkerOptions,
    private readonly documentProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly discoveryProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly channelAssessmentProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly campaignAutomationProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly campaignCompositionProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly outreachDispatchProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly inboundReplyProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly automatedReplySendProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly conversationCommandProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly maintenance?: { reconcile(): Promise<number> },
    private readonly outboxDispatcher?: OutboxDispatcher,
    private readonly importProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly outreachProcessor?: OutreachSchedulerProcessor,
    private readonly enrichmentProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly signalProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly workspaceExportProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly retentionPurgeProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly knowledgeExpirationProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly evaluationRunProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly prospectDecisionProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly contentIdeaDiscoveryProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly contentGenerationProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly contentPublicationProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly prospectMemoryRefreshProcessor?: { process(job: LeasedJob): Promise<void> },
    private readonly prospectMemoryBackfillProcessor?: { process(job: LeasedJob): Promise<void> },
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
    const now = this.clock.now();
    this.#startMaintenance(now);
    if (this.outreachProcessor) await this.outreachProcessor.markDue({ now, queue: this.queue });
    const availableTypes = [
        "research.stage.execute",
        "research.document.process",
        ...(this.discoveryProcessor ? ["prospect.discovery.execute"] : []),
        ...(this.channelAssessmentProcessor ? ["prospecting.channel.assess"] : []),
        ...(this.campaignAutomationProcessor ? ["campaign.automation.advance"] : []),
        ...(this.campaignCompositionProcessor ? ["campaign.messages.compose"] : []),
        ...(this.outreachDispatchProcessor ? ["outreach.dispatch"] : []),
        ...(this.inboundReplyProcessor ? ["inbound.reply.process"] : []),
        ...(this.automatedReplySendProcessor ? ["inbound.reply.send"] : []),
        ...(this.conversationCommandProcessor ? ["conversation.command.execute"] : []),
        ...(this.importProcessor ? ["crm.import.apply"] : []),
        ...(this.outreachProcessor ? ["outreach.action.execute"] : []),
        ...(this.enrichmentProcessor ? ["crm.enrichment.execute"] : []),
        ...(this.signalProcessor ? ["crm.signals.collect"] : []),
        ...(this.workspaceExportProcessor ? ["workspace.data.export"] : []),
        ...(this.retentionPurgeProcessor ? ["workspace.retention.purge"] : []),
        ...(this.knowledgeExpirationProcessor ? ["knowledge.source.expire"] : []),
        ...(this.evaluationRunProcessor ? ["ai.evaluation.execute"] : []),
        ...(this.prospectDecisionProcessor ? ["prospect.decision.execute"] : []),
        ...(this.contentIdeaDiscoveryProcessor ? ["content.ideas.discover"] : []),
        ...(this.contentGenerationProcessor ? ["content.asset.generate"] : []),
        ...(this.contentPublicationProcessor ? ["content.publication.publish"] : []),
        ...(this.prospectMemoryRefreshProcessor ? ["prospect.memory.refresh"] : []),
        ...(this.prospectMemoryBackfillProcessor ? ["prospect.memory.backfill"] : []),
    ];
    const allowed = this.options.jobTypes ? new Set(this.options.jobTypes) : null;
    const excluded = new Set(this.options.excludedJobTypes ?? []);
    const jobTypes = availableTypes.filter((type) => (!allowed || allowed.has(type)) && !excluded.has(type));
    if (jobTypes.length === 0) throw new Error("WORKER_JOB_TYPES_EMPTY");
    const jobs = await this.queue.lease({
      workerId: this.options.workerId,
      types: jobTypes,
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

  #startMaintenance(now: Date): void {
    if (!this.maintenance || this.#maintenanceInFlight || now.getTime() - this.#lastMaintenanceAt < 60_000) {
      return;
    }
    let run: Promise<number>;
    try {
      run = this.maintenance.reconcile();
    } catch (error) {
      this.#lastMaintenanceAt = this.clock.now().getTime();
      logMaintenanceError(error);
      return;
    }
    const tracked = run
      .then(() => undefined)
      .catch((error) => logMaintenanceError(error))
      .finally(() => {
        this.#lastMaintenanceAt = this.clock.now().getTime();
        if (this.#maintenanceInFlight === tracked) this.#maintenanceInFlight = null;
      });
    this.#maintenanceInFlight = tracked;
  }

  async #processSafely(job: LeasedJob): Promise<void> {
    const stopHeartbeat = this.#startLeaseHeartbeat(job);
    try {
      if (job.type === "research.document.process" && this.documentProcessor) {
        await this.documentProcessor.process(job);
      } else if (job.type === "prospect.discovery.execute" && this.discoveryProcessor) {
        await this.discoveryProcessor.process(job);
      } else if (job.type === "prospecting.channel.assess" && this.channelAssessmentProcessor) {
        await this.channelAssessmentProcessor.process(job);
      } else if (job.type === "campaign.automation.advance" && this.campaignAutomationProcessor) {
        await this.campaignAutomationProcessor.process(job);
      } else if (job.type === "campaign.messages.compose" && this.campaignCompositionProcessor) {
        await this.campaignCompositionProcessor.process(job);
      } else if (job.type === "outreach.dispatch" && this.outreachDispatchProcessor) {
        await this.outreachDispatchProcessor.process(job);
      } else if (job.type === "inbound.reply.process" && this.inboundReplyProcessor) {
        await this.inboundReplyProcessor.process(job);
      } else if (job.type === "inbound.reply.send" && this.automatedReplySendProcessor) {
        await this.automatedReplySendProcessor.process(job);
      } else if (job.type === "conversation.command.execute" && this.conversationCommandProcessor) {
        await this.conversationCommandProcessor.process(job);
      } else if (job.type === "crm.import.apply" && this.importProcessor) {
        await this.importProcessor.process(job);
      } else if (job.type === "outreach.action.execute" && this.outreachProcessor) {
        const payload = job.payload as { actionId?: unknown };
        if (typeof payload.actionId !== "string") throw new Error("OUTREACH_ACTION_JOB_INVALID");
        await this.outreachProcessor.execute({ workspaceId: job.workspaceId, actionId: payload.actionId, now: this.clock.now() });
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      } else if (job.type === "crm.enrichment.execute" && this.enrichmentProcessor) {
        await this.enrichmentProcessor.process(job);
      } else if (job.type === "crm.signals.collect" && this.signalProcessor) {
        await this.signalProcessor.process(job);
      } else if (job.type === "workspace.data.export" && this.workspaceExportProcessor) {
        await this.workspaceExportProcessor.process(job);
      } else if (job.type === "workspace.retention.purge" && this.retentionPurgeProcessor) {
        await this.retentionPurgeProcessor.process(job);
      } else if (job.type === "knowledge.source.expire" && this.knowledgeExpirationProcessor) {
        await this.knowledgeExpirationProcessor.process(job);
      } else if (job.type === "ai.evaluation.execute" && this.evaluationRunProcessor) {
        await this.evaluationRunProcessor.process(job);
      } else if (job.type === "prospect.decision.execute" && this.prospectDecisionProcessor) {
        await this.prospectDecisionProcessor.process(job);
      } else if (job.type === "content.ideas.discover" && this.contentIdeaDiscoveryProcessor) {
        await this.contentIdeaDiscoveryProcessor.process(job);
      } else if (job.type === "content.asset.generate" && this.contentGenerationProcessor) {
        await this.contentGenerationProcessor.process(job);
      } else if (job.type === "content.publication.publish" && this.contentPublicationProcessor) {
        await this.contentPublicationProcessor.process(job);
      } else if (job.type === "prospect.memory.refresh" && this.prospectMemoryRefreshProcessor) {
        await this.prospectMemoryRefreshProcessor.process(job);
      } else if (job.type === "prospect.memory.backfill" && this.prospectMemoryBackfillProcessor) {
        await this.prospectMemoryBackfillProcessor.process(job);
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
    const intervalMs = Math.max(
      50,
      Math.min(this.options.leaseHeartbeatMs ?? Math.floor(this.options.leaseMs / 3), this.options.leaseMs - 1),
    );
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

function logMaintenanceError(error: unknown): void {
  console.error(JSON.stringify({
    event: "research_worker_maintenance_error",
    error: error instanceof Error ? error.message : String(error),
  }));
}
