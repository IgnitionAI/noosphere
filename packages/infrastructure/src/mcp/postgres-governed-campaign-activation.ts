import { nativeActivationPolicyVersion } from "@outbound/infrastructure/campaigns/native-activation-policy-version";
import { and, eq, sql } from "drizzle-orm";
import type { Database, DatabaseExecutor } from "@outbound/infrastructure/database/client";
import { approvalItems, campaigns, mcpEffectProposals, outboxEvents, workspaceMembers } from "@outbound/infrastructure/database/schema";
import { PostgresCampaignRepository } from "@outbound/infrastructure/campaigns/postgres-campaign-repository";

type Activation = { workspaceId: string; campaignId: string; proposalId: string };

/** A local activation receipt is committed atomically with the transition and scheduling job. */
export class PostgresGovernedCampaignActivation {
  constructor(private readonly database: Database, private readonly now: () => Date = () => new Date()) {}

  findReceipt(input: Activation): Promise<Record<string, unknown> | null> {
    return findReceipt(this.database, input);
  }

  async activate(input: Activation): Promise<Record<string, unknown>> {
    return this.database.transaction(async (tx) => {
      const replay = await findReceipt(tx, input);
      if (replay) return replay;
      const [initialCampaign] = await tx.select().from(campaigns)
        .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId))).limit(1);
      if (!initialCampaign) throw new Error("CAMPAIGN_NOT_FOUND");
      // Assessment completion locks its source before updating campaigns. Preserve that order.
      await nativeActivationPolicyVersion(tx, initialCampaign, true);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.campaignId}, 0))`);
      const concurrentReplay = await findReceipt(tx, input);
      if (concurrentReplay) return concurrentReplay;
      const [approval] = await tx.select({ userId: approvalItems.decisionBy, source: mcpEffectProposals.sourceSnapshot })
        .from(mcpEffectProposals).innerJoin(approvalItems, and(eq(approvalItems.workspaceId, mcpEffectProposals.workspaceId), eq(approvalItems.id, mcpEffectProposals.approvalItemId), eq(approvalItems.proposalId, mcpEffectProposals.id)))
        .where(and(eq(mcpEffectProposals.workspaceId, input.workspaceId), eq(mcpEffectProposals.id, input.proposalId),
          eq(mcpEffectProposals.aggregateId, input.campaignId), eq(mcpEffectProposals.kind, "campaign_activation"),
          eq(mcpEffectProposals.status, "accepted"), eq(approvalItems.status, "approved"))).limit(1);
      if (!approval?.userId) throw new Error("MCP_EFFECT_APPROVAL_REQUIRED");
      const [member] = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, approval.userId), eq(workspaceMembers.status, "active"))).limit(1);
      if (!member || (member.role !== "owner" && member.role !== "admin")) throw new Error("MCP_EFFECT_ACTIVATION_FORBIDDEN");
      const [campaign] = await tx.select().from(campaigns)
        .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId))).for("update").limit(1);
      if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
      if (campaign.assessmentId !== initialCampaign.assessmentId) throw new Error("MCP_EFFECT_SOURCE_STALE");
      const source = approval.source && typeof approval.source === "object" ? approval.source as Record<string, unknown> : {};
      if (typeof source.sourceUpdatedAt !== "string" || Date.parse(source.sourceUpdatedAt) !== campaign.updatedAt.getTime()) throw new Error("MCP_EFFECT_SOURCE_STALE");
      if (source.activationReady !== undefined && source.policyVersion !== await nativeActivationPolicyVersion(tx, campaign)) throw new Error("MCP_EFFECT_SOURCE_STALE");
      if (campaign.status !== "draft") throw new Error("CAMPAIGN_ACTIVATION_STATE_INVALID");
      const at = this.now();
      await new PostgresCampaignRepository(tx as unknown as Database).transition({ workspaceId: input.workspaceId, campaignId: input.campaignId, transition: "activate", userId: approval.userId, at });
      await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: "Campaign", aggregateId: input.campaignId,
        eventType: "McpCampaignActivationRecorded", payload: { proposalId: input.proposalId }, createdAt: at });
      const receipt = await findReceipt(tx, input);
      if (!receipt) throw new Error("MCP_EFFECT_RECEIPT_MISSING");
      return receipt;
    });
  }
}

async function findReceipt(database: DatabaseExecutor, input: Activation): Promise<Record<string, unknown> | null> {
  const [event] = await database.select({ id: outboxEvents.id, createdAt: outboxEvents.createdAt }).from(outboxEvents)
    .where(and(eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.aggregateId, input.campaignId),
      eq(outboxEvents.eventType, "McpCampaignActivationRecorded"), sql`${outboxEvents.payload}->>'proposalId' = ${input.proposalId}`)).limit(1);
  return event ? { campaignId: input.campaignId, activationReceiptId: event.id, activatedAt: event.createdAt.toISOString() } : null;
}
