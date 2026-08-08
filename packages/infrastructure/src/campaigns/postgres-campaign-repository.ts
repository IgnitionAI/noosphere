import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import { mergeCampaignAutopilotPolicy, resolveCampaignAutopilotPolicy } from "@outbound/domain/campaigns/campaign-autopilot-policy";
import { transitionCampaign, type CampaignSnapshot, type CampaignTransition } from "@outbound/domain/campaigns/campaign";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaigns,
  aiPolicyVersions,
  auditLogs,
  campaignProspects,
  channelAssessments,
  contactChannelAssignments,
  dailyProspectingSchedules,
  dailySourcingCycles,
  icpVersions,
  messagingStrategyVersions,
  offerVersions,
  outboxEvents,
  phoneObservations,
  prospectDiscoveryCandidates,
  prospectDiscoveryRuns,
  sequences,
  sequenceSteps,
  sequenceVersions,
} from "@outbound/infrastructure/database/schema";

export interface CampaignPreflightBlocker {
  readonly code: string;
  readonly reference: keyof CampaignSnapshot;
  readonly versionId: string;
  readonly message: string;
}

export interface CampaignPreflightResult {
  readonly ok: boolean;
  readonly blockers: readonly CampaignPreflightBlocker[];
  readonly warnings: readonly { code: string; message: string }[];
}

export class CampaignPreflightError extends Error {
  constructor(readonly result: CampaignPreflightResult) {
    super("CAMPAIGN_PREFLIGHT_FAILED");
  }
}

export class PostgresCampaignRepository {
  constructor(private readonly db: Database) {}

