import { describe, expect, test } from "bun:test";
import type { AgentStageInput } from "@outbound/contracts/product-research";
import { V3ObjectiveRanker } from "@outbound/infrastructure/ai/v3-objective-ranker";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

function input(): AgentStageInput {
  return {
    stage: "objective_ranking",
    workspaceId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    researchStageRunId: crypto.randomUUID(),
    correlationId: "test",
    deadlineAt: null,
    workItemKey: "main",
    externalDlpTerms: [],
    brief: {
      productUrl: "https://example.com",
      productName: "Example",
      description: "",
      geography: "France",
      languages: ["fr"],
      salesMotion: "saas",
      knownCompetitors: [],
      internalDocumentIds: [],
      depth: "standard",
      audienceGoal: "end_customers",
      buyerConstraints: "",
      researchVersion: 3,
    },
    previousOutputs: {
      icp_composition: structuredClone(validOutputFor("icp_composition")),
      adversarial_review: structuredClone(validOutputFor("adversarial_review")),
    },
  };
}

describe("V3 objective ranker", () => {
  test("is invariant to sector and candidate renaming", () => {
    const ranker = new V3ObjectiveRanker();
    const original = input();
    const renamed = input();
    const composition = renamed.previousOutputs.icp_composition as Record<string, any>;
    composition.candidates[0].name = "Completely different sector label";
    composition.candidates[0].organizationType = "Renamed organization";

    const first = ranker.rank(original);
    const second = ranker.rank(renamed);
    expect(second.proposals.map((item) => item.candidateId)).toEqual(
      first.proposals.map((item) => item.candidateId),
    );
    expect(second.proposals.map((item) => item.rank)).toEqual(
      first.proposals.map((item) => item.rank),
    );
  });

  test("does not promote a provider-limited candidate", () => {
    const value = input();
    const composition = value.previousOutputs.icp_composition as Record<string, any>;
    composition.candidates[0].sourcingStatus = "provider_limited";
    composition.candidates[0].state = "adjacent_experiment";

    const output = new V3ObjectiveRanker().rank(value);
    expect(output.proposals[0]?.state).toBe("adjacent_experiment");
  });

  test("returns zero proposals when adversarial review rejects every candidate", () => {
    const value = input();
    const review = value.previousOutputs.adversarial_review as Record<string, any>;
    review.reviews[0].decision = "reject";
    const output = new V3ObjectiveRanker().rank(value);
    expect(output.proposals).toEqual([]);
  });

  test("changes stable ordering only when the explicit mission objective changes", () => {
    const qualified = input();
    const strategic = input();
    strategic.brief.researchObjective = "strategic_market";
    for (const value of [qualified, strategic]) {
      const composition = value.previousOutputs.icp_composition as Record<string, any>;
      const first = composition.candidates[0];
      first.candidateId = "C01";
      first.executability = { ...first.executability, value: 4 };
      first.attractiveness = { ...first.attractiveness, value: 2 };
      first.researchConfidence = { ...first.researchConfidence, value: 3 };
      const second = structuredClone(first);
      second.candidateId = "C02";
      second.name = "Strategic alternative";
      second.executability = { ...second.executability, value: 3 };
      second.attractiveness = { ...second.attractiveness, value: 4 };
      composition.candidates.push(second);
      const review = value.previousOutputs.adversarial_review as Record<string, any>;
      review.reviews[0].candidateId = "C01";
      const secondReview = structuredClone(review.reviews[0]);
      secondReview.candidateId = "C02";
      review.reviews.push(secondReview);
    }

    expect(new V3ObjectiveRanker().rank(qualified).proposals.map((item) => item.candidateId))
      .toEqual(["C01", "C02"]);
    const strategicOutput = new V3ObjectiveRanker().rank(strategic);
    expect(strategicOutput.objective).toBe("strategic_market");
    expect(strategicOutput.proposals.map((item) => item.candidateId))
      .toEqual(["C02", "C01"]);
  });
});
