import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Clock } from "@outbound/application/shared/ports";
import { deriveCampaignExecutionState } from "@outbound/domain/campaigns/campaign-automation-health";
import type { Database } from "@outbound/infrastructure/database/client";
import { campaigns, outreachActions } from "@outbound/infrastructure/database/schema";

export class CampaignHealthReconciler {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async reconcile(limit = 100): Promise<number> {
    const staleCampaigns = await this.database
      .select({ id: campaigns.id, workspaceId: campaigns.workspaceId })
      .from(campaigns)
      .where(and(
        eq(campaigns.status, "active"),
        eq(campaigns.automationStage, "attention"),
        isNull(campaigns.automationErrorCode),
        ne(campaigns.status, "archived"),
      ))
      .limit(limit);
    let repaired = 0;
    for (const campaign of staleCampaigns) {
      const [pendingActions, failedActions] = await Promise.all([
        this.database
          .select({ id: outreachActions.id })
          .from(outreachActions)
          .where(and(
            eq(outreachActions.workspaceId, campaign.workspaceId),
            eq(outreachActions.campaignId, campaign.id),
            inArray(outreachActions.status, ["scheduled", "executing"]),
          )),
        this.database
          .select({
            code: outreachActions.lastErrorCode,
            message: outreachActions.lastErrorMessage,
          })
          .from(outreachActions)
          .where(and(
            eq(outreachActions.workspaceId, campaign.workspaceId),
            eq(outreachActions.campaignId, campaign.id),
            eq(outreachActions.status, "failed"),
          ))
          .orderBy(desc(outreachActions.updatedAt))
          .limit(1),
      ]);
      const state = deriveCampaignExecutionState({
        pendingActionCount: pendingActions.length,
        latestFailedAction: failedActions[0] ?? null,
      });
      const [updated] = await this.database
        .update(campaigns)
        .set({
          status: state.campaignStatus,
          automationStage: state.automationStage,
          automationErrorCode: state.automationErrorCode,
          automationErrorMessage: state.automationErrorMessage,
          updatedAt: this.clock.now(),
        })
        .where(and(
          eq(campaigns.workspaceId, campaign.workspaceId),
          eq(campaigns.id, campaign.id),
          eq(campaigns.automationStage, "attention"),
          isNull(campaigns.automationErrorCode),
        ))
        .returning({ id: campaigns.id });
      if (updated) repaired += 1;
    }
    return repaired;
  }
}
