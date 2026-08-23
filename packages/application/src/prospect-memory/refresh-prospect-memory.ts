import type { ContentHasher, Clock, IdGenerator } from "@outbound/application/shared/ports";
import {
  isProspectMemoryEventValidAt,
  type ProspectMemoryEvent,
  type ProspectMemorySnapshot,
} from "@outbound/domain/prospect-memory/prospect-memory";
import type {
  ProspectMemoryAuthoritativeStateReader,
  ProspectMemoryEventRepository,
  ProspectMemoryPolicyReader,
  ProspectMemoryProjectionValidator,
  ProspectMemoryProjector,
  ProspectMemorySemanticBudgetReader,
  ProspectMemorySourceMaterial,
  ProspectMemorySourceMaterialReader,
  ProspectMemorySynthesis,
  ProspectMemorySynthesizer,
  ProspectMemorySnapshotRepository,
} from "./prospect-memory";
import { assertProspectMemoryProcessingAllowed, prospectMemoryAllowedProviders } from "./prospect-memory";

export type RefreshProspectMemoryResult =
  | { readonly outcome: "disabled" | "obsolete" | "no_events" }
  | { readonly outcome: "budget_blocked"; readonly retryAt: Date }
  | { readonly outcome: "concurrent_update" }
  | {
      readonly outcome: "published";
      readonly snapshot: ProspectMemorySnapshot;
      /** More events existed at the stable read boundary and require another page. */
      readonly hasMore: boolean;
    };

export class RefreshProspectMemory {
  constructor(
    private readonly events: ProspectMemoryEventRepository,
    private readonly snapshots: ProspectMemorySnapshotRepository,
    private readonly authoritativeState: ProspectMemoryAuthoritativeStateReader,
    private readonly sourceMaterials: ProspectMemorySourceMaterialReader,
    private readonly policies: ProspectMemoryPolicyReader,
    private readonly semanticBudget: ProspectMemorySemanticBudgetReader,
    private readonly synthesizer: ProspectMemorySynthesizer,
    private readonly projector: ProspectMemoryProjector,
    private readonly validator: ProspectMemoryProjectionValidator,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly hasher: ContentHasher,
  ) {}

  async execute(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly targetSequenceId: number;
    readonly privacyEpoch: number;
    readonly requestKey: string;
  }): Promise<RefreshProspectMemoryResult> {
    assertInput(input);
    const policy = await this.policies.find(input.workspaceId);
    if (!policy.flags.prospectMemoryCapture) return { outcome: "disabled" };

    const [state, previousSnapshot, latestSequence] = await Promise.all([
      this.authoritativeState.read(input.workspaceId, input.contactId),
      this.snapshots.findCurrent(input.workspaceId, input.contactId),
      this.events.latestSequence(input.workspaceId, input.contactId),
    ]);
    if (!state || state.anonymizedAt || state.currentState.anonymized || state.privacyEpoch !== input.privacyEpoch) {
      return { outcome: "obsolete" };
    }
    const baseWatermark = previousSnapshot?.watermark ?? 0;
    const targetSequenceId = Math.max(input.targetSequenceId, latestSequence);
    if (targetSequenceId <= baseWatermark) return { outcome: "no_events" };

    let delta = await this.events.listAfter({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      sequenceId: baseWatermark,
      targetSequenceId,
      limit: 1_000,
    });
    if (delta.length === 0) return { outcome: "no_events" };
    const resetHistoricalProjection = delta.some((event) =>
      event.kind === "identity_linked" || event.kind === "identity_unlinked");
    if (resetHistoricalProjection) {
      delta = await readEventsThrough({
        repository: this.events,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        targetSequenceId,
      });
    }
    const materials = await this.sourceMaterials.read({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      events: delta,
    });
    assertMaterialCoverage(delta.map((event) => event.id), materials);

    const semanticAsOf = this.clock.now();
    const semanticMaterials = materials.filter((material) =>
      material.content?.trim() && isProspectMemoryEventValidAt(material.event, semanticAsOf));
    let synthesis: ProspectMemorySynthesis;
    if (semanticMaterials.length === 0) {
      synthesis = deterministicSynthesis(resetHistoricalProjection ? null : previousSnapshot);
    } else {
      const now = this.clock.now();
      const usage = await this.semanticBudget.readUsage({
        workspaceId: input.workspaceId,
        since: new Date(now.getTime() - 24 * 60 * 60 * 1_000),
      });
      if (
        usage.refreshes >= policy.maxDailySemanticRefreshes
        || usage.costUsd >= policy.maxDailyCostUsd
      ) {
        return { outcome: "budget_blocked", retryAt: new Date(now.getTime() + 60 * 60 * 1_000) };
      }
      const processingCapabilities = policy.flags.enabledCapabilities.length > 0
        ? policy.flags.enabledCapabilities
        : policy.flags.prospectMemoryShadow
          ? (["setter_campaign"] as const)
          : [];
      const providersByCapability = processingCapabilities.map((capability) =>
        prospectMemoryAllowedProviders(policy, capability));
      const allowedProviders = [...new Set(providersByCapability[0] ?? [])]
        .filter((provider) => providersByCapability.every((providers) => providers.includes(provider)));
      if (allowedProviders.length === 0) throw new Error("PROSPECT_MEMORY_PROCESSING_PROFILE_REQUIRED");
      const deadlineAt = new Date(now.getTime() + 60_000);
      synthesis = await this.synthesizer.synthesize({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        requestKey: input.requestKey,
        materials: semanticMaterials,
        previousSnapshot: resetHistoricalProjection ? null : previousSnapshot,
        allowedProviders,
        shadow: policy.flags.prospectMemoryShadow,
        deadlineAt,
      });
      if (!allowedProviders.includes(synthesis.provider!)) {
        throw new Error("PROSPECT_MEMORY_PROVIDER_NOT_ALLOWED");
      }
      for (const capability of processingCapabilities) {
        assertProspectMemoryProcessingAllowed({
          policy,
          provider: synthesis.provider!,
          capability,
        });
      }
    }

    const generatedAt = this.clock.now();
    const snapshotId = this.ids.generate();
    const draft = this.projector.project({
      previousSnapshot,
      resetHistoricalProjection,
      currentState: state.currentState,
      events: delta,
      materials,
      synthesis,
      generatedAt,
      privacyEpoch: state.privacyEpoch,
      snapshotId,
      contentHash: "pending",
    });
    const contentHash = await this.hasher.hash(snapshotHashMaterial(draft));
    const snapshot = this.validator.validate({
      previousSnapshot,
      resetHistoricalProjection,
      snapshot: { ...draft, contentHash },
      events: delta,
      materials,
    });
    const published = await this.snapshots.publishIfCurrent({
      snapshot,
      expectedVersion: previousSnapshot?.version ?? 0,
      expectedPrivacyEpoch: state.privacyEpoch,
    });
    return published
      ? { outcome: "published", snapshot, hasMore: snapshot.watermark < targetSequenceId }
      : { outcome: "concurrent_update" };
  }
}

