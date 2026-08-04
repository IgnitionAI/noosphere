import postgres from "postgres";

const runId = process.argv[2];
if (!runId) throw new Error("Usage: bun scripts/evaluate-ignitionrag-icp-run.ts <run-id>");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1 });
try {
  const [run] = await sql<
    Array<{ status: string; brief: Record<string, unknown>; output: Record<string, unknown> | null }>
  >`
    select runs.status, runs.brief, stages.output
    from product_research_runs runs
    left join research_stage_runs stages
      on stages.run_id = runs.id
      and stages.stage = 'buyer_landscape_discovery'
      and stages.status = 'completed'
    where runs.id = ${runId}
    order by stages.attempt desc nulls last
    limit 1
  `;
  if (!run) throw new Error("RUN_NOT_FOUND");
  const proposals = await sql<
    Array<{ rank: number; name: string; criteria: Record<string, unknown> }>
  >`
    select rank, name, criteria
    from icp_proposals
    where run_id = ${runId}
    order by rank
  `;
  const prospectabilityFailures = proposals.flatMap((proposal) => {
    const criteria = object(proposal.criteria);
    const prospecting = object(criteria.prospecting);
    const failures: string[] = [];
    if (criteria.buyerType !== "end_customer") failures.push(`${proposal.rank}:buyerType`);
    for (const field of ["industries", "companySizes", "jobTitles", "triggerSignals", "searchKeywords"]) {
      if (!Array.isArray(prospecting[field]) || prospecting[field].length === 0) {
        failures.push(`${proposal.rank}:${field}`);
      }
    }
    if (typeof object(criteria.scorecard).total !== "number") {
      failures.push(`${proposal.rank}:scorecard`);
    }
    return failures;
  });
  const checks = {
    reportCompleted: ["completed", "ready_for_review"].includes(run.status),
    buyerLandscapeCompleted: Boolean(run.output),
    proposalCount: proposals.length <= 5,
    prospectable: prospectabilityFailures.length === 0,
  };
  console.info(
    JSON.stringify({
      event: "ignitionrag_icp_evaluation",
      runId,
      checks,
      prospectabilityFailures,
      proposals: proposals.map(({ rank, name }) => ({ rank, name })),
    }),
  );
  if (Object.values(checks).some((passed) => !passed)) process.exitCode = 1;
} finally {
  await sql.end();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
