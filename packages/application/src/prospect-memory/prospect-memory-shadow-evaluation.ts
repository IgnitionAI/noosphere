export interface ProspectMemoryShadowRun {
  readonly output: unknown;
  readonly createdAt: Date;
}

export interface ProspectMemoryShadowEvaluation {
  readonly schemaVersion: 1;
  readonly minimumContextCount: number;
  readonly contextCount: number;
  readonly measurableContextCount: number;
  readonly invalidContextCount: number;
  readonly automaticActionViolationCount: number;
  readonly contextsWithMemoryOnlyCriticalSources: number;
  readonly criticalSourceCount: number;
  readonly legacyCoveredCriticalSourceCount: number;
  readonly memoryOnlyCriticalSourceCount: number;
  readonly memoryOnlyCriticalSourceRate: number | null;
  readonly capabilityCounts: Readonly<Record<string, number>>;
  readonly memoryStatusCounts: Readonly<Record<string, number>>;
  readonly observabilityGatePassed: boolean;
  readonly semanticQualityGate: "not_measured";
  readonly firstObservedAt: string | null;
  readonly lastObservedAt: string | null;
}

/**
 * Aggregates only PII-free shadow telemetry. This proves rollout coverage and
 * safety instrumentation, not semantic answer quality; the latter requires a
 * labelled corpus and is deliberately reported as not measured.
 */
export function evaluateProspectMemoryShadowRuns(input: {
  readonly runs: readonly ProspectMemoryShadowRun[];
  readonly minimumContextCount: number;
}): ProspectMemoryShadowEvaluation {
  if (!Number.isSafeInteger(input.minimumContextCount) || input.minimumContextCount < 1) {
    throw new Error("PROSPECT_MEMORY_SHADOW_MINIMUM_INVALID");
  }
  let measurableContextCount = 0;
  let invalidContextCount = 0;
  let automaticActionViolationCount = 0;
  let contextsWithMemoryOnlyCriticalSources = 0;
  let criticalSourceCount = 0;
  let legacyCoveredCriticalSourceCount = 0;
  let memoryOnlyCriticalSourceCount = 0;
  const capabilityCounts: Record<string, number> = {};
  const memoryStatusCounts: Record<string, number> = {};
  const observedAt: Date[] = [];

  for (const run of input.runs) {
    const output = record(run.output);
    if (!output) {
      invalidContextCount += 1;
      continue;
    }
    observedAt.push(run.createdAt);
    if (output.automaticActionAllowed !== false) automaticActionViolationCount += 1;
    increment(capabilityCounts, string(output.capability) ?? "unknown");
    increment(memoryStatusCounts, string(output.memoryStatus) ?? "unknown");

    const measurable = output.legacyCoverageMeasurable === true;
    const critical = nonNegativeInteger(output.criticalSourceCount);
    const covered = nonNegativeInteger(output.legacyCoveredCriticalSourceCount);
    const memoryOnly = nonNegativeInteger(output.memoryOnlyCriticalSourceCount);
    if (!measurable || critical === null || covered === null || memoryOnly === null || covered + memoryOnly !== critical) {
      invalidContextCount += 1;
      continue;
    }
    measurableContextCount += 1;
    criticalSourceCount += critical;
    legacyCoveredCriticalSourceCount += covered;
    memoryOnlyCriticalSourceCount += memoryOnly;
    if (memoryOnly > 0) contextsWithMemoryOnlyCriticalSources += 1;
  }

  observedAt.sort((left, right) => left.getTime() - right.getTime());
  const contextCount = input.runs.length;
  return {
    schemaVersion: 1,
    minimumContextCount: input.minimumContextCount,
    contextCount,
    measurableContextCount,
    invalidContextCount,
    automaticActionViolationCount,
    contextsWithMemoryOnlyCriticalSources,
    criticalSourceCount,
    legacyCoveredCriticalSourceCount,
    memoryOnlyCriticalSourceCount,
    memoryOnlyCriticalSourceRate: criticalSourceCount === 0 ? null : memoryOnlyCriticalSourceCount / criticalSourceCount,
    capabilityCounts,
    memoryStatusCounts,
    observabilityGatePassed: contextCount >= input.minimumContextCount
      && measurableContextCount === contextCount
      && invalidContextCount === 0
      && automaticActionViolationCount === 0,
    semanticQualityGate: "not_measured",
    firstObservedAt: observedAt[0]?.toISOString() ?? null,
    lastObservedAt: observedAt.at(-1)?.toISOString() ?? null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}
