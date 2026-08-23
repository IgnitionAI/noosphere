import type { JobQueue } from "@outbound/application/jobs/job-queue";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import type {
  ProspectContextBundle,
  ProspectMemoryCapability,
  ProspectMemorySourceReference,
  ProspectMemorySnapshot,
  ProspectMemoryStatus,
} from "@outbound/domain/prospect-memory/prospect-memory";
import { isProspectMemorySourceReferenceValidAt } from "@outbound/domain/prospect-memory/prospect-memory";
import type { AiProviderId } from "@outbound/application/ai/model-gateway";
import {
  PROSPECT_MEMORY_REFRESH_JOB_TYPE,
  isProspectMemoryProcessingProfileComplete,
  isProspectMemoryCapabilityEnabled,
  type ProspectContextAssembler,
  type ProspectMemoryAuthoritativeStateReader,
  type ProspectMemoryEventRepository,
  type ProspectMemoryOperationsReader,
  type ProspectMemoryPolicyReader,
  type ProspectMemoryPolicyWriter,
  type ProspectMemoryPrincipalRole,
  type ProspectMemoryRefreshJobView,
  type ProspectMemorySnapshotRepository,
} from "./prospect-memory";

export interface ProspectMemorySettingsUpdate {
  readonly captureEnabled: boolean;
  readonly shadowEnabled: boolean;
  readonly setterEnabled: boolean;
  readonly enabledCapabilities: readonly ProspectMemoryCapability[];
  readonly processingProfiles: readonly {
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
  }[];
  readonly maxDailySemanticRefreshes: number;
  readonly maxDailyCostUsd: number;
}

export interface ProspectMemoryStatusView {
  readonly enabled: boolean;
  readonly mode: "disabled" | "shadow" | "active";
  readonly status: ProspectMemoryStatus;
  readonly snapshotId: string | null;
  readonly snapshotVersion: number | null;
  readonly generatedAt: Date | null;
  readonly watermark: number;
  readonly latestSequence: number;
  readonly pendingEventCount: number;
  readonly privacyEpoch: number;
  readonly job: ProspectMemoryRefreshJobView | null;
  /** Refreshing memory is a read/compute operation and never sends a provider message. */
  readonly sentEffect: false;
  readonly asOf: Date;
}

export interface ProspectMemoryPublicSourceView {
  readonly eventId: string;
  readonly sourceKind: string;
  readonly excerpt: string | null;
}

export interface ProspectMemoryPublicAssertionView {
  readonly id: string;
  readonly nature: "hypothesis" | "recommendation";
  readonly statement: string;
  readonly confidence: number;
  readonly sources: readonly ProspectMemoryPublicSourceView[];
  readonly validUntil: Date | null;
}

export interface ProspectMemoryPublicView {
  readonly capability: ProspectMemoryCapability;
  readonly mode: "shadow" | "active";
  readonly status: ProspectMemoryStatus;
  readonly snapshotId: string | null;
  readonly snapshotVersion: number | null;
  readonly generatedAt: Date | null;
  readonly relationshipSummary: string | null;
  readonly recommendedTone: string | null;
  readonly facts: Readonly<{
    confirmedNeeds: readonly ProspectMemoryPublicSourceView[];
    objections: readonly ProspectMemoryPublicSourceView[];
    commitments: readonly ProspectMemoryPublicSourceView[];
    topicsCovered: readonly ProspectMemoryPublicSourceView[];
    doNotRepeat: readonly ProspectMemoryPublicSourceView[];
    openQuestions: readonly ProspectMemoryPublicSourceView[];
  }>;
  readonly hypotheses: readonly ProspectMemoryPublicAssertionView[];
  readonly recommendations: readonly ProspectMemoryPublicAssertionView[];
  readonly contradictions: readonly string[];
  readonly missingInformation: readonly string[];
  readonly automaticActionAllowed: boolean;
  readonly waitCode: ProspectContextBundle["waitCode"];
  readonly sourceCount: number;
  readonly excludedSourceCount: number;
  readonly estimatedTokens: number;
  readonly sentEffect: false;
  readonly asOf: Date;
}

