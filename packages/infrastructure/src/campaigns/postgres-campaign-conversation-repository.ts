import { and, asc, desc, eq } from "drizzle-orm";
import {
  deriveProspectEngagementState,
  isHotProspectState,
  type CampaignAutomatedReplyView,
  type CampaignConversationDetail,
  type CampaignEngagementOverview,
  type CampaignMessageView,
  type CampaignReplyDecisionView,
} from "@outbound/application/campaigns/campaign-engagement";
import type { InboundReplyIntent } from "@outbound/application/campaigns/inbound-reply-agent";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  automatedReplies,
  calendarBookings,
  campaignProspects,
  campaigns,
  conversations,
  messages,
  meetingProposals,
  opportunities,
  outreachActions,
  prospectDiscoveryCandidates,
  replyClassifications,
  campaignEnrollments,
} from "@outbound/infrastructure/database/schema";

export class PostgresCampaignConversationRepository {
  constructor(private readonly db: Database) {}

  async getOverview(input: {
    workspaceId: string;
    campaignId: string;
  }): Promise<CampaignEngagementOverview | null> {
    const [campaign] = await this.db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)))
      .limit(1);
    if (!campaign) return null;

    const [prospectRows, actionRows, conversationRows, messageRows, decisionRows, replyRows, opportunityRows, enrollmentRows] = await Promise.all([
      this.#prospects(input),
      this.#actions(input),
      this.#conversations(input),
      this.#messages(input),
      this.#decisions(input),
      this.#replies(input),
      this.#opportunities(input),
      this.#enrollments(input),
    ]);

    const actionsByContact = groupByContact(actionRows);
    const conversationsByContact = latestByContact(conversationRows, (row) => row.lastMessageAt);
    const messagesByContact = groupByContact(messageRows);
    const decisionsByContact = latestByContact(decisionRows, (row) => row.createdAt);
    const repliesByContact = latestByContact(replyRows, (row) => row.createdAt);
    const opportunitiesByContact = latestByContact(opportunityRows, (row) => row.updatedAt);
    const enrollmentsByContact = latestByContact(enrollmentRows, (row) => row.updatedAt);

    const prospects = prospectRows.map((prospect) => {
      const contactActions = prospect.contactId ? actionsByContact.get(prospect.contactId) ?? [] : [];
      const conversation = prospect.contactId ? conversationsByContact.get(prospect.contactId) ?? null : null;
      const contactMessages = prospect.contactId ? messagesByContact.get(prospect.contactId) ?? [] : [];
      const decisionRow = prospect.contactId ? decisionsByContact.get(prospect.contactId) ?? null : null;
      const replyRow = prospect.contactId ? repliesByContact.get(prospect.contactId) ?? null : null;
      const opportunity = prospect.contactId ? opportunitiesByContact.get(prospect.contactId) ?? null : null;
      const enrollment = prospect.contactId ? enrollmentsByContact.get(prospect.contactId) ?? null : null;
      const sentActions = contactActions.filter((action) => action.status === "sent");
      const scheduledActions = contactActions.filter((action) => action.status === "scheduled");
      const cancelledActions = contactActions.filter((action) => action.status === "cancelled");
      const inboundMessages = contactMessages.filter((message) => message.direction === "inbound");
      const decision = decisionRow ? decisionView(decisionRow) : null;
      const automatedReply = replyRow ? automatedReplyView(replyRow) : null;
      const actualLatestMessage = contactMessages
        .map(messageView)
        .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0] ?? null;
      const latestSentAction = sentActions
        .filter((action) => action.sentAt)
        .sort((left, right) => right.sentAt!.getTime() - left.sentAt!.getTime())[0] ?? null;
      const projectedActionMessage = latestSentAction ? actionMessageView(latestSentAction) : null;
      const lastMessage = latestMessage(actualLatestMessage, projectedActionMessage);
      const state = deriveProspectEngagementState({
        sent: sentActions.length > 0,
        replied: inboundMessages.length > 0,
        intent: decision?.intent ?? null,
        action: decision?.action ?? null,
        opportunityStage: opportunity?.stage ?? null,
      });
      const lastActivityAt = latestDate([
        lastMessage?.occurredAt,
        enrollment?.completedAt,
        prospect.updatedAt,
      ]) ?? prospect.updatedAt;
      return {
        campaignId: input.campaignId,
        candidateId: prospect.candidateId,
        contactId: prospect.contactId,
        conversationId: conversation?.id ?? null,
        fullName: prospect.fullName,
        headline: prospect.headline,
        companyName: prospect.companyName,
        score: prospect.score,
        eligible: prospect.eligible,
        state,
        lastMessage: lastMessage ? withoutMessageAnnotations(lastMessage) : null,
        lastActivityAt,
        decision,
        automatedReply,
        enrollment: enrollment
          ? {
              status: enrollment.status,
              suspensionReason: null,
              suspendedAt: enrollment.completedAt,
            }
          : null,
        sentCount: sentActions.length,
        pendingFollowUps: scheduledActions.length,
        cancelledFollowUps: cancelledActions.length,
        relaunchesCancelled: enrollment?.status === "cancelled"
          && cancelledActions.length > 0,
        opportunity: opportunity
          ? { stage: opportunity.stage, nextAction: opportunity.nextAction }
          : null,
      };
    });

    return {
      campaignId: input.campaignId,
      metrics: {
        targeted: prospects.filter((prospect) => prospect.eligible).length,
        contacted: prospects.filter((prospect) => prospect.sentCount > 0).length,
        replies: prospects.filter((prospect) => ["replied", "qualified", "refused", "meeting"].includes(prospect.state)).length,
        hot: prospects.filter((prospect) => isHotProspectState(prospect.state)).length,
        meetings: prospects.filter((prospect) => prospect.state === "meeting").length,
      },
      prospects: prospects.sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime()),
    };
  }

  async getConversation(input: {
    workspaceId: string;
    campaignId: string;
    conversationId: string;
  }): Promise<CampaignConversationDetail | null> {
    const [conversation] = await this.db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        channel: conversations.channel,
        status: conversations.status,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, input.workspaceId),
          eq(conversations.campaignId, input.campaignId),
          eq(conversations.id, input.conversationId),
        ),
      )
      .limit(1);
    if (!conversation) return null;

    const [prospect] = await this.db
      .select({
        candidateId: campaignProspects.candidateId,
        fullName: prospectDiscoveryCandidates.fullName,
        headline: prospectDiscoveryCandidates.headline,
        companyName: prospectDiscoveryCandidates.companyName,
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
          eq(campaignProspects.contactId, conversation.contactId),
        ),
      )
      .limit(1);
    const context = { workspaceId: input.workspaceId, campaignId: input.campaignId };
    const [messageRows, decisionRows, replyRows, actionRows, opportunityRows, enrollmentRows, proposalRows, bookingRows] = await Promise.all([
      this.#conversationMessages(input.workspaceId, input.conversationId),
      this.#conversationDecisions(input.workspaceId, input.conversationId),
      this.#conversationReplies(input.workspaceId, input.conversationId),
      this.#actions(context),
      this.#opportunities(context),
      this.#enrollments(context),
      this.db.select().from(meetingProposals).where(and(
        eq(meetingProposals.workspaceId, input.workspaceId),
        eq(meetingProposals.conversationId, input.conversationId),
      )).orderBy(desc(meetingProposals.createdAt)).limit(1),
      this.db.select().from(calendarBookings).where(and(
        eq(calendarBookings.workspaceId, input.workspaceId),
        eq(calendarBookings.contactId, conversation.contactId),
        eq(calendarBookings.campaignId, input.campaignId),
      )).orderBy(desc(calendarBookings.updatedAt)).limit(1),
    ]);
    const decisionsByMessage = new Map(decisionRows.map((row) => [row.messageId, decisionView(row)]));
    const repliesByInboundMessage = new Map(replyRows.map((row) => [row.inboundMessageId, automatedReplyView(row)]));
    const timeline: CampaignMessageView[] = [
      ...messageRows.map((row) => ({
        ...messageView(row),
        decision: decisionsByMessage.get(row.id) ?? null,
        automatedReply: repliesByInboundMessage.get(row.id) ?? null,
      })),
      ...actionRows
        .filter((action) => action.contactId === conversation.contactId && action.status === "sent" && action.sentAt)
        .map(actionMessageView),
    ].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    const decision = decisionRows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    const automatedReply = replyRows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    const opportunity = opportunityRows
      .filter((row) => row.contactId === conversation.contactId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
    const enrollment = enrollmentRows
      .filter((row) => row.contactId === conversation.contactId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
    const contactActions = actionRows.filter((row) => row.contactId === conversation.contactId);
    const pendingFollowUps = contactActions.filter((row) => row.status === "scheduled").length;
    const cancelledFollowUps = contactActions.filter((row) => row.status === "cancelled").length;
    const proposal = proposalRows[0] ?? null;
    const booking = bookingRows[0] ?? null;

    return {
      campaignId: input.campaignId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      candidateId: prospect?.candidateId ?? null,
      fullName: prospect?.fullName ?? "Prospect",
      headline: prospect?.headline ?? null,
      companyName: prospect?.companyName ?? null,
      channel: conversation.channel,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt,
      messages: timeline,
      decision: decision ? decisionView(decision) : null,
      automatedReply: automatedReply ? automatedReplyView(automatedReply) : null,
      enrollment: enrollment
        ? {
            status: enrollment.status,
            suspensionReason: null,
            suspendedAt: enrollment.completedAt,
          }
        : null,
      pendingFollowUps,
      cancelledFollowUps,
      relaunchesCancelled: enrollment?.status === "cancelled"
        && cancelledFollowUps > 0,
      opportunity: opportunity
        ? { stage: opportunity.stage, nextAction: opportunity.nextAction }
        : null,
      meeting: proposal || booking
        ? {
            status: proposal?.status === "offered"
              ? "offered"
              : booking?.status ?? proposal?.status ?? "unknown",
            timeZone: proposal?.timeZone ?? null,
            proposedSlots: meetingSlotViews(proposal?.slots),
            selectedSlotStart: proposal?.selectedSlotStart ?? null,
            bookedStartAt: booking?.startAt ?? null,
            meetingUrl: booking?.meetingUrl ?? null,
          }
        : null,
    };
  }

  #prospects(input: { workspaceId: string; campaignId: string }) {
    return this.db
      .select({
        candidateId: campaignProspects.candidateId,
        contactId: campaignProspects.contactId,
        score: campaignProspects.score,
        eligible: campaignProspects.eligible,
        updatedAt: campaignProspects.updatedAt,
        fullName: prospectDiscoveryCandidates.fullName,
        headline: prospectDiscoveryCandidates.headline,
        companyName: prospectDiscoveryCandidates.companyName,
      })
      .from(campaignProspects)
      .innerJoin(
        prospectDiscoveryCandidates,
        and(
          eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
          eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
        ),
      )
      .where(and(eq(campaignProspects.workspaceId, input.workspaceId), eq(campaignProspects.campaignId, input.campaignId)));
  }

  #actions(input: { workspaceId: string; campaignId: string }) {
    return this.db
      .select({
        id: outreachActions.id,
        contactId: outreachActions.contactId,
        status: outreachActions.status,
        providerRequestId: outreachActions.providerRequestId,
        sentAt: outreachActions.sentAt,
        dueAt: outreachActions.dueAt,
        contentSnapshot: outreachActions.contentSnapshot,
      })
      .from(outreachActions)
      .where(and(eq(outreachActions.workspaceId, input.workspaceId), eq(outreachActions.campaignId, input.campaignId)));
  }

  #conversations(input: { workspaceId: string; campaignId: string }) {
    return this.db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(and(eq(conversations.workspaceId, input.workspaceId), eq(conversations.campaignId, input.campaignId)));
  }

  #messages(input: { workspaceId: string; campaignId: string }) {
    return this.db
      .select({
        id: messages.id,
        contactId: conversations.contactId,
        providerMessageId: messages.providerMessageId,
        direction: messages.direction,
        senderType: messages.senderType,
        body: messages.body,
        sentAt: messages.sentAt,
        receivedAt: messages.receivedAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(
        conversations,
        and(eq(conversations.workspaceId, messages.workspaceId), eq(conversations.id, messages.conversationId)),
      )
      .where(and(eq(messages.workspaceId, input.workspaceId), eq(conversations.campaignId, input.campaignId)));
  }

  #decisions(input: { workspaceId: string; campaignId: string }) {
    return this.db
      .select({
        messageId: replyClassifications.messageId,
        contactId: conversations.contactId,
        intent: replyClassifications.intent,
        confidence: replyClassifications.confidence,
        action: replyClassifications.action,
        rationale: replyClassifications.rationale,
        metadata: replyClassifications.metadata,
        createdAt: replyClassifications.createdAt,
      })
      .from(replyClassifications)
      .innerJoin(messages, and(eq(messages.workspaceId, replyClassifications.workspaceId), eq(messages.id, replyClassifications.messageId)))
      .innerJoin(conversations, and(eq(conversations.workspaceId, messages.workspaceId), eq(conversations.id, messages.conversationId)))
      .where(and(eq(replyClassifications.workspaceId, input.workspaceId), eq(conversations.campaignId, input.campaignId)));
  }

  #replies(input: { workspaceId: string; campaignId: string }) {
    return this.db
      .select({
        id: automatedReplies.id,
        contactId: conversations.contactId,
        inboundMessageId: automatedReplies.inboundMessageId,
        body: automatedReplies.body,
        status: automatedReplies.status,
        providerRequestId: automatedReplies.providerRequestId,
        errorCode: automatedReplies.errorCode,
        errorMessage: automatedReplies.errorMessage,
        sentAt: automatedReplies.sentAt,
        createdAt: automatedReplies.createdAt,
      })
      .from(automatedReplies)
      .innerJoin(conversations, and(eq(conversations.workspaceId, automatedReplies.workspaceId), eq(conversations.id, automatedReplies.conversationId)))
      .where(and(eq(automatedReplies.workspaceId, input.workspaceId), eq(conversations.campaignId, input.campaignId)));
  }

  #opportunities(input: { workspaceId: string; campaignId: string }) {
    return this.db
      .select({
        contactId: opportunities.contactId,
        stage: opportunities.stage,
        nextAction: opportunities.nextAction,
        updatedAt: opportunities.updatedAt,
      })
      .from(opportunities)
      .where(and(eq(opportunities.workspaceId, input.workspaceId), eq(opportunities.campaignId, input.campaignId)));
  }

  #enrollments(input: { workspaceId: string; campaignId: string }) {
    return this.db
      .select({
        contactId: campaignEnrollments.contactId,
        status: campaignEnrollments.status,
        completedAt: campaignEnrollments.completedAt,
        updatedAt: campaignEnrollments.createdAt,
      })
      .from(campaignEnrollments)
      .where(and(eq(campaignEnrollments.workspaceId, input.workspaceId), eq(campaignEnrollments.campaignId, input.campaignId)));
  }

  #conversationMessages(workspaceId: string, conversationId: string) {
    return this.db
      .select({
        id: messages.id,
        providerMessageId: messages.providerMessageId,
        direction: messages.direction,
        senderType: messages.senderType,
        body: messages.body,
        sentAt: messages.sentAt,
        receivedAt: messages.receivedAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.conversationId, conversationId)))
      .orderBy(asc(messages.createdAt));
  }

  #conversationDecisions(workspaceId: string, conversationId: string) {
    return this.db
      .select({
        messageId: replyClassifications.messageId,
        intent: replyClassifications.intent,
        confidence: replyClassifications.confidence,
        action: replyClassifications.action,
        rationale: replyClassifications.rationale,
        metadata: replyClassifications.metadata,
        createdAt: replyClassifications.createdAt,
      })
      .from(replyClassifications)
      .innerJoin(messages, and(eq(messages.workspaceId, replyClassifications.workspaceId), eq(messages.id, replyClassifications.messageId)))
      .where(and(eq(replyClassifications.workspaceId, workspaceId), eq(messages.conversationId, conversationId)))
      .orderBy(desc(replyClassifications.createdAt));
  }

  #conversationReplies(workspaceId: string, conversationId: string) {
    return this.db
      .select({
        id: automatedReplies.id,
        inboundMessageId: automatedReplies.inboundMessageId,
        body: automatedReplies.body,
        status: automatedReplies.status,
        providerRequestId: automatedReplies.providerRequestId,
        errorCode: automatedReplies.errorCode,
        errorMessage: automatedReplies.errorMessage,
        sentAt: automatedReplies.sentAt,
        createdAt: automatedReplies.createdAt,
      })
      .from(automatedReplies)
      .where(and(eq(automatedReplies.workspaceId, workspaceId), eq(automatedReplies.conversationId, conversationId)))
      .orderBy(desc(automatedReplies.createdAt));
  }
}

