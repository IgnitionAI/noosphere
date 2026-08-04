import { and, asc, desc, eq } from "drizzle-orm";
import { mergeCampaignAutopilotPolicy, resolveCampaignAutopilotPolicy } from "@outbound/domain/campaigns/campaign-autopilot-policy";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaigns,
  campaignProspects,
  channelAssessments,
  icpVersions,
  prospectDiscoveryCandidates,
  prospectDiscoveryRuns,
  sequences,
  sequenceSteps,
} from "@outbound/infrastructure/database/schema";

export class PostgresCampaignRepository {
  constructor(private readonly db: Database) {}

  async listCampaigns(workspaceId: string) {
    return this.db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        prospectCount: campaigns.prospectCount,
        autopilotPolicy: campaigns.autopilotPolicy,
        automationStage: campaigns.automationStage,
        automationErrorCode: campaigns.automationErrorCode,
        automationErrorMessage: campaigns.automationErrorMessage,
        createdAt: campaigns.createdAt,
        updatedAt: campaigns.updatedAt,
        icpVersionId: campaigns.icpVersionId,
        icpRunId: icpVersions.runId,
        icpName: icpVersions.name,
        icpConfidence: icpVersions.confidence,
        planId: campaigns.planId,
        assessmentId: campaigns.assessmentId,
        channel: campaigns.channel,
        assessmentRecommendation: channelAssessments.recommendation,
        assessmentScore: channelAssessments.score,
        sequenceId: campaigns.sequenceId,
        sequenceVersionId: campaigns.sequenceVersionId,
        sequenceName: sequences.name,
        sequenceStatus: sequences.status,
        discoveryRunId: campaigns.discoveryRunId,
        discoveryStatus: prospectDiscoveryRuns.status,
        discoveryErrorCode: prospectDiscoveryRuns.errorCode,
        discoveryErrorMessage: prospectDiscoveryRuns.errorMessage,
      })
      .from(campaigns)
      .innerJoin(
        icpVersions,
        and(
          eq(icpVersions.workspaceId, campaigns.workspaceId),
          eq(icpVersions.id, campaigns.icpVersionId),
        ),
      )
      .innerJoin(
        sequences,
        and(eq(sequences.workspaceId, campaigns.workspaceId), eq(sequences.id, campaigns.sequenceId)),
      )
      .leftJoin(
        channelAssessments,
        and(
          eq(channelAssessments.workspaceId, campaigns.workspaceId),
          eq(channelAssessments.id, campaigns.assessmentId),
        ),
      )
      .leftJoin(
        prospectDiscoveryRuns,
        and(
          eq(prospectDiscoveryRuns.workspaceId, campaigns.workspaceId),
          eq(prospectDiscoveryRuns.id, campaigns.discoveryRunId),
        ),
      )
      .where(eq(campaigns.workspaceId, workspaceId))
      .orderBy(desc(campaigns.updatedAt))
      .limit(100);
  }

  async getCampaign(input: { workspaceId: string; campaignId: string }) {
    const [campaign] = await this.db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        prospectCount: campaigns.prospectCount,
        autopilotPolicy: campaigns.autopilotPolicy,
        automationStage: campaigns.automationStage,
        automationErrorCode: campaigns.automationErrorCode,
        automationErrorMessage: campaigns.automationErrorMessage,
        createdAt: campaigns.createdAt,
        updatedAt: campaigns.updatedAt,
        icpVersionId: campaigns.icpVersionId,
        icpRunId: icpVersions.runId,
        icpName: icpVersions.name,
        icpConfidence: icpVersions.confidence,
        icpCriteria: icpVersions.criteria,
        planId: campaigns.planId,
        assessmentId: campaigns.assessmentId,
        channel: campaigns.channel,
        assessmentRecommendation: channelAssessments.recommendation,
        assessmentScore: channelAssessments.score,
        assessmentRationale: channelAssessments.rationale,
        assessmentMetrics: channelAssessments.metrics,
        assessmentEvidence: channelAssessments.evidence,
        buyingCommittee: icpVersions.buyingCommittee,
        signals: icpVersions.signals,
        sequenceId: campaigns.sequenceId,
        sequenceVersionId: campaigns.sequenceVersionId,
        sequenceName: sequences.name,
        sequenceStatus: sequences.status,
        discoveryRunId: campaigns.discoveryRunId,
        discoveryStatus: prospectDiscoveryRuns.status,
        discoveryFilters: prospectDiscoveryRuns.filters,
        discoveryErrorCode: prospectDiscoveryRuns.errorCode,
        discoveryErrorMessage: prospectDiscoveryRuns.errorMessage,
      })
      .from(campaigns)
      .innerJoin(
        icpVersions,
        and(
          eq(icpVersions.workspaceId, campaigns.workspaceId),
          eq(icpVersions.id, campaigns.icpVersionId),
        ),
      )
      .innerJoin(
        sequences,
        and(eq(sequences.workspaceId, campaigns.workspaceId), eq(sequences.id, campaigns.sequenceId)),
      )
      .leftJoin(
        channelAssessments,
        and(
          eq(channelAssessments.workspaceId, campaigns.workspaceId),
          eq(channelAssessments.id, campaigns.assessmentId),
        ),
      )
      .leftJoin(
        prospectDiscoveryRuns,
        and(
          eq(prospectDiscoveryRuns.workspaceId, campaigns.workspaceId),
          eq(prospectDiscoveryRuns.id, campaigns.discoveryRunId),
        ),
      )
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)))
      .limit(1);
    if (!campaign) return null;

    const steps = await this.db
      .select()
      .from(sequenceSteps)
      .where(
        and(
          eq(sequenceSteps.workspaceId, input.workspaceId),
          eq(sequenceSteps.sequenceId, campaign.sequenceId),
        ),
      )
      .orderBy(asc(sequenceSteps.position));
    const prospects = await this.db
      .select({
        candidateId: campaignProspects.candidateId,
        contactId: campaignProspects.contactId,
        state: campaignProspects.state,
        score: campaignProspects.score,
        eligible: campaignProspects.eligible,
        exclusionReason: campaignProspects.exclusionReason,
        personalizedSteps: campaignProspects.personalizedSteps,
        fullName: prospectDiscoveryCandidates.fullName,
        headline: prospectDiscoveryCandidates.headline,
        linkedinUrl: prospectDiscoveryCandidates.linkedinUrl,
        location: prospectDiscoveryCandidates.location,
        companyName: prospectDiscoveryCandidates.companyName,
        companyWebsite: prospectDiscoveryCandidates.companyWebsite,
        channels: prospectDiscoveryCandidates.channels,
        icpFit: prospectDiscoveryCandidates.icpFit,
      })
      .from(campaignProspects)
      .innerJoin(
        prospectDiscoveryCandidates,
        and(
          eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
          eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
        ),
      )
      .where(
        and(
          eq(campaignProspects.workspaceId, input.workspaceId),
          eq(campaignProspects.campaignId, input.campaignId),
        ),
      )
      .orderBy(asc(campaignProspects.createdAt));
    return { ...campaign, steps, prospects };
  }

  async getAutopilotPolicy(input: { workspaceId: string; campaignId: string }) {
    const [campaign] = await this.db
      .select({
        channel: campaigns.channel,
        autopilotPolicy: campaigns.autopilotPolicy,
        automationStage: campaigns.automationStage,
      })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)))
      .limit(1);
    if (!campaign?.channel) return null;
    return {
      policy: resolveCampaignAutopilotPolicy(campaign.autopilotPolicy, campaign.channel),
      editable: ["sourcing", "enriching", "composing"].includes(campaign.automationStage),
    };
  }

  async updateAutopilotPolicy(input: {
    workspaceId: string;
    campaignId: string;
    patch: unknown;
    now: Date;
  }) {
    const [campaign] = await this.db
      .select({
        channel: campaigns.channel,
        autopilotPolicy: campaigns.autopilotPolicy,
        automationStage: campaigns.automationStage,
      })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)))
      .limit(1);
    if (!campaign?.channel) return null;
    if (!["sourcing", "enriching", "composing"].includes(campaign.automationStage)) {
      throw new CampaignAutopilotPolicyLockedError();
    }
    const policy = mergeCampaignAutopilotPolicy(
      campaign.autopilotPolicy,
      input.patch,
      campaign.channel,
    );
    await this.db
      .update(campaigns)
      .set({ autopilotPolicy: policy, updatedAt: input.now })
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)));
    return { policy, editable: true };
  }
}

export class CampaignAutopilotPolicyLockedError extends Error {
  constructor() {
    super("CAMPAIGN_AUTOPILOT_POLICY_LOCKED");
  }
}