export class ProspectMemoryOperationsApplication {
  constructor(
    private readonly events: ProspectMemoryEventRepository,
    private readonly snapshots: ProspectMemorySnapshotRepository,
    private readonly authoritativeState: ProspectMemoryAuthoritativeStateReader,
    private readonly policies: ProspectMemoryPolicyReader & ProspectMemoryPolicyWriter,
    private readonly operations: ProspectMemoryOperationsReader,
    private readonly assembler: ProspectContextAssembler,
    private readonly queue: JobQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async settings(workspaceId: string) {
    return this.policies.find(workspaceId);
  }

  async updateSettings(input: {
    readonly workspaceId: string;
    readonly updatedBy: string;
    readonly update: ProspectMemorySettingsUpdate;
  }) {
    validateSettingsUpdate(input.update);
    const now = this.clock.now();
    return this.policies.save({
      workspaceId: input.workspaceId,
      updatedBy: input.updatedBy,
      updatedAt: now,
      policy: {
        flags: {
          prospectMemoryCapture: input.update.captureEnabled,
          prospectMemoryShadow: input.update.shadowEnabled,
          prospectMemorySetter: input.update.setterEnabled,
          enabledCapabilities: [...new Set(input.update.enabledCapabilities)],
        },
        processingProfiles: input.update.processingProfiles.map((profile) => ({
          ...profile,
          allowedCapabilities: [...new Set(profile.allowedCapabilities)],
          reviewedAt: now,
        })),
        maxDailySemanticRefreshes: input.update.maxDailySemanticRefreshes,
        maxDailyCostUsd: input.update.maxDailyCostUsd,
      },
    });
  }

  async status(workspaceId: string, contactId: string): Promise<ProspectMemoryStatusView> {
    const asOf = this.clock.now();
    const [state, snapshot, latestSequence, policy, job] = await Promise.all([
      this.authoritativeState.read(workspaceId, contactId),
      this.snapshots.findCurrent(workspaceId, contactId),
      this.events.latestSequence(workspaceId, contactId),
      this.policies.find(workspaceId),
      this.operations.findLatestRefreshJob({ workspaceId, contactId }),
    ]);
    if (!state) throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_CONTACT_NOT_FOUND", 404);
    const watermark = snapshot?.watermark ?? 0;
    const pendingEventCount = await this.operations.countEventsAfter({ workspaceId, contactId, sequenceId: watermark });
    const enabled = policy.flags.prospectMemoryCapture;
    const mode = !enabled
      ? "disabled"
      : policy.flags.prospectMemoryShadow
        ? "shadow"
        : "active";
    return {
      enabled,
      mode,
      status: deriveStatus({
        stateAnonymized: state.currentState.anonymized,
        snapshotStatus: snapshot?.status ?? null,
        generatedAt: snapshot?.generatedAt ?? null,
        pendingEventCount,
        job,
        snapshotTemporalStale: snapshotHasNonCurrentSources(snapshot, asOf),
        now: asOf,
      }),
      snapshotId: snapshot?.id ?? null,
      snapshotVersion: snapshot?.version ?? null,
      generatedAt: snapshot?.generatedAt ?? null,
      watermark,
      latestSequence,
      pendingEventCount,
      privacyEpoch: state.privacyEpoch,
      job,
      sentEffect: false,
      asOf,
    };
  }

  async view(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly capability: ProspectMemoryCapability;
    readonly principalRole: ProspectMemoryPrincipalRole;
    readonly requestKey: string;
  }): Promise<ProspectMemoryPublicView> {
    const asOf = this.clock.now();
    const bundle = await this.assembler.assemble({ ...input, now: asOf });
    const snapshot = await this.snapshots.findCurrent(input.workspaceId, input.contactId);
    if (bundle.snapshotId !== (snapshot?.id ?? null)) {
      // Never combine a context receipt from one snapshot with public facts
      // from another snapshot if a refresh committed between both reads.
      throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_VIEW_CHANGED", 409);
    }
    const source = (reference: {
      readonly eventId: string;
      readonly sourceKind: string;
      readonly excerpt: string | null;
    }): ProspectMemoryPublicSourceView => ({
      eventId: reference.eventId,
      sourceKind: reference.sourceKind,
      excerpt: reference.excerpt,
    });
    const assertion = (value: NonNullable<typeof snapshot>["assertions"][number]): ProspectMemoryPublicAssertionView => ({
      id: value.id,
      nature: value.nature,
      statement: value.statement,
      confidence: value.confidence,
      sources: value.sources
        .filter((reference) => isProspectMemorySourceReferenceValidAt(reference, asOf))
        .map(source),
      validUntil: value.validUntil,
    });
    const activeAssertions = snapshot?.assertions.filter((value) =>
      value.status === "active"
      && (!value.validUntil || value.validUntil > asOf)
      && value.sources.every((reference) => isProspectMemorySourceReferenceValidAt(reference, asOf))) ?? [];
    const currentSources = (references: readonly ProspectMemorySourceReference[]) =>
      references
        .filter((reference) => isProspectMemorySourceReferenceValidAt(reference, asOf))
        .map(source);
    const semanticSnapshotTrusted = bundle.waitCode !== "WAIT_MEMORY_STALE";
    return {
      capability: input.capability,
      mode: bundle.mode,
      status: bundle.status,
      snapshotId: bundle.snapshotId,
      snapshotVersion: bundle.snapshotVersion,
      generatedAt: snapshot?.generatedAt ?? null,
      relationshipSummary: semanticSnapshotTrusted ? snapshot?.relationshipSummary ?? null : null,
      recommendedTone: semanticSnapshotTrusted ? snapshot?.recommendedTone ?? null : null,
      facts: {
        confirmedNeeds: currentSources(snapshot?.commercialState.confirmedNeeds ?? []),
        objections: currentSources(snapshot?.commercialState.objections ?? []),
        commitments: currentSources(snapshot?.commercialState.commitments ?? []),
        topicsCovered: currentSources(snapshot?.commercialState.topicsCovered ?? []),
        doNotRepeat: currentSources(snapshot?.commercialState.doNotRepeat ?? []),
        openQuestions: currentSources(snapshot?.commercialState.openQuestions ?? []),
      },
      hypotheses: activeAssertions.filter((value) => value.nature === "hypothesis").map(assertion),
      recommendations: activeAssertions.filter((value) => value.nature === "recommendation").map(assertion),
      contradictions: semanticSnapshotTrusted ? snapshot?.contradictions ?? [] : [],
      missingInformation: semanticSnapshotTrusted ? snapshot?.missingInformation ?? [] : [],
      automaticActionAllowed: bundle.automaticActionAllowed,
      waitCode: bundle.waitCode,
      sourceCount: bundle.sourceEventIds.length,
      excludedSourceCount: bundle.excludedSourceEventIds.length,
      estimatedTokens: bundle.estimatedTokens,
      sentEffect: false,
      asOf,
    };
  }

