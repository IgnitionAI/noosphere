import {
  PROSPECT_MEMORY_RENDERER_VERSION,
  PROSPECT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
  assertProspectMemoryAssertion,
  isProspectMemoryEventValidAt,
  isProspectMemorySourceReferenceValidAt,
  type ProspectMemoryAssertion,
  type ProspectMemoryCommercialState,
  type ProspectMemorySourceReference,
  type ProspectMemorySnapshot,
} from "@outbound/domain/prospect-memory/prospect-memory";
import type {
  ProspectMemoryProjectionInput,
  ProspectMemoryProjectionValidator,
  ProspectMemoryProjector,
  ProspectMemorySemanticCategory,
  ProspectMemorySourceMaterial,
} from "./prospect-memory";

const categoryFields: Readonly<Record<ProspectMemorySemanticCategory, keyof ProspectMemoryCommercialState>> = {
  confirmed_need: "confirmedNeeds",
  objection: "objections",
  commitment: "commitments",
  topic_covered: "topicsCovered",
  do_not_repeat: "doNotRepeat",
  open_question: "openQuestions",
};

export class DeterministicProspectMemoryProjector implements ProspectMemoryProjector {
  project(input: ProspectMemoryProjectionInput): ProspectMemorySnapshot {
    if (input.events.length === 0) throw new Error("PROSPECT_MEMORY_REFRESH_EVENTS_REQUIRED");
    const sorted = [...input.events].sort((left, right) => left.sequenceId - right.sequenceId);
    const first = sorted[0]!;
    const last = sorted.at(-1)!;
    const previous = input.previousSnapshot;
    const previousContent = input.resetHistoricalProjection ? null : previous;
    if (previous && !input.resetHistoricalProjection && first.sequenceId <= previous.watermark) {
      throw new Error("PROSPECT_MEMORY_REFRESH_OVERLAP");
    }

    const materials = new Map(input.materials.map((material) => [material.event.id, material]));
    const superseded = new Set(sorted.flatMap((event) => event.supersedesEventId ? [event.supersedesEventId] : []));
    const commercialState = cloneCommercialState(previousContent?.commercialState);
    for (const field of Object.values(categoryFields)) {
      commercialState[field] = commercialState[field].filter((reference) =>
        !superseded.has(reference.eventId)
        && isProspectMemorySourceReferenceValidAt(reference, input.generatedAt));
    }

    for (const classification of input.synthesis.classifications) {
      const material = materials.get(classification.eventId);
      if (!material) throw new Error("PROSPECT_MEMORY_CLASSIFICATION_SOURCE_UNKNOWN");
      if (!isProspectMemoryEventValidAt(material.event, input.generatedAt)) {
        throw new Error("PROSPECT_MEMORY_CLASSIFICATION_SOURCE_NOT_CURRENT");
      }
      const reference = sourceReference(material);
      for (const category of new Set(classification.categories)) {
        const field = categoryFields[category];
        if (!field) throw new Error("PROSPECT_MEMORY_CLASSIFICATION_CATEGORY_INVALID");
        commercialState[field] = upsertReference(commercialState[field], reference);
      }
    }

    const previousAssertions = (previousContent?.assertions ?? []).filter((assertion) =>
      assertion.status === "active"
      && !assertion.sources.some((source) => superseded.has(source.eventId))
      && assertion.sources.every((source) => isProspectMemorySourceReferenceValidAt(source, input.generatedAt))
      && (!assertion.validUntil || assertion.validUntil > input.generatedAt));
    const assertions: ProspectMemoryAssertion[] = [
      ...previousAssertions,
      ...input.synthesis.assertions.map((assertion, index) => assertProspectMemoryAssertion({
        id: `${input.snapshotId}:assertion:${index + 1}`,
        nature: assertion.nature,
        statement: assertion.statement.trim(),
        confidence: assertion.confidence,
        sources: assertion.sourceEventIds.map((eventId) => {
          const material = materials.get(eventId);
          if (!material) throw new Error("PROSPECT_MEMORY_ASSERTION_SOURCE_UNKNOWN");
          if (!isProspectMemoryEventValidAt(material.event, input.generatedAt)) {
            throw new Error("PROSPECT_MEMORY_ASSERTION_SOURCE_NOT_CURRENT");
          }
          return sourceReference(material);
        }),
        validUntil: assertion.validUntil,
        status: "active",
      })),
    ];

    return {
      id: input.snapshotId,
      workspaceId: last.workspaceId,
      contactId: last.canonicalContactId,
      version: (previous?.version ?? 0) + 1,
      watermark: last.sequenceId,
      firstSequenceId: previousContent?.firstSequenceId ?? first.sequenceId,
      privacyEpoch: input.privacyEpoch,
      status: "fresh",
      currentState: input.currentState,
      commercialState,
      assertions,
      relationshipSummary: input.synthesis.relationshipSummary.trim() || previousContent?.relationshipSummary || "Aucune synthèse relationnelle disponible.",
      recommendedTone: normalizeOptionalText(input.synthesis.recommendedTone) ?? previousContent?.recommendedTone ?? null,
      contradictions: uniqueTrimmed(input.synthesis.contradictions),
      missingInformation: uniqueTrimmed(input.synthesis.missingInformation),
      modelProvider: input.synthesis.provider,
      model: input.synthesis.model,
      promptVersion: "prospect-memory-v1",
      policyVersion: "prospect-memory-policy-v1",
      schemaVersion: PROSPECT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
      rendererVersion: PROSPECT_MEMORY_RENDERER_VERSION,
      contentHash: input.contentHash,
      generatedAt: input.generatedAt,
    };
  }
}

