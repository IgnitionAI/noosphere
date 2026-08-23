import type { AiProviderId } from "@outbound/application/ai/model-gateway";
import {
  prospectMemoryCapabilities,
  type ContextReceipt,
  type ProspectContextBundle,
  type ProspectMemoryCapability,
  type ProspectMemoryCurrentState,
  type ProspectMemoryEvent,
  type ProspectMemoryEventKind,
  type ProspectMemorySourceReference,
  type ProspectMemorySnapshot,
} from "@outbound/domain/prospect-memory/prospect-memory";

export const PROSPECT_MEMORY_REFRESH_JOB_TYPE = "prospect.memory.refresh" as const;
export const PROSPECT_MEMORY_BACKFILL_JOB_TYPE = "prospect.memory.backfill" as const;

export interface CaptureProspectMemoryMutationInput {
  readonly workspaceId: string;
  readonly sourceContactId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly kind: ProspectMemoryEventKind;
  readonly occurredAt: Date;
  readonly observedAt: Date;
  readonly validFrom?: Date;
  readonly validTo?: Date | null;
  readonly supersedesEventId?: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
}

export interface CaptureProspectMemoryMutationResult {
  readonly outcome: "disabled" | "contact_missing" | "anonymized" | "duplicate" | "captured";
  readonly eventId: string | null;
  readonly sequenceId: number | null;
  readonly canonicalContactId: string | null;
}

export const prospectMemorySourceMutations = [
  "message.inbound.persisted",
  "message.outbound.persisted",
  "call.persisted",
  "social.interaction.persisted",
  "contact.updated",
  "employment.updated",
  "campaign.membership.changed",
  "prospect.decision.changed",
  "identity.linked",
  "identity.unlinked",
  "contact.anonymized",
] as const;

export type ProspectMemorySourceMutation = (typeof prospectMemorySourceMutations)[number];

export interface ProspectMemoryCoverageRule {
  readonly mutation: ProspectMemorySourceMutation;
  readonly eventKind: ProspectMemoryEventKind;
  readonly semanticEligible: boolean;
  readonly critical: boolean;
}

export const prospectMemoryCoverageMatrix: readonly ProspectMemoryCoverageRule[] = [
  { mutation: "message.inbound.persisted", eventKind: "message_received", semanticEligible: true, critical: true },
  { mutation: "message.outbound.persisted", eventKind: "message_sent", semanticEligible: true, critical: true },
  { mutation: "call.persisted", eventKind: "call_recorded", semanticEligible: true, critical: true },
  { mutation: "social.interaction.persisted", eventKind: "social_interaction", semanticEligible: true, critical: false },
  { mutation: "contact.updated", eventKind: "contact_updated", semanticEligible: false, critical: true },
  { mutation: "employment.updated", eventKind: "employment_updated", semanticEligible: false, critical: false },
  { mutation: "campaign.membership.changed", eventKind: "campaign_changed", semanticEligible: false, critical: true },
  { mutation: "prospect.decision.changed", eventKind: "decision_changed", semanticEligible: false, critical: true },
  { mutation: "identity.linked", eventKind: "identity_linked", semanticEligible: false, critical: true },
  { mutation: "identity.unlinked", eventKind: "identity_unlinked", semanticEligible: false, critical: true },
  { mutation: "contact.anonymized", eventKind: "contact_anonymized", semanticEligible: false, critical: true },
] as const;

export type ProspectMemoryPrincipalRole = "viewer" | "operator" | "admin" | "worker";

export const prospectMemoryCapabilityRoles: Readonly<
  Record<ProspectMemoryCapability, readonly ProspectMemoryPrincipalRole[]>
> = {
  setter_campaign: ["operator", "admin", "worker"],
  draft_improvement: ["operator", "admin", "worker"],
  scoring: ["operator", "admin", "worker"],
  outbound_drafting: ["operator", "admin", "worker"],
  call_preparation: ["viewer", "operator", "admin", "worker"],
  inbound_aggregate: ["viewer", "operator", "admin", "worker"],
};

export interface ProspectMemoryFeatureFlags {
  readonly prospectMemoryCapture: boolean;
  readonly prospectMemoryShadow: boolean;
  readonly prospectMemorySetter: boolean;
  readonly enabledCapabilities: readonly ProspectMemoryCapability[];
}

export const disabledProspectMemoryFeatureFlags: ProspectMemoryFeatureFlags = {
  prospectMemoryCapture: false,
  prospectMemoryShadow: false,
  prospectMemorySetter: false,
  enabledCapabilities: [],
};

export interface ProspectMemoryProcessingProfile {
  readonly provider: AiProviderId;
  readonly encryptedInTransit: true;
  readonly trainingUse: "none";
  readonly providerRetentionDays: number;
  readonly regionOrJurisdiction: string;
  readonly operatorAccessPolicy: string;
  readonly subprocessorsReviewed: true;
  readonly deletionProcedure: string;
  readonly personalDataAllowed: boolean;
  readonly allowedCapabilities: readonly ProspectMemoryCapability[];
  readonly reviewedAt: Date;
}

