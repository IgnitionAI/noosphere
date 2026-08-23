import type {
  ChannelObservationSource,
  ChannelStrategyPlanner,
} from "@outbound/application/campaigns/channel-assessment";
import { ModelGatewayError } from "@outbound/application/ai/model-gateway";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import { decideChannelRecommendation } from "@outbound/domain/campaigns/prospecting-plan";
import type { Database } from "@outbound/infrastructure/database/client";
import { PostgresProspectingPlanRepository } from "./postgres-prospecting-plan-repository";

export const CHANNEL_ASSESSMENT_JOB_TYPE = "prospecting.channel.assess";

export class ChannelAssessmentJobProcessor {
  readonly #repository: PostgresProspectingPlanRepository;

  constructor(
    database: Database,
    private readonly queue: JobQueue,
    private readonly planner: ChannelStrategyPlanner,
    private readonly source: ChannelObservationSource,
    private readonly clock: Clock,
  ) {
    this.#repository = new PostgresProspectingPlanRepository(database);
  }

  async process(job: LeasedJob): Promise<void> {
    const payload = assessmentPayload(job.payload);
    const assessment = await this.#repository.getAssessment(payload);
    if (!assessment || ["completed", "failed"].includes(assessment.status)) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    await this.#repository.startAssessment({ ...payload, startedAt: this.clock.now() });
    try {
      const strategy = await this.planner.plan({
        workspaceId: payload.workspaceId,
        channel: assessment.channel,
        icpName: assessment.icpName,
        criteria: assessment.criteria,
        buyingCommittee: assessment.buyingCommittee,
        signals: assessment.signals,
      });
      await this.#repository.recordAssessmentStrategy({
        ...payload,
        strategy,
        updatedAt: this.clock.now(),
      });
      const observation = await this.source.observe({
        ...payload,
        channel: assessment.channel,
        strategy,
        version: assessment,
      });
      const decision = decideChannelRecommendation(assessment.channel, observation.metrics);
      await this.#repository.completeAssessment({
        ...payload,
        strategy,
        metrics: observation.metrics,
        evidence: observation.evidence,
        decision,
        completedAt: this.clock.now(),
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    } catch (error) {
      const failure = channelAssessmentFailure(error);
      const outcome = await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 30_000 * job.attempts),
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
      });
      if (outcome === "dead_lettered") {
        await this.#repository.failAssessment({
          ...payload,
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
          completedAt: this.clock.now(),
        });
      }
    }
  }
}

export function channelAssessmentFailure(error: unknown): { errorCode: string; errorMessage: string } {
  if (error instanceof ModelGatewayError) {
    return { errorCode: error.code, errorMessage: error.message };
  }
  return {
    errorCode: "CHANNEL_ASSESSMENT_FAILED",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

function assessmentPayload(value: unknown): { workspaceId: string; assessmentId: string } {
  if (!value || typeof value !== "object") throw new Error("INVALID_CHANNEL_ASSESSMENT_JOB");
  const payload = value as Record<string, unknown>;
  if (typeof payload.workspaceId !== "string" || typeof payload.assessmentId !== "string") {
    throw new Error("INVALID_CHANNEL_ASSESSMENT_JOB");
  }
  return { workspaceId: payload.workspaceId, assessmentId: payload.assessmentId };
}