function meetingSlotViews(value: unknown): readonly {
  position: number;
  start: string;
  label: string;
}[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.position !== "number"
      || typeof row.start !== "string"
      || typeof row.label !== "string"
    ) return [];
    return [{ position: row.position, start: row.start, label: row.label }];
  }).sort((left, right) => left.position - right.position);
}

function groupByContact<T extends { contactId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.contactId, [...(grouped.get(row.contactId) ?? []), row]);
  return grouped;
}

function latestByContact<T extends { contactId: string }>(
  rows: readonly T[],
  date: (row: T) => Date,
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.contactId);
    if (!current || date(row).getTime() > date(current).getTime()) latest.set(row.contactId, row);
  }
  return latest;
}

function messageView(row: {
  id: string;
  providerMessageId: string;
  direction: string;
  senderType: string;
  body: string;
  sentAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
}): CampaignMessageView {
  return {
    id: row.id,
    providerMessageId: row.providerMessageId,
    direction: row.direction === "inbound" ? "inbound" : "outbound",
    senderType: row.senderType,
    body: row.body,
    occurredAt: row.receivedAt ?? row.sentAt ?? row.createdAt,
    source: "conversation",
    decision: null,
    automatedReply: null,
  };
}

function actionMessageView(row: {
  id: string;
  providerRequestId: string | null;
  sentAt: Date | null;
  dueAt: Date;
  contentSnapshot: unknown;
}): CampaignMessageView {
  const snapshot = record(row.contentSnapshot);
  return {
    id: `outreach:${row.id}`,
    providerMessageId: row.providerRequestId,
    direction: "outbound",
    senderType: "automation",
    body: typeof snapshot.body === "string" ? snapshot.body : "Message envoyé",
    occurredAt: row.sentAt ?? row.dueAt,
    source: "outreach_action",
    decision: null,
    automatedReply: null,
  };
}

