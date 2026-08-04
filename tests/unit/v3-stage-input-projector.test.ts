import { describe, expect, test } from "bun:test";
import { buildV3StageSnapshot } from "@outbound/application/gtm/v3-stage-input-projector";
import type { ResearchCheckpoint } from "@outbound/domain/gtm/product-research";

function checkpoint(stage: ResearchCheckpoint["stage"], output: unknown): ResearchCheckpoint {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    stage,
    attempt: 1,
    status: "completed",
    review: "machine",
    inputHash: "input",
    outputHash: "output",
    output,
    errorCode: null,
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

describe("V3 stage input projector", () => {
  test("never exposes an internal evidence capsule to a public research stage", () => {
    const canary = "INTERNAL_CANARY_MUST_NEVER_REACH_WEB";
    const snapshot = buildV3StageSnapshot("market_investigation", [
      checkpoint("product_truth", {
        facts: [{ factId: "PF01", statement: "Cites controlled documents" }],
        evidence: [{
          evidenceId: "I01",
          sourceType: "internal_document",
          excerpt: canary,
          context: canary,
        }],
      }),
      checkpoint("organization_discovery", {
        hypotheses: [{ hypothesisId: "H01", organizationType: "Distributed operators" }],
        evidence: [{
          evidenceId: "P01",
          sourceType: "public_web",
          excerpt: "Public market signal",
        }],
      }),
    ]);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain("internal_document");
    expect(serialized).toContain("Public market signal");
    expect(serialized).toContain("Cites controlled documents");
    expect(serialized).not.toContain("productSummary");
  });

  test("objective ranking receives structured candidates and review, not raw internal sources", () => {
    const snapshot = buildV3StageSnapshot("objective_ranking", [
      checkpoint("product_truth", {
        evidence: [{ evidenceId: "I01", sourceType: "internal_document", excerpt: "secret" }],
      }),
      checkpoint("icp_composition", { candidates: [{ candidateId: "C01" }] }),
      checkpoint("adversarial_review", { reviews: [{ candidateId: "C01", decision: "keep" }] }),
    ]);
    expect(snapshot).toEqual({
      icp_composition: { candidates: [{ candidateId: "C01" }] },
      adversarial_review: { reviews: [{ candidateId: "C01", decision: "keep" }] },
      public_evidence: [],
    });
  });
});
