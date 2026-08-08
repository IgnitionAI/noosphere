import { and, desc, eq } from "drizzle-orm";
import {
  deriveAutopilotHealth,
  deriveAutopilotStep,
  type CampaignAutopilotDashboard,
  type CampaignAutopilotException,
} from "@outbound/application/campaigns/campaign-autopilot-dashboard";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  automatedReplies,
  calendarBookings,
  campaignProspects,
  campaigns,
  conversations,
  meetingProposals,
  messages,
  outreachActions,
  sequenceEnrollments,
} from "@outbound/infrastructure/database/schema";

/** Read model for the complete autonomous campaign loop. */
export class PostgresCampaignAutopilotDashboard {
  constructor(private readonly database: Database) {}

  async get(input: {
    workspaceId: string;
    campaignId: string;
  }): Promise<CampaignAutopilotDashboard | null> {
    const [campaign] = await this.database
      .select({
        id: campaigns.id,
        status: campaigns.status,
        automationStage: campaigns.automationStage,
        automationErrorCode: campaigns.automationErrorCode,
        automationErrorMessage: campaigns.automationErrorMessage,
        updatedAt: campaigns.updatedAt,
      })
      .from(campaigns)
      .where(and(
        eq(campaigns.workspaceId, input.workspaceId),
        eq(campaigns.id, input.campaignId),
      ))
      .limit(1);
    if (!campaign) return null;

    const [prospects, enrollments, actions, inboundMessages, replies, proposals, bookings] = await Promise.all([
      this.database.select({ eligible: campaignProspects.eligible }).from(campaignProspects).where(and(
        eq(campaignProspects.workspaceId, input.workspaceId),
        eq(campaignProspects.campaignId, input.campaignId),
      )),
      this.database.select({ status: sequenceEnrollments.status }).from(sequenceEnrollments).where(and(
        eq(sequenceEnrollments.workspaceId, input.workspaceId),
        eq(sequenceEnrollments.campaignId, input.campaignId),
      )),
      this.database.select({
        status: outreachActions.status,
        errorCode: outreachActions.lastErrorCode,
        errorMessage: outreachActions.lastErrorMessage,
        updatedAt: outreachActions.updatedAt,
      }).from(outreachActions).where(and(
        eq(outreachActions.workspaceId, input.workspaceId),
        eq(outreachActions.campaignId, input.campaignId),
      )),
      this.database.select({ id: messages.id }).from(messages).innerJoin(
        conversations,
        and(
          eq(conversations.workspaceId, messages.workspaceId),
          eq(conversations.id, messages.conversationId),
        ),
      ).where(and(
        eq(messages.workspaceId, input.workspaceId),
        eq(conversations.campaignId, input.campaignId),
        eq(messages.direction, "inbound"),
      )),
      this.database.select({
        status: automatedReplies.status,
        errorCode: automatedReplies.errorCode,
        errorMessage: automatedReplies.errorMessage,
        updatedAt: automatedReplies.updatedAt,
      }).from(automatedReplies).innerJoin(
        conversations,
        and(
          eq(conversations.workspaceId, automatedReplies.workspaceId),
          eq(conversations.id, automatedReplies.conversationId),
        ),
      ).where(and(
        eq(automatedReplies.workspaceId, input.workspaceId),
        eq(conversations.campaignId, input.campaignId),
      )),
      this.database.select({ status: meetingProposals.status }).from(meetingProposals).where(and(
        eq(meetingProposals.workspaceId, input.workspaceId),
        eq(meetingProposals.campaignId, input.campaignId),
      )),
      this.database.select({ status: calendarBookings.status }).from(calendarBookings).where(and(
        eq(calendarBookings.workspaceId, input.workspaceId),
        eq(calendarBookings.campaignId, input.campaignId),
      )).orderBy(desc(calendarBookings.updatedAt)),
    ]);

    const exceptions = collectExceptions(campaign, actions, replies);
    const terminalWithoutProspects = campaign.automationErrorCode === "NO_PROSPECTS_FOUND";
    const counts = {
      discovered: prospects.length,
      eligible: prospects.filter((item) => item.eligible).length,
      enrolled: enrollments.length,
      scheduled: actions.filter((item) => item.status === "scheduled" || item.status === "executing").length,
      sent: actions.filter((item) => item.status === "sent").length,
      replies: inboundMessages.length,
      setterReplies: replies.filter((item) => item.status === "sent").length,
      offeredMeetings: proposals.filter((item) => item.status === "offered").length,
      bookedMeetings: bookings.filter((item) => item.status === "booked").length,
    };
    return {
      campaignId: campaign.id,
      health: deriveAutopilotHealth({
        campaignStatus: campaign.status,
        automationStage: terminalWithoutProspects ? "completed" : campaign.automationStage,
        exceptionCount: exceptions.length,
      }),
      currentStep: deriveAutopilotStep({
        automationStage: terminalWithoutProspects ? "completed" : campaign.automationStage,
        replies: counts.replies,
        offeredMeetings: counts.offeredMeetings,
        bookedMeetings: counts.bookedMeetings,
      }),
      counts,
      exceptions,
      updatedAt: campaign.updatedAt,
    };
  }
}

function collectExceptions(
  campaign: {
    automationStage: string;
    automationErrorCode: string | null;
    automationErrorMessage: string | null;
    updatedAt: Date;
  },
  actions: readonly {
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    updatedAt: Date;
  }[],
  replies: readonly {
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    updatedAt: Date;
  }[],
): CampaignAutopilotException[] {
  const grouped = new Map<string, CampaignAutopilotException>();
  if (
    campaign.automationStage === "attention"
    && campaign.automationErrorCode !== "NO_PROSPECTS_FOUND"
  ) {
    addException(grouped, {
      code: campaign.automationErrorCode ?? "CAMPAIGN_REQUIRES_ATTENTION",
      message: campaign.automationErrorMessage ?? "La campagne nécessite une intervention technique.",
      occurredAt: campaign.updatedAt,
    });
  }
  for (const item of actions.filter((row) => row.status === "failed")) {
    addException(grouped, {
      code: item.errorCode ?? "OUTREACH_ACTION_FAILED",
      message: item.errorMessage ?? "Un envoi n’a pas pu être exécuté.",
      occurredAt: item.updatedAt,
    });
  }
  for (const item of replies.filter((row) => row.status === "failed")) {
    addException(grouped, {
      code: item.errorCode ?? "AUTOMATED_REPLY_FAILED",
      message: item.errorMessage ?? "Une réponse du Setter n’a pas pu être envoyée.",
      occurredAt: item.updatedAt,
    });
  }
  return Array.from(grouped.values()).sort(
    (left, right) => (right.lastOccurredAt?.getTime() ?? 0) - (left.lastOccurredAt?.getTime() ?? 0),
  );
}

function addException(
  grouped: Map<string, CampaignAutopilotException>,
  input: { code: string; message: string; occurredAt: Date },
): void {
  const current = grouped.get(input.code);
  grouped.set(input.code, {
    code: input.code,
    message: input.message,
    count: (current?.count ?? 0) + 1,
    lastOccurredAt: !current?.lastOccurredAt || input.occurredAt > current.lastOccurredAt
      ? input.occurredAt
      : current.lastOccurredAt,
  });
}
