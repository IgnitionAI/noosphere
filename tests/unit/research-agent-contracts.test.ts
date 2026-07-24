import { describe, expect, test } from "bun:test";
import { parseAgentOutput } from "@outbound/contracts/product-research";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

describe("research agent contracts", () => {
  test("accepts a sourced output for every agent stage", () => {
    for (const stage of [
      "product_analysis",
      "competitor_discovery",
      "competitor_analysis",
      "segment_synthesis",
      "icp_synthesis",
      "evidence_review",
    ] as const) {
      expect(parseAgentOutput(stage, validOutputFor(stage))).toBeDefined();
    }
  });

  test("rejects an unsupported product claim without an explicit evidence decision", () => {
    const output = validOutputFor("product_analysis") as Record<string, unknown>;
    output.valuePropositions = [
      {
        statement: "Unsupported market claim",
        confidence: 0.9,
        evidenceIds: [],
        hypothesis: false,
      },
    ];
    expect(() => parseAgentOutput("product_analysis", output)).toThrow();
  });
});
