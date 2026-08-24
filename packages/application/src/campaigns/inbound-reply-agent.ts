import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import type { AiProviderId } from "@outbound/application/ai/model-gateway";

export type InboundReplyIntent =
  | "positive"
  | "question"
  | "objection"
  | "not_now"
  | "wrong_person"
  | "referral"
  | "not_interested"
  | "unsubscribe"
  | "out_of_office"
  | "bounce"
  | "auto_reply"
  | "meeting_request"
  | "other";

export interface InboundReplyDecision {
  readonly intent: InboundReplyIntent;
  readonly confidence: number;
  readonly action: "reply" | "stop" | "booking" | "wait" | "handoff";
  readonly evidence?: readonly string[];
  readonly resumeAt?: string | null;
  readonly referredPerson?: string | null;
  readonly requiresHuman?: boolean;
  readonly suggestedNextAction?: string | null;
  readonly calendarAction?: "propose_slots" | "book" | "reschedule" | "cancel" | null;
  readonly selectedSlotStart?: string | null;
  readonly replyBody: string | null;
  readonly rationale: string;
    readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly aiConfigurationId?: string;
    readonly promptVersionId?: string;
    readonly aiRunId?: string;
    readonly calendarBookingId?: string;
    readonly calendarAction?: "propose_slots" | "book" | "reschedule" | "cancel";
    readonly meetingProposalId?: string;
    readonly knowledgeClaimIds?: readonly string[];
    readonly knowledgeSourceIds?: readonly string[];
    readonly memoryReceiptId?: string;
    readonly memorySnapshotId?: string | null;
    readonly memorySnapshotVersion?: number | null;
    readonly memoryWatermark?: number;
  };
}

export interface InboundReplyAgent {
  decide(input: {
    readonly workspaceId: string;
    readonly channel: ProspectingChannel;
    readonly contactName: string;
    readonly companyName: string | null;
    readonly icpName: string | null;
    readonly incomingMessage: string;
    readonly conversationHistory: readonly {
      readonly direction: "inbound" | "outbound";
      readonly body: string;
    }[];
    /** Compiled server-side Prospect 360 context. Never supplied by a client. */
    readonly prospectContext?: Readonly<Record<string, unknown>>;
    /** Audit reference for the server-assembled context. Never supplied by a client or used as model authority. */
    readonly prospectContextReference?: Readonly<{
      receiptId: string;
      snapshotId: string | null;
      snapshotVersion: number | null;
      watermark: number;
      privacyEpoch: number;
      mode: "shadow" | "active";
    }>;
    /** Provider policy resolved server-side before personal context is handed to a model. */
    readonly prospectContextAllowedProviders?: readonly AiProviderId[];
    readonly instructions: string | null;
    readonly bookingUrl: string | null;
    readonly calendar?: {
      readonly status: "ready" | "link_only" | "email_required" | "unavailable";
      readonly timeZone: string;
      readonly canBook: boolean;
      readonly slots: readonly {
        readonly start: string;
        readonly end: string | null;
        readonly label: string;
      }[];
      readonly activeBooking?: {
        readonly bookingId: string;
        readonly start: string;
        readonly label: string;
      };
    };
  }): Promise<InboundReplyDecision>;
}
