import { and, asc, eq } from "drizzle-orm";
import type { ChannelStrategy } from "@outbound/application/campaigns/channel-assessment";
import {
  buildAutonomousSourcingFilters,
  PROSPECT_DISCOVERY_JOB_TYPE,
} from "@outbound/application/campaigns/autonomous-prospecting";
import type {
  ChannelAssessmentDecision,
  ChannelAssessmentMetrics,
  ProspectingChannel,
} from "@outbound/domain/campaigns/prospecting-plan";
import { defaultCampaignSequenceSteps } from "@outbound/domain/campaigns/campaign-sequence";
import type { Database } from "@outbound/infrastructure/database/client";
import { workspaceCampaignPolicy } from "@outbound/infrastructure/workspaces/workspace-campaign-policy";
import {
  campaigns,
  channelAssessments,
  icpVersions,
  outboxEvents,
  jobs,
  prospectDiscoveryRuns,
  prospectingPlans,
  sequences,
  sequenceSteps,
} from "@outbound/infrastructure/database/schema";

export class PostgresProspectingPlanRepository {
  constructor(private readonly db: Database) {}

  async getAssessment(input: { workspaceId: string; assessmentId: string }) {
    const [row] = await this.db
      .select({
        id: channelAssessments.id,
        workspaceId: channelAssessments.workspaceId,
        planId: channelAssessments.planId,
        channel: channelAssessments.channel,
        status: channelAssessments.status,
        recommendation: channelAssessments.recommendation,
        icpVersionId: prospectingPlans.icpVersionId,
        icpName: icpVersions.name,
        criteria: icpVersions.criteria,
        buyingCommittee: icpVersions.buyingCommittee,
        signals: icpVersions.signals,
      })
      .from(channelAssessments)
      .innerJoin(
        prospectingPlans,
        and(
          eq(prospectingPlans.workspaceId, channelAssessments.workspaceId),
          eq(prospectingPlans.id, channelAssessments.planId),
        ),
      )
      .innerJoin(
        icpVersions,
        and(
          eq(icpVersions.workspaceId, prospectingPlans.workspaceId),
          eq(icpVersions.id, prospectingPlans.icpVersionId),
        ),
      )
      .where(
        and(
          eq(channelAssessments.workspaceId, input.workspaceId),
          eq(channelAssessments.id, input.assessmentId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async startAssessment(input: { workspaceId: string; assessmentId: string; startedAt: Date }) {
    await this.db
      .update(channelAssessments)
      .set({
        status: "running",
        errorCode: null,
        errorMessage: null,
        startedAt: input.startedAt,
        updatedAt: input.startedAt,
      })
      .where(
        and(
          eq(channelAssessments.workspaceId, input.workspaceId),
          eq(channelAssessments.id, input.assessmentId),
        ),
      );
  }

  async recordAssessmentStrategy(input: {
    workspaceId: string;
    assessmentId: string;
    strategy: ChannelStrategy;
    updatedAt: Date;
  }) {
    await this.db
      .update(channelAssessments)
      .set({ strategy: input.strategy, updatedAt: input.updatedAt })
      .where(
        and(
          eq(channelAssessments.workspaceId, input.workspaceId),
          eq(channelAssessments.id, input.assessmentId),
          eq(channelAssessments.status, "running"),
        ),
      );
  }

  async completeAssessment(input: {
    workspaceId: string;
    assessmentId: string;
    strategy: ChannelStrategy;
    metrics: ChannelAssessmentMetrics;
    evidence: readonly unknown[];
    decision: ChannelAssessmentDecision;
    completedAt: Date;
  }) {
    return this.db.transaction(async (tx) => {
      const [assessment] = await tx
        .update(channelAssessments)
        .set({
          status: "completed",
          recommendation: input.decision.recommendation,
          score: input.decision.score,
          strategy: input.strategy,
          metrics: input.metrics,
          evidence: [...input.evidence],
          rationale: input.decision.rationale,
          sampleSize: input.metrics.sampleSize,
          errorCode: null,
          errorMessage: null,
          completedAt: input.completedAt,
          updatedAt: input.completedAt,
        })
        .where(
          and(
            eq(channelAssessments.workspaceId, input.workspaceId),
            eq(channelAssessments.id, input.assessmentId),
          ),
        )
        .returning();
      if (!assessment) throw new Error("CHANNEL_ASSESSMENT_NOT_FOUND");

      let campaignId: string | null = null;
      if (input.decision.recommendation === "recommended") {
        campaignId = await ensureChannelCampaign(tx, {
          workspaceId: input.workspaceId,
          planId: assessment.planId,
          assessmentId: assessment.id,
          channel: assessment.channel,
          strategy: input.strategy,
          now: input.completedAt,
        });
      }
      await finalizePlan(tx, input.workspaceId, assessment.planId, input.completedAt);
      return { assessment, campaignId };
    });
  }

  async failAssessment(input: {
    workspaceId: string;
    assessmentId: string;
    errorCode: string;
    errorMessage: string;
    completedAt: Date;
  }) {
    await this.db.transaction(async (tx) => {
      const [assessment] = await tx
        .update(channelAssessments)
        .set({
          status: "failed",
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          completedAt: input.completedAt,
          updatedAt: input.completedAt,
        })
        .where(
          and(
            eq(channelAssessments.workspaceId, input.workspaceId),
            eq(channelAssessments.id, input.assessmentId),
          ),
        )
        .returning({ planId: channelAssessments.planId });
      if (assessment) await finalizePlan(tx, input.workspaceId, assessment.planId, input.completedAt);
    });
  }

  async enableChannel(input: {
    workspaceId: string;
    planId: string;
    channel: ProspectingChannel;
    now: Date;
  }) {
    return this.db.transaction(async (tx) => {
      const [assessment] = await tx
        .select()
        .from(channelAssessments)
        .where(
          and(
            eq(channelAssessments.workspaceId, input.workspaceId),
            eq(channelAssessments.planId, input.planId),
            eq(channelAssessments.channel, input.channel),
            eq(channelAssessments.status, "completed"),
          ),
        )
        .limit(1);
      if (!assessment) throw new Error("CHANNEL_ASSESSMENT_NOT_COMPLETED");
      const campaignId = await ensureChannelCampaign(tx, {
        workspaceId: input.workspaceId,
        planId: input.planId,
        assessmentId: assessment.id,
        channel: input.channel,
        strategy: assessment.strategy as ChannelStrategy,
        now: input.now,
      });
      await tx
        .update(campaigns)
        .set({ status: "draft", legacyReason: null, updatedAt: input.now })
        .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, campaignId)));
      return { campaignId };
    });
  }

  async archiveCampaign(input: { workspaceId: string; campaignId: string; now: Date }) {
    const [row] = await this.db
      .update(campaigns)
      .set({ status: "archived", updatedAt: input.now })
      .where(
        and(
          eq(campaigns.workspaceId, input.workspaceId),
          eq(campaigns.id, input.campaignId),
          eq(campaigns.status, "draft"),
        ),
      )
      .returning({ id: campaigns.id });
    if (!row) throw new Error("DRAFT_CAMPAIGN_NOT_FOUND");
    return row;
  }

  async restartAssessment(input: { workspaceId: string; assessmentId: string; now: Date }) {
    return this.db.transaction(async (tx) => {
      const [assessment] = await tx
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
        .where(
          and(
            eq(channelAssessments.workspaceId, input.workspaceId),
            eq(channelAssessments.id, input.assessmentId),
            eq(channelAssessments.status, "failed"),
          ),
        )
        .returning();
      if (!assessment) throw new Error("FAILED_CHANNEL_ASSESSMENT_NOT_FOUND");
      await tx
        .update(prospectingPlans)
        .set({ status: "assessing", updatedAt: input.now })
        .where(
          and(
            eq(prospectingPlans.workspaceId, input.workspaceId),
            eq(prospectingPlans.id, assessment.planId),
          ),
        );
      return assessment;
    });
  }

  async listPlans(workspaceId: string) {
    return this.db
      .select({
        id: prospectingPlans.id,
        icpVersionId: prospectingPlans.icpVersionId,
        icpName: icpVersions.name,
        icpRunId: icpVersions.runId,
        name: prospectingPlans.name,
        status: prospectingPlans.status,
        createdAt: prospectingPlans.createdAt,
        updatedAt: prospectingPlans.updatedAt,
      })
      .from(prospectingPlans)
      .innerJoin(
        icpVersions,
        and(
          eq(icpVersions.workspaceId, prospectingPlans.workspaceId),
          eq(icpVersions.id, prospectingPlans.icpVersionId),
        ),
      )
      .where(eq(prospectingPlans.workspaceId, workspaceId))
      .orderBy(asc(prospectingPlans.createdAt));
  }

  async getPlan(input: { workspaceId: string; planId: string }) {
    const [plan] = await this.db
      .select({
        id: prospectingPlans.id,
        icpVersionId: prospectingPlans.icpVersionId,
        icpName: icpVersions.name,
        icpRunId: icpVersions.runId,
        name: prospectingPlans.name,
        status: prospectingPlans.status,
        createdAt: prospectingPlans.createdAt,
        updatedAt: prospectingPlans.updatedAt,
      })
      .from(prospectingPlans)
      .innerJoin(
        icpVersions,
        and(
          eq(icpVersions.workspaceId, prospectingPlans.workspaceId),
          eq(icpVersions.id, prospectingPlans.icpVersionId),
        ),
      )
      .where(
        and(
          eq(prospectingPlans.workspaceId, input.workspaceId),
          eq(prospectingPlans.id, input.planId),
        ),
      )
      .limit(1);
    if (!plan) return null;
    const assessments = await this.db
      .select()
      .from(channelAssessments)
      .where(
        and(
          eq(channelAssessments.workspaceId, input.workspaceId),
          eq(channelAssessments.planId, input.planId),
        ),
      )
      .orderBy(asc(channelAssessments.createdAt));
    const campaignRows = await this.db
      .select()
      .from(campaigns)
      .where(
        and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.planId, input.planId)),
      );
    return { ...plan, assessments, campaigns: campaignRows };
  }
}

