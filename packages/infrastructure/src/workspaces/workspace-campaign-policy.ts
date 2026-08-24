import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import {
  campaignAutopilotFromWorkspacePolicy,
  defaultWorkspaceDataPolicy,
  type WorkspaceDataPolicy,
} from "@outbound/domain/workspaces/workspace-data-policy";
import type { Database } from "@outbound/infrastructure/database/client";
import { workspaceDataSettings } from "@outbound/infrastructure/database/schema";
import { eq } from "drizzle-orm";

export async function workspaceCampaignPolicy(
  executor: Pick<Database, "select">,
  workspaceId: string,
  channel: ProspectingChannel,
) {
  const [row] = await executor.select().from(workspaceDataSettings).where(eq(workspaceDataSettings.workspaceId, workspaceId)).limit(1);
  const defaults = defaultWorkspaceDataPolicy();
  const policy: WorkspaceDataPolicy = row ? {
    sending: {
      timezone: row.timezone,
      activeDays: Array.isArray(row.activeDays) ? row.activeDays.filter((value): value is number => typeof value === "number") : defaults.sending.activeDays,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
    },
    channelLimits: { linkedin: row.linkedinDailyLimit, email: row.emailDailyLimit, whatsapp: row.whatsappDailyLimit },
    retention: {
      invitationsDays: row.invitationsRetentionDays,
      jobsDays: row.jobsRetentionDays,
      auditDays: row.auditRetentionDays,
      memoryEventsDays: row.memoryEventsRetentionDays,
      memorySnapshotsDays: row.memorySnapshotsRetentionDays,
      memoryReceiptsDays: row.memoryReceiptsRetentionDays,
    },
  } : defaults;
  return campaignAutopilotFromWorkspacePolicy(policy, channel);
}
