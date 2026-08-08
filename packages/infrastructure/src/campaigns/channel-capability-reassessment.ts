import { and, eq, inArray } from "drizzle-orm";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaigns,
  channelAssessments,
  jobs,
  prospectingPlans,
} from "@outbound/infrastructure/database/schema";
import { CHANNEL_ASSESSMENT_JOB_TYPE } from "./channel-assessment-runner";

export class PostgresChannelCapabilityReassessment {
  constructor(private readonly database: Database) {}

  async schedule(input: {
    readonly workspaceId: string;
    readonly channel: ProspectingChannel;
    readonly capabilityKey: string;
    readonly now: Date;
  }): Promise<number> {
    return this.database.transaction(async (tx) => {
      const assessments = await tx
        .select({
          id: channelAssessments.id,
          planId: channelAssessments.planId,
        })
        .from(channelAssessments)
        .where(and(
          eq(channelAssessments.workspaceId, input.workspaceId),
          eq(channelAssessments.channel, input.channel),
          inArray(channelAssessments.status, ["completed", "failed"]),
        ));
      if (!assessments.length) return 0;
      const existingCampaigns = await tx
        .select({ assessmentId: campaigns.assessmentId })
        .from(campaigns)
        .where(and(
          eq(campaigns.workspaceId, input.workspaceId),
          eq(campaigns.channel, input.channel),
        ));
      const completed = new Set(existingCampaigns.flatMap((row) => row.assessmentId ? [row.assessmentId] : []));
      const pending = assessments.filter((assessment) => !completed.has(assessment.id));
      for (const assessment of pending) {
        await tx
          .update(channelAssessments)
          .set({
            status: "pending",
            recommendation: null,
            score: null,
            strategy: {},
            metrics: {},
            evidence: [],
            rationale: null,
            sampleSize: 0,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            updatedAt: input.now,
          })
          .where(and(
            eq(channelAssessments.workspaceId, input.workspaceId),
            eq(channelAssessments.id, assessment.id),
          ));
        await tx
          .update(prospectingPlans)
          .set({ status: "assessing", updatedAt: input.now })
          .where(and(
            eq(prospectingPlans.workspaceId, input.workspaceId),
            eq(prospectingPlans.id, assessment.planId),
          ));
        await tx.insert(jobs).values({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          type: CHANNEL_ASSESSMENT_JOB_TYPE,
          payload: { workspaceId: input.workspaceId, assessmentId: assessment.id },
          idempotencyKey: `${assessment.id}:capability:${input.capabilityKey}`,
          correlationId: `channel-capability:${input.channel}:${assessment.id}`,
          maxAttempts: 3,
          availableAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        }).onConflictDoNothing();
      }
      return pending.length;
    });
  }
}
