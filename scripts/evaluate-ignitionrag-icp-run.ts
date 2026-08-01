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
  const names = proposals.map((proposal) => proposal.name.toLowerCase());
  const expected = [
    ["law_firms", /cabinet.*avocat|law firm|legal practice/],
    ["in_house_legal", /direction.*juridique|équipe.*juridique|in-house legal|legal team|corporate legal department/],
    ["notaries", /notair|notari/],
    ["legal_publishers", /éditeur.*juridique|édition.*juridique|legal publisher/],
    ["consulting", /cabinet.*conseil|consulting firm|management consulting|conseil spécialisé/],
    ["sme_compliance", /pme.*conformité|conformité.*pme|sme.*compliance|compliance.*sme/],
  ] as const;
  const covered = expected
    .filter(([, pattern]) => names.some((name) => pattern.test(name)))
    .map(([key]) => key);
  const missing = expected.map(([key]) => key).filter((key) => !covered.includes(key));
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
  const topTwoContainLawFirm = names.slice(0, 2).some((name) =>
    /cabinet.*avocat|law firm|legal practice/.test(name),
  );
  const checks = {
    readyForReview: run.status === "ready_for_review",
    buyerLandscapeCompleted: Boolean(run.output),
    proposalCount: proposals.length >= 3 && proposals.length <= 5,
    expleeCoverage: covered.length >= 4,
    lawFirmInTopTwo: topTwoContainLawFirm,
    prospectable: prospectabilityFailures.length === 0,
  };
  console.info(
    JSON.stringify({
      event: "ignitionrag_icp_evaluation",
      runId,
      checks,
      covered,
      missing,
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
