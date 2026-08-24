import type { InboundReplyIntent } from "./inbound-reply-agent";

export type ProspectEngagementState =
  | "not_contacted"
  | "sent"
  | "replied"
  | "qualified"
  | "refused"
  | "meeting";

export interface CampaignEngagementMetrics {
  readonly targeted: number;
  readonly contacted: number;
  readonly replies: number;
  readonly hot: number;
  readonly meetings: number;
}

export interface CampaignReplyDecisionView {
  readonly messageId: string;
  readonly intent: InboundReplyIntent;
  readonly confidence: number;
  readonly action: "reply" | "stop" | "booking";
  readonly rationale: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly createdAt: Date;
}

export interface CampaignAutomatedReplyView {
  readonly id: string;
  readonly inboundMessageId: string;
  readonly body: string;
  readonly status: string;
  readonly providerRequestId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
}

export interface CampaignMessageView {
  readonly id: string;
  readonly providerMessageId: string | null;
  readonly direction: "inbound" | "outbound";
  readonly senderType: string;
  readonly body: string;
  readonly occurredAt: Date;
  readonly source: "conversation" | "outreach_action";
  readonly decision: CampaignReplyDecisionView | null;
  readonly automatedReply: CampaignAutomatedReplyView | null;
}

export interface CampaignProspectEngagementView {
  readonly campaignId: string;
  readonly candidateId: string;
  readonly contactId: string | null;
  readonly conversationId: string | null;
  readonly fullName: string;
  readonly headline: string | null;
  readonly companyName: string | null;
  readonly score: number | null;
  readonly eligible: boolean;
  readonly state: ProspectEngagementState;
  readonly lastMessage: Omit<CampaignMessageView, "decision" | "automatedReply"> | null;
  readonly lastActivityAt: Date;
  readonly decision: CampaignReplyDecisionView | null;
  readonly automatedReply: CampaignAutomatedReplyView | null;
  readonly enrollment: {
    readonly status: string;
    readonly suspensionReason: string | null;
    readonly suspendedAt: Date | null;
  } | null;
  readonly sentCount: number;
  readonly pendingFollowUps: number;
  readonly cancelledFollowUps: number;
  readonly relaunchesCancelled: boolean;
  readonly opportunity: {
    readonly stage: string;
    readonly nextAction: string | null;
  } | null;
}

export interface CampaignEngagementOverview {
  readonly campaignId: string;
  readonly metrics: CampaignEngagementMetrics;
  readonly prospects: readonly CampaignProspectEngagementView[];
}

export interface CampaignConversationDetail {
  readonly campaignId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly candidateId: string | null;
  readonly fullName: string;
  readonly headline: string | null;
  readonly companyName: string | null;
  readonly channel: "linkedin" | "email" | "whatsapp";
  readonly status: string;
  readonly lastMessageAt: Date;
  readonly messages: readonly CampaignMessageView[];
  readonly decision: CampaignReplyDecisionView | null;
  readonly automatedReply: CampaignAutomatedReplyView | null;
  readonly enrollment: CampaignProspectEngagementView["enrollment"];
  readonly pendingFollowUps: number;
  readonly cancelledFollowUps: number;
  readonly relaunchesCancelled: boolean;
  readonly opportunity: CampaignProspectEngagementView["opportunity"];
  readonly meeting: {
    readonly status: string;
    readonly timeZone: string | null;
    readonly proposedSlots: readonly {
      readonly position: number;
      readonly start: string;
      readonly label: string;
    }[];
    readonly selectedSlotStart: Date | null;
    readonly bookedStartAt: Date | null;
    readonly meetingUrl: string | null;
  } | null;
}

export interface ProspectEngagementSignals {
  readonly sent: boolean;
  readonly replied: boolean;
  readonly intent: InboundReplyIntent | null;
  readonly action: "reply" | "stop" | "booking" | null;
  readonly opportunityStage: string | null;
}

export function deriveProspectEngagementState(
  signals: ProspectEngagementSignals,
): ProspectEngagementState {
  if (signals.action === "booking" || signals.opportunityStage?.startsWith("meeting")) {
    return "meeting";
  }
  if (
    signals.action === "stop"
    || signals.intent === "not_interested"
    || signals.intent === "unsubscribe"
  ) {
    return "refused";
  }
  if (signals.intent === "positive" || signals.opportunityStage === "qualified") {
    return "qualified";
  }
  if (signals.replied) return "replied";
  if (signals.sent) return "sent";
  return "not_contacted";
}

export function isHotProspectState(state: ProspectEngagementState): boolean {
  return state === "qualified" || state === "meeting";
}

export function isActionableCampaignException(input: {
  readonly automationStage: string;
  readonly automationErrorCode: string | null;
}): boolean {
  return input.automationStage === "attention"
    && input.automationErrorCode !== "NO_PROSPECTS_FOUND";
}
