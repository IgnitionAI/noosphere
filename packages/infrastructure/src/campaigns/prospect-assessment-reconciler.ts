import { and, eq, inArray, sql } from "drizzle-orm";
import { CAMPAIGN_COMPOSITION_JOB_TYPE } from "@outbound/application/campaigns/autonomous-prospecting";
import type { Clock } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import { campaignProspects, campaigns, jobs } from "@outbound/infrastructure/database/schema";

export class ProspectAssessmentReconciler {
  constructor(private readonly database: Database, private readonly clock: Clock) {}

  async reconcile(): Promise<number> {
    const campaignRows = await this.database
      .selectDistinct({ campaignId: campaignProspects.campaignId, workspaceId: campaignProspects.workspaceId })
      .from(campaignProspects)
      .innerJoin(campaigns, and(eq(campaigns.workspaceId, campaignProspects.workspaceId), eq(campaigns.id, campaignProspects.campaignId)))
      .where(and(
        eq(campaignProspects.eligible, true),
        eq(campaignProspects.state, "imported"),
        inArray(campaigns.status, ["active", "paused"]),
        sql`${campaignProspects.aiAssessment} = '{}'::jsonb`,
      ));
    let enqueued = 0;
    for (const campaign of campaignRows) {
      const candidates = await this.database
        .select({ candidateId: campaignProspects.candidateId })
        .from(campaignProspects)
        .where(and(
          eq(campaignProspects.workspaceId, campaign.workspaceId),
          eq(campaignProspects.campaignId, campaign.campaignId),
          eq(campaignProspects.eligible, true),
          eq(campaignProspects.state, "imported"),
          sql`${campaignProspects.aiAssessment} = '{}'::jsonb`,
        ));
      if (!candidates.length) continue;
      const now = this.clock.now();
      const [inserted] = await this.database.insert(jobs).values({
        id: crypto.randomUUID(),
        workspaceId: campaign.workspaceId,
        type: CAMPAIGN_COMPOSITION_JOB_TYPE,
        payload: {
          workspaceId: campaign.workspaceId,
          campaignId: campaign.campaignId,
          incremental: true,
          candidateIds: candidates.map((candidate) => candidate.candidateId),
        },
        idempotencyKey: `${campaign.campaignId}:assessment-backfill:v1`,
        correlationId: `campaign:${campaign.campaignId}:assessment-backfill`,
        maxAttempts: 3,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning({ id: jobs.id });
      if (inserted) enqueued += 1;
    }
    return enqueued;
  }
}