async function readEventsThrough(input: {
  readonly repository: ProspectMemoryEventRepository;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly targetSequenceId: number;
}): Promise<ProspectMemoryEvent[]> {
  const events: ProspectMemoryEvent[] = [];
  let cursor = 0;
  while (cursor < input.targetSequenceId) {
    const page = await input.repository.listAfter({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      sequenceId: cursor,
      targetSequenceId: input.targetSequenceId,
      limit: 1_000,
    });
    if (page.length === 0) break;
    events.push(...page);
    cursor = page.at(-1)!.sequenceId;
  }
  return events;
}

function deterministicSynthesis(previous: ProspectMemorySnapshot | null): ProspectMemorySynthesis {
  return {
    classifications: [],
    assertions: [],
    relationshipSummary: previous?.relationshipSummary ?? "Aucun échange sémantique disponible.",
    recommendedTone: previous?.recommendedTone ?? null,
    contradictions: previous?.contradictions ?? [],
    missingInformation: previous?.missingInformation ?? [],
    provider: null,
    model: null,
  };
}

function assertInput(input: {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly targetSequenceId: number;
  readonly privacyEpoch: number;
  readonly requestKey: string;
}): void {
  if (!input.workspaceId || !input.contactId || !input.requestKey) throw new Error("PROSPECT_MEMORY_REFRESH_INPUT_INVALID");
  if (!Number.isSafeInteger(input.targetSequenceId) || input.targetSequenceId < 1) {
    throw new Error("PROSPECT_MEMORY_TARGET_SEQUENCE_INVALID");
  }
  if (!Number.isSafeInteger(input.privacyEpoch) || input.privacyEpoch < 0) {
    throw new Error("PROSPECT_MEMORY_PRIVACY_EPOCH_INVALID");
  }
}

function assertMaterialCoverage(
  eventIds: readonly string[],
  materials: readonly ProspectMemorySourceMaterial[],
): void {
  const materialIds = new Set(materials.map((material) => material.event.id));
  if (materialIds.size !== materials.length || eventIds.some((eventId) => !materialIds.has(eventId))) {
    throw new Error("PROSPECT_MEMORY_SOURCE_MATERIAL_INCOMPLETE");
  }
}

function snapshotHashMaterial(snapshot: ProspectMemorySnapshot): unknown {
  return {
    workspaceId: snapshot.workspaceId,
    contactId: snapshot.contactId,
    version: snapshot.version,
    watermark: snapshot.watermark,
    privacyEpoch: snapshot.privacyEpoch,
    currentState: snapshot.currentState,
    commercialState: snapshot.commercialState,
    assertions: snapshot.assertions,
    relationshipSummary: snapshot.relationshipSummary,
    recommendedTone: snapshot.recommendedTone,
    contradictions: snapshot.contradictions,
    missingInformation: snapshot.missingInformation,
    modelProvider: snapshot.modelProvider,
    model: snapshot.model,
    promptVersion: snapshot.promptVersion,
    policyVersion: snapshot.policyVersion,
    schemaVersion: snapshot.schemaVersion,
    rendererVersion: snapshot.rendererVersion,
  };
}
