import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";

export type InboundReplyIntent =
  | "positive"
  | "question"
  | "objection"
  | "not_interested"
  | "unsubscribe"
  | "meeting_request"
  | "other";

export interface InboundReplyDecision {
  readonly intent: InboundReplyIntent;
  readonly confidence: number;
  readonly action: "reply" | "stop" | "booking";
  readonly calendarAction?: "propose_slots" | "book" | "reschedule" | "cancel" | null;
  readonly selectedSlotStart?: string | null;
  readonly replyBody: string | null;
  readonly rationale: string;
  readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly calendarBookingId?: string;
    readonly calendarAction?: "propose_slots" | "book" | "reschedule" | "cancel";
    readonly meetingProposalId?: string;
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
