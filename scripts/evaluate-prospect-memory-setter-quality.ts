import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import postgres from "postgres";
import {
  evaluateProspectMemorySetterQuality,
  type ProspectMemorySetterQualityLabel,
} from "@outbound/application/prospect-memory/prospect-memory-setter-quality-evaluation";

const databaseUrl = required("DATABASE_URL");
const workspaceSlug = required("SETTER_QUALITY_WORKSPACE_SLUG");
const labelsPath = required("SETTER_QUALITY_LABELS");
const minimumCaseCount = positiveInteger("SETTER_QUALITY_MIN_CASES", 100);
const outputPath = process.env.SETTER_QUALITY_OUTPUT?.trim() || null;
const failOnGate = process.env.SETTER_QUALITY_FAIL_ON_GATE !== "false";
const labels = parseLabels(await Bun.file(labelsPath).json());
const commandIds = [...new Set(labels.map((label) => label.commandId))];
const sql = postgres(databaseUrl, { max: 1 });

try {
  const [workspace] = await sql<Array<{ id: string }>>`
    select id from workspaces where slug = ${workspaceSlug} limit 1
  `;
  if (!workspace) throw new Error("SETTER_QUALITY_WORKSPACE_NOT_FOUND");
  const commands = commandIds.length === 0 ? [] : await sql<Array<{
    id: string;
    execution_mode: string;
    status: string;
    generation_metadata: unknown;
  }>>`
    select id, execution_mode, status, generation_metadata
    from conversation_commands
    where workspace_id = ${workspace.id}
      and id in ${sql(commandIds)}
  `;
  const evaluation = evaluateProspectMemorySetterQuality({
    labels,
    minimumCaseCount,
    commands: commands.map((command) => ({
      commandId: command.id,
      executionMode: command.execution_mode,
      status: command.status,
      generationMetadata: command.generation_metadata,
    })),
  });
  const report = {
    generatedAt: new Date().toISOString(),
    workspaceSlug,
    labelsPath,
    ...evaluation,
    interpretation: "PII-free labelled review of durable Setter dry-runs. This report contains counters and audit references only, never prospect messages.",
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, serialized);
  }
  process.stdout.write(serialized);
  if (failOnGate && !evaluation.qualityGatePassed) process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

function parseLabels(value: unknown): ProspectMemorySetterQualityLabel[] {
  if (!Array.isArray(value)) throw new Error("SETTER_QUALITY_LABELS_MUST_BE_AN_ARRAY");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`SETTER_QUALITY_LABEL_${index}_INVALID`);
    const record = item as Record<string, unknown>;
    if (typeof record.commandId !== "string" || !record.commandId.trim()) throw new Error(`SETTER_QUALITY_LABEL_${index}_COMMAND_INVALID`);
    if (!Array.isArray(record.commitments) || !Array.isArray(record.criticalViolations) || typeof record.unjustifiedRepetition !== "boolean") {
      throw new Error(`SETTER_QUALITY_LABEL_${index}_SHAPE_INVALID`);
    }
    return {
      commandId: record.commandId,
      commitments: record.commitments.map((commitment, commitmentIndex) => {
        if (!commitment || typeof commitment !== "object" || Array.isArray(commitment)) throw new Error(`SETTER_QUALITY_LABEL_${index}_COMMITMENT_${commitmentIndex}_INVALID`);
        const entry = commitment as Record<string, unknown>;
        if (typeof entry.id !== "string" || typeof entry.recalled !== "boolean") throw new Error(`SETTER_QUALITY_LABEL_${index}_COMMITMENT_${commitmentIndex}_INVALID`);
        return { id: entry.id, recalled: entry.recalled };
      }),
      criticalViolations: record.criticalViolations.map((violation, violationIndex) => {
        if (typeof violation !== "string" || !violation.trim()) throw new Error(`SETTER_QUALITY_LABEL_${index}_VIOLATION_${violationIndex}_INVALID`);
        return violation;
      }),
      unjustifiedRepetition: record.unjustifiedRepetition,
    };
  });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}