export class StrictProspectMemoryProjectionValidator implements ProspectMemoryProjectionValidator {
  validate(input: Parameters<ProspectMemoryProjectionValidator["validate"]>[0]): ProspectMemorySnapshot {
    const { snapshot, previousSnapshot } = input;
    const sorted = [...input.events].sort((left, right) => left.sequenceId - right.sequenceId);
    const last = sorted.at(-1);
    if (!last || snapshot.watermark !== last.sequenceId) throw new Error("PROSPECT_MEMORY_WATERMARK_INVALID");
    if (snapshot.workspaceId !== last.workspaceId || snapshot.contactId !== last.canonicalContactId) {
      throw new Error("PROSPECT_MEMORY_SCOPE_MISMATCH");
    }
    if (snapshot.status !== "fresh") throw new Error("PROSPECT_MEMORY_REFRESH_STATUS_INVALID");
    if (snapshot.relationshipSummary.length > 4_000) throw new Error("PROSPECT_MEMORY_SUMMARY_TOO_LARGE");
    if (snapshot.assertions.length > 100) throw new Error("PROSPECT_MEMORY_ASSERTION_BUDGET_EXCEEDED");
    if (previousSnapshot) {
      if (snapshot.version !== previousSnapshot.version + 1 || snapshot.watermark <= previousSnapshot.watermark) {
        throw new Error("PROSPECT_MEMORY_SNAPSHOT_VERSION_INVALID");
      }
      if (snapshot.privacyEpoch !== previousSnapshot.privacyEpoch) {
        throw new Error("PROSPECT_MEMORY_PRIVACY_EPOCH_CHANGED");
      }
    }

    const allowedSources = new Set([
      ...input.events.map((event) => event.id),
      ...(input.resetHistoricalProjection
        ? []
        : referencesFromSnapshot(previousSnapshot).map((reference) => reference.eventId)),
    ]);
    for (const reference of referencesFromSnapshot(snapshot)) {
      if (!allowedSources.has(reference.eventId)) throw new Error("PROSPECT_MEMORY_REFERENCE_NOT_RESOLVABLE");
    }
    return snapshot;
  }
}

function cloneCommercialState(value: ProspectMemoryCommercialState | undefined): MutableCommercialState {
  return {
    confirmedNeeds: [...(value?.confirmedNeeds ?? [])],
    objections: [...(value?.objections ?? [])],
    commitments: [...(value?.commitments ?? [])],
    topicsCovered: [...(value?.topicsCovered ?? [])],
    doNotRepeat: [...(value?.doNotRepeat ?? [])],
    openQuestions: [...(value?.openQuestions ?? [])],
  };
}

type MutableCommercialState = {
  -readonly [K in keyof ProspectMemoryCommercialState]: ProspectMemorySourceReference[];
};

function sourceReference(material: ProspectMemorySourceMaterial): ProspectMemorySourceReference {
  return {
    eventId: material.event.id,
    sequenceId: material.event.sequenceId,
    sourceKind: material.event.sourceKind,
    sourceId: material.event.sourceId,
    excerpt: normalizeOptionalText(material.content)?.slice(0, 280) ?? null,
    validFrom: material.event.validFrom.toISOString(),
    validTo: material.event.validTo?.toISOString() ?? null,
  };
}

function upsertReference(
  references: ProspectMemorySourceReference[],
  reference: ProspectMemorySourceReference,
): ProspectMemorySourceReference[] {
  return [...references.filter((candidate) => candidate.eventId !== reference.eventId), reference]
    .sort((left, right) => left.sequenceId - right.sequenceId);
}

function referencesFromSnapshot(snapshot: ProspectMemorySnapshot | null): ProspectMemorySourceReference[] {
  if (!snapshot) return [];
  return [
    ...snapshot.commercialState.confirmedNeeds,
    ...snapshot.commercialState.objections,
    ...snapshot.commercialState.commitments,
    ...snapshot.commercialState.topicsCovered,
    ...snapshot.commercialState.doNotRepeat,
    ...snapshot.commercialState.openQuestions,
    ...snapshot.assertions.flatMap((assertion) => assertion.sources),
  ];
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function uniqueTrimmed(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 50);
}