export interface ProspectMemoryPolicy {
  readonly flags: ProspectMemoryFeatureFlags;
  readonly processingProfiles: readonly ProspectMemoryProcessingProfile[];
  readonly maxDailySemanticRefreshes: number;
  readonly maxDailyCostUsd: number;
}

export interface ProspectMemoryPolicyReader {
  find(workspaceId: string): Promise<ProspectMemoryPolicy>;
}

export interface ProspectMemoryPolicyWriter {
  save(input: {
    readonly workspaceId: string;
    readonly policy: ProspectMemoryPolicy;
    readonly updatedBy: string;
    readonly updatedAt: Date;
  }): Promise<ProspectMemoryPolicy>;
}

export interface ProspectMemoryEventRepository {
  append(input: Omit<ProspectMemoryEvent, "id" | "sequenceId">): Promise<{
    readonly inserted: boolean;
    readonly event: ProspectMemoryEvent;
  }>;
  listAfter(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly sequenceId: number;
    readonly targetSequenceId?: number;
    readonly limit: number;
  }): Promise<readonly ProspectMemoryEvent[]>;
  latestSequence(workspaceId: string, contactId: string): Promise<number>;
  /**
   * Optional privacy-preserving aggregate used by the Inbound capability. The
   * PostgreSQL adapter implements it across the complete durable journal;
   * small in-memory adapters may fall back to the current delta.
   */
  aggregateValidEventKinds?(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly asOf: Date;
  }): Promise<Readonly<Partial<Record<ProspectMemoryEventKind, number>>>>;
}

export interface ProspectMemorySnapshotRepository {
  findCurrent(workspaceId: string, contactId: string): Promise<ProspectMemorySnapshot | null>;
  publishIfCurrent(input: {
    readonly snapshot: ProspectMemorySnapshot;
    readonly expectedVersion: number;
    readonly expectedPrivacyEpoch: number;
  }): Promise<boolean>;
}

export interface ProspectMemoryAuthoritativeState {
  readonly currentState: ProspectMemoryCurrentState;
  readonly privacyEpoch: number;
  readonly anonymizedAt: Date | null;
}

export interface ProspectMemoryAuthoritativeStateReader {
  read(workspaceId: string, contactId: string): Promise<ProspectMemoryAuthoritativeState | null>;
}

export type ProspectMemorySemanticCategory =
  | "confirmed_need"
  | "objection"
  | "commitment"
  | "topic_covered"
  | "do_not_repeat"
  | "open_question";

export interface ProspectMemorySourceMaterial {
  readonly event: ProspectMemoryEvent;
  readonly content: string | null;
  readonly language: string | null;
  readonly sourceHash: string;
}

export interface ProspectMemorySourceMaterialReader {
  read(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly events: readonly ProspectMemoryEvent[];
  }): Promise<readonly ProspectMemorySourceMaterial[]>;
}

export interface ProspectMemorySemanticClassification {
  readonly eventId: string;
  readonly categories: readonly ProspectMemorySemanticCategory[];
}

export interface ProspectMemorySemanticAssertion {
  readonly nature: "hypothesis" | "recommendation";
  readonly statement: string;
  readonly confidence: number;
  readonly sourceEventIds: readonly string[];
  readonly validUntil: Date | null;
}

export interface ProspectMemorySynthesis {
  readonly classifications: readonly ProspectMemorySemanticClassification[];
  readonly assertions: readonly ProspectMemorySemanticAssertion[];
  readonly relationshipSummary: string;
  readonly recommendedTone: string | null;
  readonly contradictions: readonly string[];
  readonly missingInformation: readonly string[];
  readonly provider: AiProviderId | null;
  readonly model: string | null;
}

export interface ProspectMemorySynthesizer {
  synthesize(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly requestKey: string;
    readonly materials: readonly ProspectMemorySourceMaterial[];
    readonly previousSnapshot: ProspectMemorySnapshot | null;
    readonly allowedProviders: readonly AiProviderId[];
    readonly shadow: boolean;
    readonly deadlineAt: Date;
  }): Promise<ProspectMemorySynthesis>;
}

export interface ProspectMemorySemanticBudgetReader {
  readUsage(input: {
    readonly workspaceId: string;
    readonly since: Date;
  }): Promise<{ readonly refreshes: number; readonly costUsd: number }>;
}

export interface ProspectMemoryProjectionInput {
  readonly previousSnapshot: ProspectMemorySnapshot | null;
  readonly resetHistoricalProjection?: boolean;
  readonly currentState: ProspectMemoryCurrentState;
  readonly events: readonly ProspectMemoryEvent[];
  readonly materials: readonly ProspectMemorySourceMaterial[];
  readonly synthesis: ProspectMemorySynthesis;
  readonly generatedAt: Date;
  readonly privacyEpoch: number;
  readonly snapshotId: string;
  readonly contentHash: string;
}

export interface ProspectMemoryProjector {
  project(input: ProspectMemoryProjectionInput): ProspectMemorySnapshot;
}

