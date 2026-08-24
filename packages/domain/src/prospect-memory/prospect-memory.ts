export const PROSPECT_MEMORY_EVENT_SCHEMA_VERSION = 1 as const;
export const PROSPECT_MEMORY_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const PROSPECT_MEMORY_RENDERER_VERSION = 1 as const;

export const prospectMemoryEventKinds = [
  "message_received",
  "message_sent",
  "call_recorded",
  "social_interaction",
  "contact_updated",
  "employment_updated",
  "campaign_changed",
  "decision_changed",
  "identity_linked",
  "identity_unlinked",
  "contact_anonymized",
] as const;

export type ProspectMemoryEventKind = (typeof prospectMemoryEventKinds)[number];

export const prospectMemoryCapabilities = [
  "setter_campaign",
  "draft_improvement",
  "scoring",
  "outbound_drafting",
  "call_preparation",
  "inbound_aggregate",
] as const;

export type ProspectMemoryCapability = (typeof prospectMemoryCapabilities)[number];

export const prospectMemoryStatuses = [
  "fresh",
  "refreshing",
  "stale",
  "budget_blocked",
  "failed",
  "anonymized",
] as const;

export type ProspectMemoryStatus = (typeof prospectMemoryStatuses)[number];

export type ProspectMemoryAssertionNature = "hypothesis" | "recommendation";
export type ProspectMemorySourceAuthority = "deterministic" | "model";

export interface ProspectMemorySourceReference {
  readonly eventId: string;
  readonly sequenceId: number;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly excerpt: string | null;
  /** Optional for backward compatibility with N-1 snapshots. */
  readonly validFrom?: string;
  /** Optional for backward compatibility with N-1 snapshots. */
  readonly validTo?: string | null;
}

export interface ProspectMemoryEvent {
  readonly id: string;
  readonly sequenceId: number;
  readonly workspaceId: string;
  readonly sourceContactId: string;
  readonly canonicalContactId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly kind: ProspectMemoryEventKind;
  readonly occurredAt: Date;
  readonly observedAt: Date;
  readonly validFrom: Date;
  readonly validTo: Date | null;
  readonly supersedesEventId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly schemaVersion: typeof PROSPECT_MEMORY_EVENT_SCHEMA_VERSION;
}

export interface ProspectMemoryAssertion {
  readonly id: string;
  readonly nature: ProspectMemoryAssertionNature;
  readonly statement: string;
  readonly confidence: number;
  readonly sources: readonly ProspectMemorySourceReference[];
  readonly validUntil: Date | null;
  readonly status: "active" | "superseded" | "expired";
}

export interface ProspectMemoryCurrentState {
  readonly displayName: string | null;
  readonly companyName: string | null;
  readonly jobTitle: string | null;
  readonly locale: string | null;
  readonly availableChannels: readonly ("linkedin" | "email" | "whatsapp")[];
  readonly suppressed: boolean;
  readonly anonymized: boolean;
  readonly activeCampaignIds: readonly string[];
  readonly activeDecisionId: string | null;
}

export interface ProspectMemoryCommercialState {
  readonly confirmedNeeds: readonly ProspectMemorySourceReference[];
  readonly objections: readonly ProspectMemorySourceReference[];
  readonly commitments: readonly ProspectMemorySourceReference[];
  readonly topicsCovered: readonly ProspectMemorySourceReference[];
  readonly doNotRepeat: readonly ProspectMemorySourceReference[];
  readonly openQuestions: readonly ProspectMemorySourceReference[];
}

export interface ProspectMemorySnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly version: number;
  readonly watermark: number;
  readonly firstSequenceId: number;
  readonly privacyEpoch: number;
  readonly status: ProspectMemoryStatus;
  readonly currentState: ProspectMemoryCurrentState;
  readonly commercialState: ProspectMemoryCommercialState;
  readonly assertions: readonly ProspectMemoryAssertion[];
  readonly relationshipSummary: string;
  readonly recommendedTone: string | null;
  readonly contradictions: readonly string[];
  readonly missingInformation: readonly string[];
  readonly modelProvider: string | null;
  readonly model: string | null;
  readonly promptVersion: string;
  readonly policyVersion: string;
  readonly schemaVersion: typeof PROSPECT_MEMORY_SNAPSHOT_SCHEMA_VERSION;
  readonly rendererVersion: typeof PROSPECT_MEMORY_RENDERER_VERSION;
  readonly contentHash: string;
  readonly generatedAt: Date;
}

export interface ProspectContextBundle {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly capability: ProspectMemoryCapability;
  readonly mode: "shadow" | "active";
  readonly status: ProspectMemoryStatus;
  readonly snapshotId: string | null;
  readonly snapshotVersion: number | null;
  readonly receiptId: string;
  readonly watermark: number;
  readonly privacyEpoch: number;
  readonly assembledAt: Date;
  readonly currentState: ProspectMemoryCurrentState;
  readonly activeDecisionId: string | null;
  readonly context: Readonly<Record<string, unknown>>;
  readonly sourceEventIds: readonly string[];
  readonly excludedSourceEventIds: readonly string[];
  readonly estimatedTokens: number;
  readonly automaticActionAllowed: boolean;
  readonly waitCode: "WAIT_MEMORY_STALE" | "WAIT_MEMORY_BUDGET" | null;
}

export interface ContextReceipt {
  readonly id: string;
  readonly requestKey: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly capability: ProspectMemoryCapability;
  readonly snapshotId: string | null;
  readonly snapshotVersion: number | null;
  readonly watermark: number;
  readonly privacyEpoch: number;
  readonly rendererVersion: typeof PROSPECT_MEMORY_RENDERER_VERSION;
  readonly sourceEventIds: readonly string[];
  readonly sourceHashes: readonly string[];
  readonly excludedSourceEventIds: readonly string[];
  readonly normalizedRetrievalQueries: readonly string[];
  readonly estimatedInputTokens: number;
  readonly contextHash: string;
  readonly createdAt: Date;
}

