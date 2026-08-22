import { and, desc, eq, exists, gte, inArray, or, sql } from "drizzle-orm";
import type { Clock } from "@outbound/application/shared/ports";
import { deriveCampaignExecutionState } from "@outbound/domain/campaigns/campaign-automation-health";
import type { Database } from "@outbound/infrastructure/database/client";
import { campaigns, jobs, outreachActions } from "@outbound/infrastructure/database/schema";

export class CampaignHealthReconciler {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async reconcile(limit = 100): Promise<number> {
    const staleCampaigns = await this.database
      .select({
        id: campaigns.id,
        workspaceId: campaigns.workspaceId,
        status: campaigns.status,
        automationStage: campaigns.automationStage,
        automationErrorCode: campaigns.automationErrorCode,
        automationErrorMessage: campaigns.automationErrorMessage,
        updatedAt: campaigns.updatedAt,
      })
      .from(campaigns)
      .where(and(
        eq(campaigns.status, "active"),
        or(
          eq(campaigns.automationStage, "attention"),
          exists(this.database
            .select({ id: outreachActions.id })
            .from(outreachActions)
            .where(and(
              eq(outreachActions.workspaceId, campaigns.workspaceId),
              eq(outreachActions.campaignId, campaigns.id),
              eq(outreachActions.status, "failed"),
            ))),
        ),
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
      const recoveredComposition = campaign.automationErrorCode === "CAMPAIGN_COMPOSITION_FAILED"
        && await this.#hasCompletedCompositionAfter(campaign);
      if (
        campaign.automationErrorCode
        && !failedActions[0]
        && !isRecoveredOutreachError(campaign.automationErrorCode)
        && !recoveredComposition
      ) continue;
      const state = deriveCampaignExecutionState({
        pendingActionCount: pendingActions.length,
        latestFailedAction: failedActions[0] ?? null,
      });
      if (
        campaign.status === state.campaignStatus
        && campaign.automationStage === state.automationStage
        && campaign.automationErrorCode === state.automationErrorCode
        && campaign.automationErrorMessage === state.automationErrorMessage
      ) continue;
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
          eq(campaigns.status, "active"),
          or(
            eq(campaigns.automationStage, "attention"),
            exists(this.database
              .select({ id: outreachActions.id })
              .from(outreachActions)
              .where(and(
                eq(outreachActions.workspaceId, campaigns.workspaceId),
                eq(outreachActions.campaignId, campaigns.id),
                eq(outreachActions.status, "failed"),
              ))),
          ),
        ))
        .returning({ id: campaigns.id });
      if (updated) repaired += 1;
    }
    return repaired;
  }

  async #hasCompletedCompositionAfter(campaign: {
    readonly id: string;
    readonly workspaceId: string;
    readonly updatedAt: Date;
  }): Promise<boolean> {
    const [completed] = await this.database.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.workspaceId, campaign.workspaceId),
      eq(jobs.type, "campaign.messages.compose"),
      eq(jobs.status, "completed"),
      gte(jobs.completedAt, campaign.updatedAt),
      sql`${jobs.payload} ->> 'campaignId' = ${campaign.id}`,
      sql`coalesce(${jobs.lastErrorCode}, '') not in ('JOB_SUPERSEDED', 'JOB_OUTCOME_RECONCILED')`,
    )).orderBy(desc(jobs.completedAt)).limit(1);
    return Boolean(completed);
  }
}

function isRecoveredOutreachError(code: string): boolean {
  return [
    "UNIPILE_422",
    "UNIPILE_PROVIDER_LIMIT",
    "LINKEDIN_RELATION_PENDING",
    "LINKEDIN_INVITE_RECENT",
    "OUTSIDE_SENDING_WINDOW_EXHAUSTED",
    "ACTION_EXECUTION_STATE_UNKNOWN",
  ].includes(code);
}
