import { describe, expect, test } from "bun:test";
import { validateRevisionGates } from "@outbound/infrastructure/knowledge/postgres-embedding-revision-manager";

const passingGates = {
  bilingualRetrievalPassed: true,
  recallAt10Passed: true,
  ndcgAt10Passed: true,
  p95Ms: 1_499,
  memoryPercent: 79.9,
  oomCount: 0,
  blockedWorkerCount: 0,
} as const;

describe("embedding revision activation gates", () => {
  test("accepts a revision only below the latency and memory ceilings", () => {
    expect(() => validateRevisionGates(passingGates)).not.toThrow();
  });

  test.each([
    [{ ...passingGates, bilingualRetrievalPassed: false }, "EMBEDDING_QUALITY_GATE_FAILED"],
    [{ ...passingGates, recallAt10Passed: false }, "EMBEDDING_QUALITY_GATE_FAILED"],
    [{ ...passingGates, ndcgAt10Passed: false }, "EMBEDDING_QUALITY_GATE_FAILED"],
    [{ ...passingGates, p95Ms: 1_501 }, "EMBEDDING_LATENCY_GATE_FAILED"],
    [{ ...passingGates, memoryPercent: 80 }, "EMBEDDING_MEMORY_GATE_FAILED"],
    [{ ...passingGates, oomCount: 1 }, "EMBEDDING_STABILITY_GATE_FAILED"],
    [{ ...passingGates, blockedWorkerCount: 1 }, "EMBEDDING_STABILITY_GATE_FAILED"],
  ] as const)("rejects an invalid activation gate", (gates, error) => {
    expect(() => validateRevisionGates(gates)).toThrow(error);
  });
});
