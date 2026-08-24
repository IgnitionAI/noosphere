export type AttributionTouchKind = "identity" | "conversation" | "campaign" | "booking" | "opportunity";
export type AttributionCertainty = "evidence" | "inference" | "unknown";

export interface AttributionTouchView {
  readonly id: string;
  readonly kind: AttributionTouchKind;
  readonly certainty: AttributionCertainty;
  readonly rule: string;
  readonly modelVersion: string;
  readonly confidence: number;
  readonly proofType: string;
  readonly proofRef: string | null;
  readonly proofHref: string | null;
  readonly contactId: string | null;
  readonly contactName: string | null;
  readonly conversationId: string | null;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly bookingId: string | null;
  readonly bookingStartAt: Date | null;
  readonly opportunityId: string | null;
  readonly position: "first" | "last" | "first_and_last" | "middle" | null;
  readonly occurredAt: Date;
}

export interface AttributionJourneyView {
  readonly interaction: {
    readonly id: string;
    readonly type: "comment" | "reply" | "reaction" | "mention";
    readonly actorName: string | null;
    readonly actorProfileUrl: string | null;
    readonly body: string | null;
    readonly reaction: string | null;
    readonly occurredAt: Date;
  };
  readonly source: {
    readonly socialContentId: string;
    readonly publicationId: string | null;
    readonly text: string;
    readonly url: string | null;
  };
  readonly resolution: "resolved" | "ambiguous" | "unknown" | "excluded";
  readonly touches: readonly AttributionTouchView[];
}

export interface AttributionRepository {
  reconcile(input: { readonly workspaceId?: string; readonly now: Date; readonly limit: number }): Promise<number>;
  listJourneys(input: {
    readonly workspaceId: string;
    readonly cursor?: string;
    readonly limit: number;
    readonly interactionId?: string;
    readonly bookingId?: string;
  }): Promise<{ readonly data: readonly AttributionJourneyView[]; readonly nextCursor: string | null }>;
}

export class AttributionApplication {
  constructor(private readonly repository: AttributionRepository) {}

  listJourneys(input: Parameters<AttributionRepository["listJourneys"]>[0]) {
    return this.repository.listJourneys(input);
  }
}

export class AttributionReconciler {
  constructor(
    private readonly repository: AttributionRepository,
    private readonly options: { readonly now?: () => Date; readonly limit?: number } = {},
  ) {}

  reconcile(workspaceId?: string): Promise<number> {
    return this.repository.reconcile({
      ...(workspaceId ? { workspaceId } : {}),
      now: this.options.now?.() ?? new Date(),
      limit: Math.min(500, Math.max(1, this.options.limit ?? 100)),
    });
  }
}