function decisionView(row: {
  messageId: string;
  intent: string;
  confidence: string;
  action: string;
  rationale: string;
  metadata: unknown;
  createdAt: Date;
}): CampaignReplyDecisionView {
  const metadata = record(row.metadata);
  return {
    messageId: row.messageId,
    intent: row.intent as InboundReplyIntent,
    confidence: Number(row.confidence),
    action: row.action as CampaignReplyDecisionView["action"],
    rationale: row.rationale,
    provider: typeof metadata.provider === "string" ? metadata.provider : null,
    model: typeof metadata.model === "string" ? metadata.model : null,
    promptVersion: typeof metadata.promptVersion === "string" ? metadata.promptVersion : null,
    createdAt: row.createdAt,
  };
}

function automatedReplyView(row: {
  id: string;
  inboundMessageId: string;
  body: string;
  status: string;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  createdAt: Date;
}): CampaignAutomatedReplyView {
  return {
    id: row.id,
    inboundMessageId: row.inboundMessageId,
    body: row.body,
    status: row.status,
    providerRequestId: row.providerRequestId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}

function latestMessage(
  left: CampaignMessageView | null,
  right: CampaignMessageView | null,
): CampaignMessageView | null {
  if (!left) return right;
  if (!right) return left;
  return left.occurredAt.getTime() >= right.occurredAt.getTime() ? left : right;
}

function withoutMessageAnnotations(message: CampaignMessageView) {
  const { decision: _decision, automatedReply: _automatedReply, ...view } = message;
  return view;
}

function latestDate(values: readonly (Date | null | undefined)[]): Date | null {
  return values.filter((value): value is Date => value instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