  async createCampaign(input: {
    id: string;
    workspaceId: string;
    name: string;
    objective: string;
    offerVersionId: string;
    icpVersionId: string;
    messagingStrategyVersionId: string;
    aiPolicyVersionId: string;
    sequenceVersionId: string;
    createdBy: string;
  }) {
    return this.db.transaction(async (tx) => {
      const [version] = await tx.select({ sequenceId: sequenceVersions.sequenceId })
        .from(sequenceVersions)
        .where(and(eq(sequenceVersions.workspaceId, input.workspaceId), eq(sequenceVersions.id, input.sequenceVersionId)))
        .limit(1);
      if (!version) throw new Error("SEQUENCE_VERSION_NOT_FOUND");
      const [campaign] = await tx.insert(campaigns).values({
        ...input,
        sequenceId: version.sequenceId,
        channel: "email",
      }).returning();
      const [event] = await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "Campaign",
        aggregateId: input.id,
        eventType: "CampaignCreated",
        payload: { type: "CampaignCreated", campaignId: input.id, workspaceId: input.workspaceId, actorUserId: input.createdBy },
      }).returning({ id: outboxEvents.id });
      if (campaign && event) {
        await tx.insert(auditLogs).values({
          workspaceId: input.workspaceId,
          actorUserId: input.createdBy,
          action: "CampaignCreated",
          subjectType: "Campaign",
          subjectId: input.id,
          changes: { name: input.name, objective: input.objective, snapshot: snapshotOf(campaign) },
          sourceEventId: event.id,
        });
      }
      return campaign!;
    });
  }

  async updateCampaign(input: {
    workspaceId: string;
    campaignId: string;
    name?: string;
    objective?: string;
    offerVersionId?: string;
    icpVersionId?: string;
    messagingStrategyVersionId?: string;
    aiPolicyVersionId?: string;
    sequenceVersionId?: string;
  }) {
    return this.db.transaction(async (tx) => {
      const current = await this.#lockedCampaign(tx, input.workspaceId, input.campaignId);
      if (!current) throw new Error("CAMPAIGN_NOT_FOUND");
      if (current.status !== "draft") throw new Error("CAMPAIGN_SNAPSHOT_IMMUTABLE");
      const sequence = input.sequenceVersionId
        ? (await tx.select({ sequenceId: sequenceVersions.sequenceId }).from(sequenceVersions)
            .where(and(eq(sequenceVersions.workspaceId, input.workspaceId), eq(sequenceVersions.id, input.sequenceVersionId))).limit(1))[0]
        : null;
      const [updated] = await tx.update(campaigns).set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(input.offerVersionId !== undefined ? { offerVersionId: input.offerVersionId } : {}),
        ...(input.icpVersionId !== undefined ? { icpVersionId: input.icpVersionId } : {}),
        ...(input.messagingStrategyVersionId !== undefined ? { messagingStrategyVersionId: input.messagingStrategyVersionId } : {}),
        ...(input.aiPolicyVersionId !== undefined ? { aiPolicyVersionId: input.aiPolicyVersionId } : {}),
        ...(input.sequenceVersionId !== undefined ? { sequenceVersionId: input.sequenceVersionId } : {}),
        ...(sequence ? { sequenceId: sequence.sequenceId } : {}),
        updatedAt: new Date(),
      }).where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId))).returning();
      return updated!;
    });
  }

  async preflight(input: { workspaceId: string; campaignId: string }): Promise<CampaignPreflightResult> {
    const [campaign] = await this.db.select().from(campaigns)
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId))).limit(1);
    if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
    return this.#preflightSnapshot(this.db, input.workspaceId, campaign);
  }

  async transition(input: { workspaceId: string; campaignId: string; transition: CampaignTransition; userId: string; at: Date }) {
    return this.db.transaction(async (tx) => {
      const current = await this.#lockedCampaign(tx, input.workspaceId, input.campaignId);
      if (!current) throw new Error("CAMPAIGN_NOT_FOUND");
      const result = transitionCampaign(current.status === "completed" ? "archived" : current.status, input.transition);
      if (!result.changed) return current;
      if (input.transition === "activate") {
        const preflight = await this.#preflightSnapshot(tx, input.workspaceId, current);
        if (!preflight.ok) throw new CampaignPreflightError(preflight);
      }
      const timestamps = input.transition === "activate" ? { activatedBy: input.userId, activatedAt: input.at }
        : input.transition === "pause" ? { pausedAt: input.at }
          : input.transition === "archive" ? { archivedAt: input.at } : {};
      const [updated] = await tx.update(campaigns).set({ status: result.status, ...timestamps, updatedAt: input.at })
        .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId))).returning();
      const eventType = { activate: "CampaignActivated", pause: "CampaignPaused", resume: "CampaignResumed", archive: "CampaignArchived" }[input.transition];
      const [event] = await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "Campaign",
        aggregateId: input.campaignId,
        eventType,
        payload: { type: eventType, campaignId: input.campaignId, workspaceId: input.workspaceId, actorUserId: input.userId, status: result.status, snapshot: snapshotOf(updated!) },
      }).returning({ id: outboxEvents.id });
      if (event) await tx.insert(auditLogs).values({
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        action: eventType,
        subjectType: "Campaign",
        subjectId: input.campaignId,
        changes: { status: result.status, snapshot: snapshotOf(updated!) },
        sourceEventId: event.id,
      });
      return updated!;
    });
  }

  async listCampaigns(workspaceId: string) {
    return this.db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        objective: campaigns.objective,
        offerVersionId: campaigns.offerVersionId,
        messagingStrategyVersionId: campaigns.messagingStrategyVersionId,
        aiPolicyVersionId: campaigns.aiPolicyVersionId,
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
        objective: campaigns.objective,
        offerVersionId: campaigns.offerVersionId,
        messagingStrategyVersionId: campaigns.messagingStrategyVersionId,
        aiPolicyVersionId: campaigns.aiPolicyVersionId,
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
        providerData: prospectDiscoveryCandidates.providerData,
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
    const sourcingPool = campaign.channel === "whatsapp"
      ? await this.#whatsappSourcingPool(input.workspaceId, input.campaignId)
      : null;
    return { ...campaign, steps, prospects, sourcingPool };
  }

  async #whatsappSourcingPool(workspaceId: string, campaignId: string) {
    const [cycle] = await this.db
      .select()
      .from(dailySourcingCycles)
      .where(eq(dailySourcingCycles.workspaceId, workspaceId))
      .orderBy(desc(dailySourcingCycles.createdAt))
      .limit(1);
    const [schedule] = await this.db
      .select({ nextRunAt: dailyProspectingSchedules.nextRunAt })
      .from(dailyProspectingSchedules)
      .where(eq(dailyProspectingSchedules.workspaceId, workspaceId))
      .limit(1);
    if (!cycle) {
      return {
        shared: true,
        status: "not_started" as const,
        localDate: null,
        lastPassAt: null,
        nextPassAt: schedule?.nextRunAt ?? null,
        contactsAssignedToday: 0,
        admissibleObserved: 0,
        verificationPending: 0,
        verifiedObserved: 0,
        pageAttempts: 0,
        pageLimit: 150,
        verificationAttempts: 0,
        verificationLimit: 60,
        actionRequired: false,
        errorCode: null,
      };
    }
    const [assigned] = await this.db
      .select({ value: count() })
      .from(contactChannelAssignments)
      .where(
        and(
          eq(contactChannelAssignments.workspaceId, workspaceId),
          eq(contactChannelAssignments.campaignId, campaignId),
          eq(contactChannelAssignments.channel, "whatsapp"),
          gte(contactChannelAssignments.assignedAt, cycle.createdAt),
        ),
      );
    const observations = await this.db
      .select({
        attributionStatus: phoneObservations.attributionStatus,
        reachabilityStatus: phoneObservations.reachabilityStatus,
        providerAccountId: phoneObservations.providerAccountId,
      })
      .from(phoneObservations)
      .where(
        and(
          eq(phoneObservations.workspaceId, workspaceId),
          eq(phoneObservations.sourcingCycleId, cycle.id),
        ),
      );
    const admissible = observations.filter((item) => item.attributionStatus === "strong");
    const pending = admissible.filter((item) => item.reachabilityStatus === "unknown");
    const actionRequired = cycle.status === "action_required"
      || pending.some((item) => item.providerAccountId === null);
    return {
      shared: true,
      status: cycle.status,
      localDate: cycle.localDate,
      lastPassAt: cycle.completedAt ?? cycle.startedAt ?? cycle.createdAt,
      nextPassAt: schedule?.nextRunAt ?? null,
      contactsAssignedToday: Number(assigned?.value ?? 0),
      admissibleObserved: admissible.length,
      verificationPending: pending.length,
      verifiedObserved: admissible.filter((item) => item.reachabilityStatus === "verified").length,
      pageAttempts: cycle.pageAttempts,
      pageLimit: cycle.pageLimit,
      verificationAttempts: cycle.verificationAttempts,
      verificationLimit: cycle.verificationLimit,
      actionRequired,
      errorCode: cycle.errorCode,
    };
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

  async #lockedCampaign(tx: any, workspaceId: string, campaignId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${campaignId}, 0))`);
    const rows = await tx.select().from(campaigns).where(and(
      eq(campaigns.workspaceId, workspaceId),
      eq(campaigns.id, campaignId),
    )).limit(1);
    return rows[0] ?? null;
  }

  async #preflightSnapshot(
    tx: any,
    workspaceId: string,
    campaign: typeof campaigns.$inferSelect,
  ): Promise<CampaignPreflightResult> {
    const checks = [
      { reference: "offerVersionId" as const, versionId: campaign.offerVersionId, table: offerVersions, code: "OFFER_VERSION_NOT_PUBLISHED" },
      { reference: "icpVersionId" as const, versionId: campaign.icpVersionId, table: icpVersions, code: "ICP_VERSION_NOT_PUBLISHED" },
      { reference: "messagingStrategyVersionId" as const, versionId: campaign.messagingStrategyVersionId, table: messagingStrategyVersions, code: "MESSAGING_STRATEGY_VERSION_NOT_PUBLISHED" },
      { reference: "aiPolicyVersionId" as const, versionId: campaign.aiPolicyVersionId, table: aiPolicyVersions, code: "AI_POLICY_VERSION_NOT_PUBLISHED" },
      { reference: "sequenceVersionId" as const, versionId: campaign.sequenceVersionId, table: sequenceVersions, code: "SEQUENCE_VERSION_NOT_PUBLISHED" },
    ];
    const blockers: CampaignPreflightBlocker[] = [];
    for (const check of checks) {
      if (!check.versionId) {
        blockers.push({ code: check.code, reference: check.reference, versionId: "", message: `${check.reference} must reference a published version` });
        continue;
      }
      const rows = await tx.select({ id: check.table.id, publishedAt: check.table.publishedAt })
        .from(check.table)
        .where(and(eq(check.table.workspaceId, workspaceId), eq(check.table.id, check.versionId)))
        .limit(1);
      if (!rows[0]?.publishedAt) blockers.push({
        code: check.code,
        reference: check.reference,
        versionId: check.versionId,
        message: `${check.reference} must reference a published version`,
      });
    }
    return {
      ok: blockers.length === 0,
      blockers,
      warnings: [{ code: "NO_VERIFIED_SENDER_ACCOUNT", message: "No verified sending account is connected; sending remains unavailable until a channel is configured" }],
    };
  }
}

export class CampaignAutopilotPolicyLockedError extends Error {
  constructor() {
    super("CAMPAIGN_AUTOPILOT_POLICY_LOCKED");
  }
}

function snapshotOf(campaign: typeof campaigns.$inferSelect): CampaignSnapshot {
  return {
    offerVersionId: campaign.offerVersionId ?? "",
    icpVersionId: campaign.icpVersionId,
    messagingStrategyVersionId: campaign.messagingStrategyVersionId ?? "",
    aiPolicyVersionId: campaign.aiPolicyVersionId ?? "",
    sequenceVersionId: campaign.sequenceVersionId ?? "",
  };
}