export interface ProspectMemoryProjectionValidator {
  validate(input: {
    readonly previousSnapshot: ProspectMemorySnapshot | null;
    readonly resetHistoricalProjection?: boolean;
    readonly snapshot: ProspectMemorySnapshot;
    readonly events: readonly ProspectMemoryEvent[];
    readonly materials: readonly ProspectMemorySourceMaterial[];
  }): ProspectMemorySnapshot;
}

export interface ContextReceiptRecorder {
  /**
   * Persists the immutable receipt or returns the already persisted receipt id
   * for the same idempotency key and identical context. A reused request key
   * with different context must fail closed.
   */
  record(receipt: ContextReceipt): Promise<string>;
}

export interface ProspectContextAssembler {
  assemble(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly capability: ProspectMemoryCapability;
    readonly principalRole: ProspectMemoryPrincipalRole;
    readonly requestKey: string;
    readonly now: Date;
  }): Promise<ProspectContextBundle>;
}

export type ProspectMemoryRefreshJobStatus =
  | "pending"
  | "running"
  | "retry"
  | "completed"
  | "dead_lettered";

export interface ProspectMemoryRefreshJobView {
  readonly id: string;
  readonly status: ProspectMemoryRefreshJobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly availableAt: Date;
  readonly lockedUntil: Date | null;
  readonly completedAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProspectMemoryOperationsReader {
  countEventsAfter(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly sequenceId: number;
  }): Promise<number>;
  findLatestRefreshJob(input: {
    readonly workspaceId: string;
    readonly contactId: string;
  }): Promise<ProspectMemoryRefreshJobView | null>;
  findRefreshJobByIdempotencyKey(input: {
    readonly workspaceId: string;
    readonly idempotencyKey: string;
  }): Promise<ProspectMemoryRefreshJobView | null>;
}

export function assertProspectMemoryCoverageMatrix(): void {
  const covered = new Set(prospectMemoryCoverageMatrix.map((rule) => rule.mutation));
  if (covered.size !== prospectMemorySourceMutations.length) {
    throw new Error("PROSPECT_MEMORY_COVERAGE_DUPLICATE");
  }
  for (const mutation of prospectMemorySourceMutations) {
    if (!covered.has(mutation)) throw new Error(`PROSPECT_MEMORY_COVERAGE_MISSING:${mutation}`);
  }
}

export function isProspectMemoryCapabilityAuthorized(
  capability: ProspectMemoryCapability,
  role: ProspectMemoryPrincipalRole,
): boolean {
  return prospectMemoryCapabilityRoles[capability].includes(role);
}

export function isProspectMemoryCapabilityEnabled(
  flags: ProspectMemoryFeatureFlags,
  capability: ProspectMemoryCapability,
): boolean {
  return flags.enabledCapabilities.includes(capability)
    && (capability !== "setter_campaign" || flags.prospectMemorySetter);
}

export function assertProspectMemoryProcessingAllowed(input: {
  readonly policy: ProspectMemoryPolicy;
  readonly provider: AiProviderId;
  readonly capability: ProspectMemoryCapability;
}): ProspectMemoryProcessingProfile {
  const profile = input.policy.processingProfiles.find(
    (candidate) => candidate.provider === input.provider
      && candidate.allowedCapabilities.includes(input.capability),
  );
  if (!profile || !isProspectMemoryProcessingProfileComplete(profile)) {
    throw new Error("PROSPECT_MEMORY_PROCESSING_PROFILE_REQUIRED");
  }
  return profile;
}

export function isProspectMemoryProcessingProfileComplete(
  profile: ProspectMemoryProcessingProfile,
): boolean {
  return profile.personalDataAllowed
    && profile.encryptedInTransit
    && profile.trainingUse === "none"
    && Number.isInteger(profile.providerRetentionDays)
    && profile.providerRetentionDays >= 0
    && profile.regionOrJurisdiction.trim().length > 0
    && profile.operatorAccessPolicy.trim().length > 0
    && profile.subprocessorsReviewed
    && profile.deletionProcedure.trim().length > 0;
}

export function prospectMemoryAllowedProviders(
  policy: ProspectMemoryPolicy,
  capability: ProspectMemoryCapability,
): readonly AiProviderId[] {
  return [...new Set(policy.processingProfiles
    .filter((profile) => isProspectMemoryProcessingProfileComplete(profile)
      && profile.allowedCapabilities.includes(capability))
    .map((profile) => profile.provider))];
}

export async function requireProspectMemoryAllowedProviders(input: {
  readonly policies: ProspectMemoryPolicyReader;
  readonly workspaceId: string;
  readonly capability: ProspectMemoryCapability;
}): Promise<readonly AiProviderId[]> {
  const providers = prospectMemoryAllowedProviders(
    await input.policies.find(input.workspaceId),
    input.capability,
  );
  if (providers.length === 0) throw new Error("PROSPECT_MEMORY_PROCESSING_PROFILE_REQUIRED");
  return providers;
}

export function assertProspectMemoryCapabilityMatrix(): void {
  for (const capability of prospectMemoryCapabilities) {
    const roles = prospectMemoryCapabilityRoles[capability];
    if (roles.length === 0 || !roles.includes("worker")) {
      throw new Error(`PROSPECT_MEMORY_CAPABILITY_ROLE_MISSING:${capability}`);
    }
  }
}
