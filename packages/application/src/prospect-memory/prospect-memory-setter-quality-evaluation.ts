export interface ProspectMemorySetterQualityLabel {
  readonly commandId: string;
  readonly commitments: readonly {
    readonly id: string;
    readonly recalled: boolean;
  }[];
  readonly criticalViolations: readonly string[];
  readonly unjustifiedRepetition: boolean;
}

export interface ProspectMemorySetterDryRunAudit {
  readonly commandId: string;
  readonly executionMode: string;
  readonly status: string;
  readonly generationMetadata: unknown;
}

export interface ProspectMemorySetterQualityEvaluation {
  readonly schemaVersion: 1;
  readonly minimumCaseCount: number;
  readonly labelledCaseCount: number;
  readonly validCaseCount: number;
  readonly invalidCaseCount: number;
  readonly totalCommitmentCount: number;
  readonly recalledCommitmentCount: number;
  readonly commitmentRecallRate: number | null;
  readonly criticalViolationCount: number;
  readonly unjustifiedRepetitionCaseCount: number;
  readonly unjustifiedRepetitionRate: number | null;
  readonly auditedAiRunCount: number;
  readonly auditedMemoryReceiptCount: number;
  readonly qualityGatePassed: boolean;
  readonly thresholds: {
    readonly criticalViolationCount: 0;
    readonly minimumCommitmentRecallRate: 0.98;
    readonly maximumUnjustifiedRepetitionRateExclusive: 0.01;
  };
}

/**
 * Evaluates human-labelled Setter dry-runs without reading or persisting the
 * underlying prospect text. The labels contain decisions and counters only;
 * the durable command provides the ai_run and Prospect 360 receipt lineage.
 */
export function evaluateProspectMemorySetterQuality(input: {
  readonly labels: readonly ProspectMemorySetterQualityLabel[];
  readonly commands: readonly ProspectMemorySetterDryRunAudit[];
  readonly minimumCaseCount: number;
}): ProspectMemorySetterQualityEvaluation {
  if (!Number.isSafeInteger(input.minimumCaseCount) || input.minimumCaseCount < 1) {
    throw new Error("PROSPECT_MEMORY_SETTER_MINIMUM_INVALID");
  }
  const commands = new Map(input.commands.map((command) => [command.commandId, command]));
  const uniqueLabels = new Set<string>();
  const aiRuns = new Set<string>();
  const memoryReceipts = new Set<string>();
  let validCaseCount = 0;
  let invalidCaseCount = 0;
  let totalCommitmentCount = 0;
  let recalledCommitmentCount = 0;
  let criticalViolationCount = 0;
  let unjustifiedRepetitionCaseCount = 0;

  for (const label of input.labels) {
    const command = commands.get(label.commandId);
    const metadata = record(command?.generationMetadata);
    const aiRunId = string(metadata?.aiRunId);
    const memoryReceiptId = string(metadata?.memoryReceiptId);
    const valid = !uniqueLabels.has(label.commandId)
      && command?.executionMode === "dry_run"
      && command.status === "generated"
      && aiRunId !== null
      && memoryReceiptId !== null
      && label.commitments.every((commitment) => Boolean(commitment.id.trim()));
    uniqueLabels.add(label.commandId);
    if (!valid) {
      invalidCaseCount += 1;
      continue;
    }
    validCaseCount += 1;
    aiRuns.add(aiRunId);
    memoryReceipts.add(memoryReceiptId);
    totalCommitmentCount += label.commitments.length;
    recalledCommitmentCount += label.commitments.filter((commitment) => commitment.recalled).length;
    criticalViolationCount += label.criticalViolations.length;
    if (label.unjustifiedRepetition) unjustifiedRepetitionCaseCount += 1;
  }

  const labelledCaseCount = input.labels.length;
  const commitmentRecallRate = totalCommitmentCount === 0
    ? null
    : recalledCommitmentCount / totalCommitmentCount;
  const unjustifiedRepetitionRate = validCaseCount === 0
    ? null
    : unjustifiedRepetitionCaseCount / validCaseCount;
  return {
    schemaVersion: 1,
    minimumCaseCount: input.minimumCaseCount,
    labelledCaseCount,
    validCaseCount,
    invalidCaseCount,
    totalCommitmentCount,
    recalledCommitmentCount,
    commitmentRecallRate,
    criticalViolationCount,
    unjustifiedRepetitionCaseCount,
    unjustifiedRepetitionRate,
    auditedAiRunCount: aiRuns.size,
    auditedMemoryReceiptCount: memoryReceipts.size,
    qualityGatePassed: labelledCaseCount >= input.minimumCaseCount
      && validCaseCount === labelledCaseCount
      && invalidCaseCount === 0
      && totalCommitmentCount > 0
      && criticalViolationCount === 0
      && commitmentRecallRate !== null
      && commitmentRecallRate >= 0.98
      && unjustifiedRepetitionRate !== null
      && unjustifiedRepetitionRate < 0.01,
    thresholds: {
      criticalViolationCount: 0,
      minimumCommitmentRecallRate: 0.98,
      maximumUnjustifiedRepetitionRateExclusive: 0.01,
    },
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
