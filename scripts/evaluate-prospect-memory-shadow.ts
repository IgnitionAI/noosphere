import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import postgres from "postgres";
import { evaluateProspectMemoryShadowRuns } from "@outbound/application/prospect-memory/prospect-memory-shadow-evaluation";

const databaseUrl = required("DATABASE_URL");
const workspaceSlug = required("SHADOW_WORKSPACE_SLUG");
const minimumContextCount = positiveInteger("SHADOW_MIN_CONTEXTS", 1_000);
const outputPath = process.env.SHADOW_OUTPUT?.trim() || null;
const failOnGate = process.env.SHADOW_FAIL_ON_GATE !== "false";
const since = optionalDate("SHADOW_SINCE");
const until = optionalDate("SHADOW_UNTIL");
const sql = postgres(databaseUrl, { max: 1 });

try {
  const [workspace] = await sql<Array<{ id: string }>>`
    select id
    from workspaces
    where slug = ${workspaceSlug}
    limit 1
  `;
  if (!workspace) throw new Error("SHADOW_WORKSPACE_NOT_FOUND");
  const runs = await sql<Array<{ output: unknown; created_at: Date }>>`
    select output, created_at
    from ai_runs
    where workspace_id = ${workspace.id}
      and purpose = 'prospect_memory_shadow_comparison'
      and shadow = true
      and status = 'completed'
      and (${since}::timestamptz is null or created_at >= ${since})
      and (${until}::timestamptz is null or created_at < ${until})
    order by created_at, id
  `;
  const evaluation = evaluateProspectMemoryShadowRuns({
    minimumContextCount,
    runs: runs.map((run) => ({ output: run.output, createdAt: new Date(run.created_at) })),
  });
  const report = {
    generatedAt: new Date().toISOString(),
    workspaceSlug,
    period: {
      since: since?.toISOString() ?? null,
      until: until?.toISOString() ?? null,
    },
    ...evaluation,
    interpretation: {
      observabilityGate: "Proves sample size, measurable source coverage and zero effect-capable shadow context.",
      semanticQualityGate: "Requires a separately labelled corpus; this report never claims semantic quality.",
    },
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, serialized);
  }
  process.stdout.write(serialized);
  if (failOnGate && !evaluation.observabilityGatePassed) process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
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

function optionalDate(name: string): Date | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) throw new Error(`${name} must be an ISO date`);
  return value;
}