async function finalizePlan(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  workspaceId: string,
  planId: string,
  now: Date,
): Promise<void> {
  const assessments = await tx
    .select({ status: channelAssessments.status })
    .from(channelAssessments)
    .where(
      and(eq(channelAssessments.workspaceId, workspaceId), eq(channelAssessments.planId, planId)),
    );
  if (assessments.length === 3 && assessments.every(({ status }) => ["completed", "failed"].includes(status))) {
    await tx
      .update(prospectingPlans)
      .set({ status: "ready", updatedAt: now })
      .where(and(eq(prospectingPlans.workspaceId, workspaceId), eq(prospectingPlans.id, planId)));
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function ensureChannelCampaign(
  tx: Transaction,
  input: {
    workspaceId: string;
    planId: string;
    assessmentId: string;
    channel: ProspectingChannel;
    strategy: ChannelStrategy;
    now: Date;
  },
): Promise<string> {
  const [existing] = await tx
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.workspaceId, input.workspaceId),
        eq(campaigns.planId, input.planId),
        eq(campaigns.channel, input.channel),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [plan] = await tx
    .select({ icpVersionId: prospectingPlans.icpVersionId })
    .from(prospectingPlans)
    .where(
      and(
        eq(prospectingPlans.workspaceId, input.workspaceId),
        eq(prospectingPlans.id, input.planId),
      ),
    )
    .limit(1);
  if (!plan) throw new Error("PROSPECTING_PLAN_NOT_FOUND");
  const [version] = await tx
    .select({ name: icpVersions.name })
    .from(icpVersions)
    .where(
      and(
        eq(icpVersions.workspaceId, input.workspaceId),
        eq(icpVersions.id, plan.icpVersionId),
      ),
    )
    .limit(1);
  if (!version) throw new Error("ICP_VERSION_NOT_FOUND");
  const campaignId = crypto.randomUUID();
  const sequenceId = crypto.randomUUID();
  const discoveryRunId = crypto.randomUUID();
  const sourcingFilters = buildAutonomousSourcingFilters(input.channel, input.strategy);
  const channelLabel = label(input.channel);
  // Channel campaigns are created by the autonomous prospecting plan. They
  // must be ready to run without an approval queue; safety stops are enforced
  // by the dispatcher (suppression, invalid identity, account and quota).
  const autopilotPolicy = {
    ...(await workspaceCampaignPolicy(tx, input.workspaceId, input.channel)),
    executionMode: "live" as const,
  };
  await tx.insert(sequences).values({
    id: sequenceId,
    workspaceId: input.workspaceId,
    name: `${channelLabel} — ${version.name}`.slice(0, 300),
    description: `Brouillon mono-canal ${channelLabel}, généré après mesure de faisabilité.`,
    status: "draft",
    createdBy: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
  await tx.insert(sequenceSteps).values(
    defaultCampaignSequenceSteps(input.channel).map((step) => ({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      sequenceId,
      ...step,
    })),
  );
  await tx.insert(prospectDiscoveryRuns).values({
    id: discoveryRunId,
    workspaceId: input.workspaceId,
    icpVersionId: plan.icpVersionId,
    provider: input.channel === "linkedin" ? "unipile" : "crawler",
    channel: input.channel,
    filters: sourcingFilters,
    status: "running",
    createdBy: null,
    createdAt: input.now,
  });
  await tx.insert(campaigns).values({
    id: campaignId,
    workspaceId: input.workspaceId,
    icpVersionId: plan.icpVersionId,
    planId: input.planId,
    assessmentId: input.assessmentId,
    channel: input.channel,
    name: `${channelLabel} — ${version.name}`.slice(0, 300),
    status: "draft",
    sequenceId,
    discoveryRunId,
    prospectCount: 0,
    autopilotPolicy,
    createdAt: input.now,
    updatedAt: input.now,
  });
  await tx.insert(jobs).values({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    type: PROSPECT_DISCOVERY_JOB_TYPE,
    payload: { workspaceId: input.workspaceId, runId: discoveryRunId },
    idempotencyKey: `${campaignId}:sourcing:v1`,
    correlationId: `campaign:${campaignId}`,
    maxAttempts: 3,
    availableAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  });
  await tx.insert(outboxEvents).values({
    workspaceId: input.workspaceId,
    aggregateType: "Campaign",
    aggregateId: campaignId,
    eventType: "ChannelCampaignDraftCreated",
    payload: {
      campaignId,
      planId: input.planId,
      assessmentId: input.assessmentId,
      channel: input.channel,
      sequenceId,
      discoveryRunId,
    },
  });
  return campaignId;
}

function label(channel: ProspectingChannel): string {
  return channel === "linkedin" ? "LinkedIn" : channel === "email" ? "Email" : "WhatsApp";
}