export const prospectMemoryStatusTransitions: Readonly<
  Record<ProspectMemoryStatus, readonly ProspectMemoryStatus[]>
> = {
  fresh: ["refreshing", "stale", "anonymized"],
  refreshing: ["fresh", "stale", "budget_blocked", "failed", "anonymized"],
  stale: ["refreshing", "budget_blocked", "failed", "anonymized"],
  budget_blocked: ["refreshing", "stale", "anonymized"],
  failed: ["refreshing", "stale", "anonymized"],
  anonymized: [],
};

export function canTransitionProspectMemoryStatus(
  from: ProspectMemoryStatus,
  to: ProspectMemoryStatus,
): boolean {
  return from === to || prospectMemoryStatusTransitions[from].includes(to);
}

export function assertProspectMemoryEvent(event: ProspectMemoryEvent): ProspectMemoryEvent {
  if (!Number.isSafeInteger(event.sequenceId) || event.sequenceId < 1) {
    throw new Error("PROSPECT_MEMORY_SEQUENCE_INVALID");
  }
  if (!Number.isInteger(event.sourceVersion) || event.sourceVersion < 1) {
    throw new Error("PROSPECT_MEMORY_SOURCE_VERSION_INVALID");
  }
  if (event.schemaVersion !== PROSPECT_MEMORY_EVENT_SCHEMA_VERSION) {
    throw new Error("PROSPECT_MEMORY_EVENT_SCHEMA_UNSUPPORTED");
  }
  if (event.validTo && event.validTo <= event.validFrom) {
    throw new Error("PROSPECT_MEMORY_VALIDITY_INVALID");
  }
  if (event.validFrom > event.observedAt) {
    // A future-valid event would be skipped by a refresh whose watermark then
    // advances past it. Future scheduling needs a dedicated durable primitive;
    // V1 therefore rejects it instead of silently losing the event later.
    throw new Error("PROSPECT_MEMORY_FUTURE_VALIDITY_UNSUPPORTED");
  }
  return event;
}

export function isProspectMemoryEventValidAt(
  event: Pick<ProspectMemoryEvent, "validFrom" | "validTo">,
  at: Date,
): boolean {
  return event.validFrom <= at && (!event.validTo || event.validTo > at);
}

export function isProspectMemorySourceReferenceValidAt(
  reference: Pick<ProspectMemorySourceReference, "validFrom" | "validTo">,
  at: Date,
): boolean {
  const validFrom = reference.validFrom === undefined
    ? Number.NEGATIVE_INFINITY
    : Date.parse(reference.validFrom);
  const validTo = reference.validTo === undefined || reference.validTo === null
    ? Number.POSITIVE_INFINITY
    : Date.parse(reference.validTo);
  return !Number.isNaN(validFrom)
    && !Number.isNaN(validTo)
    && validFrom <= at.getTime()
    && validTo > at.getTime();
}

export function assertProspectMemoryAssertion(
  assertion: ProspectMemoryAssertion,
): ProspectMemoryAssertion {
  if (!assertion.statement.trim()) throw new Error("PROSPECT_MEMORY_ASSERTION_EMPTY");
  if (assertion.confidence < 0 || assertion.confidence > 1) {
    throw new Error("PROSPECT_MEMORY_ASSERTION_CONFIDENCE_INVALID");
  }
  if (assertion.sources.length === 0) {
    throw new Error("PROSPECT_MEMORY_ASSERTION_SOURCE_REQUIRED");
  }
  for (const source of assertion.sources) {
    if (!Number.isSafeInteger(source.sequenceId) || source.sequenceId < 1) {
      throw new Error("PROSPECT_MEMORY_ASSERTION_SOURCE_INVALID");
    }
  }
  return assertion;
}

export function isProspectMemoryUsableForAutomaticAction(input: {
  readonly status: ProspectMemoryStatus;
  readonly generatedAt: Date | null;
  readonly now: Date;
  readonly deltaEventCount: number;
  readonly deltaOldestOccurredAt: Date | null;
  readonly contextBudgetExceeded: boolean;
  readonly maxSnapshotAgeMs?: number;
  readonly maxDeltaEvents?: number;
  readonly maxDeltaAgeMs?: number;
}): { readonly allowed: boolean; readonly waitCode: ProspectContextBundle["waitCode"] } {
  if (input.contextBudgetExceeded || input.status === "budget_blocked") {
    return { allowed: false, waitCode: "WAIT_MEMORY_BUDGET" };
  }
  const maxSnapshotAgeMs = input.maxSnapshotAgeMs ?? 24 * 60 * 60 * 1_000;
  const maxDeltaEvents = input.maxDeltaEvents ?? 200;
  const maxDeltaAgeMs = input.maxDeltaAgeMs ?? 7 * 24 * 60 * 60 * 1_000;
  const snapshotExpired = !input.generatedAt
    || input.now.getTime() - input.generatedAt.getTime() > maxSnapshotAgeMs;
  const deltaExpired = input.deltaOldestOccurredAt
    ? input.now.getTime() - input.deltaOldestOccurredAt.getTime() > maxDeltaAgeMs
    : false;
  if (
    input.status !== "fresh"
    || snapshotExpired
    || input.deltaEventCount > maxDeltaEvents
    || deltaExpired
  ) {
    return { allowed: false, waitCode: "WAIT_MEMORY_STALE" };
  }
  return { allowed: true, waitCode: null };
}
