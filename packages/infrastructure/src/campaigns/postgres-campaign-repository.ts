import { and, desc, eq, sql } from "drizzle-orm";
import { transitionCampaign, type CampaignSnapshot, type CampaignTransition } from "@outbound/domain/campaigns/campaign";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  aiPolicyVersions,
  auditLogs,
  campaigns,
  icpVersions,
  messagingStrategyVersions,
  offerVersions,
  outboxEvents,
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

  async listCampaigns(workspaceId: string) {
    return this.db.select().from(campaigns)
      .where(eq(campaigns.workspaceId, workspaceId))
      .orderBy(desc(campaigns.updatedAt));
  }

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
      const rows = await tx.insert(campaigns).values(input).returning();
      const campaign = rows[0]!;
      const [event] = await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "Campaign",
        aggregateId: input.id,
        eventType: "CampaignCreated",
        payload: { type: "CampaignCreated", campaignId: input.id, workspaceId: input.workspaceId, actorUserId: input.createdBy },
      }).returning({ id: outboxEvents.id });
      if (event) {
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
      return campaign;
    });
  }

  async getCampaign(input: { workspaceId: string; campaignId: string }) {
    const rows = await this.db.select().from(campaigns).where(and(
      eq(campaigns.workspaceId, input.workspaceId),
      eq(campaigns.id, input.campaignId),
    )).limit(1);
    return rows[0] ?? null;
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
      const current = await this.lockedCampaign(tx, input.workspaceId, input.campaignId);
      if (!current) throw new Error("CAMPAIGN_NOT_FOUND");
      if (current.status !== "draft") throw new Error("CAMPAIGN_SNAPSHOT_IMMUTABLE");
      const rows = await tx.update(campaigns).set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(input.offerVersionId !== undefined ? { offerVersionId: input.offerVersionId } : {}),
        ...(input.icpVersionId !== undefined ? { icpVersionId: input.icpVersionId } : {}),
        ...(input.messagingStrategyVersionId !== undefined ? { messagingStrategyVersionId: input.messagingStrategyVersionId } : {}),
        ...(input.aiPolicyVersionId !== undefined ? { aiPolicyVersionId: input.aiPolicyVersionId } : {}),
        ...(input.sequenceVersionId !== undefined ? { sequenceVersionId: input.sequenceVersionId } : {}),
        updatedAt: new Date(),
      }).where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId))).returning();
      return rows[0]!;
    });
  }

  async preflight(input: { workspaceId: string; campaignId: string }): Promise<CampaignPreflightResult> {
    const campaign = await this.getCampaign(input);
    if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
    return this.preflightSnapshot(this.db, input.workspaceId, campaign);
  }

  async transition(input: {
    workspaceId: string;
    campaignId: string;
    transition: CampaignTransition;
    userId: string;
    at: Date;
  }) {
    return this.db.transaction(async (tx) => {
      const current = await this.lockedCampaign(tx, input.workspaceId, input.campaignId);
      if (!current) throw new Error("CAMPAIGN_NOT_FOUND");
      const result = transitionCampaign(current.status, input.transition);
      if (!result.changed) return current;
      if (input.transition === "activate") {
        const preflight = await this.preflightSnapshot(tx, input.workspaceId, current);
        if (!preflight.ok) throw new CampaignPreflightError(preflight);
      }
      const timestamps = input.transition === "activate"
        ? { activatedBy: input.userId, activatedAt: input.at }
        : input.transition === "pause"
          ? { pausedAt: input.at }
          : input.transition === "archive"
            ? { archivedAt: input.at }
            : {};
      const updatedRows = await tx.update(campaigns).set({
        status: result.status,
        ...timestamps,
        updatedAt: input.at,
      }).where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId))).returning();
      const updated = updatedRows[0]!;
      const eventType = {
        activate: "CampaignActivated",
        pause: "CampaignPaused",
        resume: "CampaignResumed",
        archive: "CampaignArchived",
      }[input.transition];
      const [event] = await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "Campaign",
        aggregateId: input.campaignId,
        eventType,
        payload: {
          type: eventType,
          campaignId: input.campaignId,
          workspaceId: input.workspaceId,
          actorUserId: input.userId,
          status: result.status,
          snapshot: snapshotOf(updated),
        },
      }).returning({ id: outboxEvents.id });
      if (event) {
        await tx.insert(auditLogs).values({
          workspaceId: input.workspaceId,
          actorUserId: input.userId,
          action: eventType,
          subjectType: "Campaign",
          subjectId: input.campaignId,
          changes: { status: result.status, snapshot: snapshotOf(updated) },
          sourceEventId: event.id,
        });
      }
      return updated;
    });
  }

  private async lockedCampaign(tx: any, workspaceId: string, campaignId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${campaignId}, 0))`);
    const rows = await tx.select().from(campaigns).where(and(
      eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, campaignId),
    )).limit(1);
    return rows[0] ?? null;
  }

  private async preflightSnapshot(tx: any, workspaceId: string, campaign: typeof campaigns.$inferSelect): Promise<CampaignPreflightResult> {
    const checks = [
      { reference: "offerVersionId" as const, versionId: campaign.offerVersionId, table: offerVersions, code: "OFFER_VERSION_NOT_PUBLISHED" },
      { reference: "icpVersionId" as const, versionId: campaign.icpVersionId, table: icpVersions, code: "ICP_VERSION_NOT_PUBLISHED" },
      { reference: "messagingStrategyVersionId" as const, versionId: campaign.messagingStrategyVersionId, table: messagingStrategyVersions, code: "MESSAGING_STRATEGY_VERSION_NOT_PUBLISHED" },
      { reference: "aiPolicyVersionId" as const, versionId: campaign.aiPolicyVersionId, table: aiPolicyVersions, code: "AI_POLICY_VERSION_NOT_PUBLISHED" },
      { reference: "sequenceVersionId" as const, versionId: campaign.sequenceVersionId, table: sequenceVersions, code: "SEQUENCE_VERSION_NOT_PUBLISHED" },
    ];
    const blockers: CampaignPreflightBlocker[] = [];
    for (const check of checks) {
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
      warnings: [{
        code: "NO_VERIFIED_SENDER_ACCOUNT",
        message: "No verified sending account is connected; sending remains unavailable until F-035 is configured",
      }],
    };
  }
}

function snapshotOf(campaign: typeof campaigns.$inferSelect): CampaignSnapshot {
  return {
    offerVersionId: campaign.offerVersionId,
    icpVersionId: campaign.icpVersionId,
    messagingStrategyVersionId: campaign.messagingStrategyVersionId,
    aiPolicyVersionId: campaign.aiPolicyVersionId,
    sequenceVersionId: campaign.sequenceVersionId,
  };
}