  async refresh(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly requestKey: string;
    readonly correlationId: string;
  }): Promise<{ readonly inserted: boolean; readonly job: ProspectMemoryRefreshJobView | null; readonly sentEffect: false }> {
    const now = this.clock.now();
    const [state, latestSequence, policy] = await Promise.all([
      this.authoritativeState.read(input.workspaceId, input.contactId),
      this.events.latestSequence(input.workspaceId, input.contactId),
      this.policies.find(input.workspaceId),
    ]);
    if (!state) throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_CONTACT_NOT_FOUND", 404);
    if (state.currentState.anonymized) throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_CONTACT_ANONYMIZED", 409);
    if (!policy.flags.prospectMemoryCapture) throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_DISABLED", 409);
    if (latestSequence < 1) throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_NO_EVENTS", 409);
    const idempotencyKey = `prospect-memory:manual:${input.contactId}:${input.requestKey}`;
    const inserted = await this.queue.enqueue({
      id: this.ids.generate(),
      workspaceId: input.workspaceId,
      type: PROSPECT_MEMORY_REFRESH_JOB_TYPE,
      payload: {
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        targetSequenceId: latestSequence,
        privacyEpoch: state.privacyEpoch,
      },
      idempotencyKey,
      correlationId: input.correlationId,
      maxAttempts: 3,
      priority: 10,
      availableAt: now,
    });
    return {
      inserted: inserted.inserted,
      job: await this.operations.findRefreshJobByIdempotencyKey({
        workspaceId: input.workspaceId,
        idempotencyKey,
      }),
      sentEffect: false,
    };
  }
}

export class ProspectMemoryOperationsError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "ProspectMemoryOperationsError";
  }
}

