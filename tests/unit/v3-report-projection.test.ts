import { describe, expect, test } from "bun:test";
import {
  projectV3PartialRanking,
  resolveV3ReportRanking,
} from "@outbound/application/gtm/v3-report-projection";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

describe("V3 partial report projection", () => {
  test("turns completed organization research into explicit unverified ICP hypotheses", () => {
    const ranking = projectV3PartialRanking({
      product_truth: validOutputFor("product_truth"),
      problem_mapping: validOutputFor("problem_mapping"),
      organization_discovery: validOutputFor("organization_discovery"),
      market_investigation: validOutputFor("market_investigation"),
    });

    expect(ranking).toMatchObject({
      status: "partial",
      missingStages: expect.arrayContaining(["buying_context", "objective_ranking"]),
      coverage: { generated: 1, investigated: 1, sourced: 0 },
    });
    expect(ranking.proposals).toHaveLength(1);
    expect(ranking.proposals[0]).toMatchObject({
      rank: 1,
      state: "insufficient",
      sourcingStatus: null,
      organizationType: "Distributed regulated operations teams",
    });
    expect(ranking.proposals[0]?.buyingCommittee).toEqual([]);
    expect(ranking.proposals[0]?.unknowns).toContain("Buying context not completed");
  });

  test("still returns an explicit partial ranking when no checkpoint completed", () => {
    expect(resolveV3ReportRanking({}, true)).toMatchObject({
      status: "partial",
      proposals: [],
      missingStages: expect.arrayContaining(["product_truth", "objective_ranking"]),
    });
  });
});
