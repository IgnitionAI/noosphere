import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { ContentHasher } from "@outbound/application/shared/ports";
import type { ProspectContextBundle } from "@outbound/domain/prospect-memory/prospect-memory";

export interface ProspectMemoryShadowComparisonInput {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly requestKey: string;
  readonly legacyHistory: readonly {
    readonly direction: "inbound" | "outbound";
    readonly body: string;
    /** Authoritative source identifier used only in-memory for coverage math. */
    readonly sourceId?: string;
  }[];
  readonly memory: ProspectContextBundle;
  readonly comparedAt: Date;
}

export interface ProspectMemoryShadowComparator {
  compare(input: ProspectMemoryShadowComparisonInput): Promise<{ readonly aiRunId: string }>;
}

/**
 * Records a deterministic, PII-free comparison between the legacy 30-message
 * window and Prospect 360. It never invokes a model and has no provider-effect
 * dependency, so shadow measurement cannot create an additional message.
 */
export class DeterministicProspectMemoryShadowComparator implements ProspectMemoryShadowComparator {
  constructor(
    private readonly aiRuns: AiRunRecorder,
    private readonly hasher: ContentHasher,
  ) {}

  async compare(input: ProspectMemoryShadowComparisonInput): Promise<{ readonly aiRunId: string }> {
    if (input.memory.mode !== "shadow" || input.memory.automaticActionAllowed) {
      throw new Error("PROSPECT_MEMORY_SHADOW_COMPARISON_INVALID");
    }
    const startedAt = performance.now();
    const [legacyInputHash, memoryContextHash, inputHash] = await Promise.all([
      this.hasher.hash(input.legacyHistory),
      this.hasher.hash(input.memory.context),
      this.hasher.hash({
        contactId: input.contactId,
        requestKey: input.requestKey,
        receiptId: input.memory.receiptId,
        snapshotId: input.memory.snapshotId,
        snapshotVersion: input.memory.snapshotVersion,
        watermark: input.memory.watermark,
      }),
    ]);
    const criticalCounts = memoryCriticalCounts(input.memory.context);
    const criticalCoverage = memoryCriticalCoverage(input.memory.context, input.legacyHistory);
    const result = await this.aiRuns.record({
      workspaceId: input.workspaceId,
      purpose: "prospect_memory_shadow_comparison",
      provider: "deterministic",
      model: "prospect-memory-shadow-comparator-v1",
      promptVersion: "prospect-memory-shadow-v1",
      shadow: true,
      inputHash,
      output: {
        contactHash: await this.hasher.hash(input.contactId),
        receiptId: input.memory.receiptId,
        snapshotId: input.memory.snapshotId,
        snapshotVersion: input.memory.snapshotVersion,
        watermark: input.memory.watermark,
        privacyEpoch: input.memory.privacyEpoch,
        memoryStatus: input.memory.status,
        capability: input.memory.capability,
        legacyMessageCount: input.legacyHistory.length,
        legacySourceCount: criticalCoverage.legacySourceCount,
        legacyInputHash,
        memoryContextHash,
        memorySourceCount: input.memory.sourceEventIds.length,
        excludedMemorySourceCount: input.memory.excludedSourceEventIds.length,
        estimatedMemoryTokens: input.memory.estimatedTokens,
        criticalCounts,
        criticalSourceCount: criticalCoverage.criticalSourceCount,
        legacyCoveredCriticalSourceCount: criticalCoverage.legacyCoveredCriticalSourceCount,
        memoryOnlyCriticalSourceCount: criticalCoverage.memoryOnlyCriticalSourceCount,
        legacyCoverageMeasurable: criticalCoverage.measurable,
        automaticActionAllowed: false,
        waitCode: input.memory.waitCode,
        comparedAt: input.comparedAt.toISOString(),
      },
      status: "completed",
      cost: 0,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return { aiRunId: result.id };
  }
}

function memoryCriticalCoverage(
  context: Readonly<Record<string, unknown>>,
  legacyHistory: ProspectMemoryShadowComparisonInput["legacyHistory"],
): {
  readonly legacySourceCount: number;
  readonly criticalSourceCount: number;
  readonly legacyCoveredCriticalSourceCount: number | null;
  readonly memoryOnlyCriticalSourceCount: number | null;
  readonly measurable: boolean;
} {
  const legacySourceIds = new Set(
    legacyHistory
      .map((entry) => entry.sourceId?.trim())
      .filter((sourceId): sourceId is string => Boolean(sourceId)),
  );
  const memory = isRecord(context.memory) ? context.memory : null;
  const commercial = memory && isRecord(memory.commercialState) ? memory.commercialState : null;
  const criticalReferences = [
    ...recordArray(commercial?.confirmedNeeds),
    ...recordArray(commercial?.objections),
    ...recordArray(commercial?.commitments),
    ...recordArray(commercial?.doNotRepeat),
  ];
  const criticalSourceIds = new Set(
    criticalReferences
      .map((reference) => typeof reference.sourceId === "string" ? reference.sourceId.trim() : "")
      .filter(Boolean),
  );
  const measurable = legacySourceIds.size === legacyHistory.length
    && criticalSourceIds.size > 0
    && criticalReferences.every((reference) => typeof reference.sourceId === "string" && reference.sourceId.trim());
  if (!measurable) {
    return {
      legacySourceCount: legacySourceIds.size,
      criticalSourceCount: criticalSourceIds.size,
      legacyCoveredCriticalSourceCount: null,
      memoryOnlyCriticalSourceCount: null,
      measurable: false,
    };
  }
  const legacyCoveredCriticalSourceCount = [...criticalSourceIds]
    .filter((sourceId) => legacySourceIds.has(sourceId)).length;
  return {
    legacySourceCount: legacySourceIds.size,
    criticalSourceCount: criticalSourceIds.size,
    legacyCoveredCriticalSourceCount,
    memoryOnlyCriticalSourceCount: criticalSourceIds.size - legacyCoveredCriticalSourceCount,
    measurable: true,
  };
}

function memoryCriticalCounts(context: Readonly<Record<string, unknown>>): Readonly<Record<string, number>> {
  const memory = isRecord(context.memory) ? context.memory : null;
  const commercial = memory && isRecord(memory.commercialState) ? memory.commercialState : null;
  return {
    confirmedNeeds: arrayLength(commercial?.confirmedNeeds),
    objections: arrayLength(commercial?.objections),
    commitments: arrayLength(commercial?.commitments),
    topicsCovered: arrayLength(commercial?.topicsCovered),
    doNotRepeat: arrayLength(commercial?.doNotRepeat),
    openQuestions: arrayLength(commercial?.openQuestions),
    contradictions: arrayLength(memory?.contradictions),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function recordArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