function validateSettingsUpdate(update: ProspectMemorySettingsUpdate): void {
  if (!update.captureEnabled && (
    update.shadowEnabled
    || update.setterEnabled
    || update.enabledCapabilities.length > 0
  )) {
    throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_SETTINGS_INCONSISTENT", 422);
  }
  if (update.shadowEnabled && update.setterEnabled) {
    throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_SHADOW_CANNOT_SEND", 422);
  }
  const setterSelected = update.enabledCapabilities.includes("setter_campaign");
  if (update.setterEnabled !== setterSelected && !update.shadowEnabled) {
    throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_SETTER_FLAG_MISMATCH", 422);
  }
  if (!Number.isSafeInteger(update.maxDailySemanticRefreshes) || update.maxDailySemanticRefreshes < 0) {
    throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_BUDGET_INVALID", 422);
  }
  if (!Number.isFinite(update.maxDailyCostUsd) || update.maxDailyCostUsd < 0) {
    throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_BUDGET_INVALID", 422);
  }
  const providers = update.processingProfiles.map((profile) => profile.provider);
  if (new Set(providers).size !== providers.length) {
    throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_PROCESSING_PROFILE_DUPLICATE", 422);
  }
  if (!update.captureEnabled) return;
  const requiredCapabilities = update.enabledCapabilities.length > 0
    ? update.enabledCapabilities
    : ["setter_campaign" as const];
  const approved = update.processingProfiles.some((profile) =>
    isProspectMemoryProcessingProfileComplete({ ...profile, reviewedAt: new Date(0) })
    && requiredCapabilities.every((capability) => profile.allowedCapabilities.includes(capability)));
  if (!approved) {
    throw new ProspectMemoryOperationsError("PROSPECT_MEMORY_PROCESSING_PROFILE_REQUIRED", 422);
  }
}

function deriveStatus(input: {
  readonly stateAnonymized: boolean;
  readonly snapshotStatus: ProspectMemoryStatus | null;
  readonly generatedAt: Date | null;
  readonly pendingEventCount: number;
  readonly job: ProspectMemoryRefreshJobView | null;
  readonly snapshotTemporalStale: boolean;
  readonly now: Date;
}): ProspectMemoryStatus {
  if (input.stateAnonymized) return "anonymized";
  if (input.job?.lastErrorCode === "PROSPECT_MEMORY_BUDGET_BLOCKED" && input.job.status !== "completed") {
    return "budget_blocked";
  }
  if (input.job?.status === "dead_lettered") return "failed";
  if (input.job && ["pending", "running", "retry"].includes(input.job.status)) return "refreshing";
  if (!input.generatedAt || input.pendingEventCount > 0 || input.snapshotTemporalStale) return "stale";
  if (input.now.getTime() - input.generatedAt.getTime() > 24 * 60 * 60 * 1_000) return "stale";
  return input.snapshotStatus ?? "stale";
}

function snapshotHasNonCurrentSources(snapshot: ProspectMemorySnapshot | null, asOf: Date): boolean {
  if (!snapshot) return false;
  const references = [
    ...snapshot.commercialState.confirmedNeeds,
    ...snapshot.commercialState.objections,
    ...snapshot.commercialState.commitments,
    ...snapshot.commercialState.topicsCovered,
    ...snapshot.commercialState.doNotRepeat,
    ...snapshot.commercialState.openQuestions,
  ];
  return references.some((reference) => !isProspectMemorySourceReferenceValidAt(reference, asOf))
    || snapshot.assertions.some((assertion) =>
      assertion.status !== "active"
      || Boolean(assertion.validUntil && assertion.validUntil <= asOf)
      || assertion.sources.some((reference) => !isProspectMemorySourceReferenceValidAt(reference, asOf)));
}

export function prospectMemoryModeForCapability(input: {
  readonly enabled: boolean;
  readonly shadow: boolean;
  readonly setter: boolean;
  readonly enabledCapabilities: readonly ProspectMemoryCapability[];
  readonly capability: ProspectMemoryCapability;
}): "disabled" | "shadow" | "active" {
  if (!input.enabled) return "disabled";
  if (input.shadow) return "shadow";
  return isProspectMemoryCapabilityEnabled({
    prospectMemoryCapture: input.enabled,
    prospectMemoryShadow: input.shadow,
    prospectMemorySetter: input.setter,
    enabledCapabilities: input.enabledCapabilities,
  }, input.capability) ? "active" : "disabled";
}
