import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import type { SequenceStepKind } from "@outbound/domain/campaigns/sequence-validation";

export interface OutboundSendRequest {
  readonly accountId: string;
  readonly channel: ProspectingChannel;
  readonly stepKind: SequenceStepKind;
  readonly recipient: {
    readonly value: string;
    readonly normalizedValue: string;
    readonly providerUserId: string | null;
  };
  readonly subject: string | null;
  readonly body: string;
  readonly idempotencyKey: string;
  readonly conversationId?: string | null;
  readonly replyToProviderMessageId?: string | null;
}

export interface OutboundSendResult {
  readonly providerRequestId: string;
  readonly conversationId: string | null;
}

export interface OutboundChannelGateway {
  send(request: OutboundSendRequest): Promise<OutboundSendResult>;
}

export class OutboundDeliveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly deliveryState: "not_sent" | "unknown",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OutboundDeliveryError";
  }
}
