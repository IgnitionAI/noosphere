import { describe, expect, test } from "bun:test";
import { evaluateProspectMemoryShadowRuns } from "@outbound/application/prospect-memory/prospect-memory-shadow-evaluation";

describe("Prospect 360 shadow evaluation", () => {
  test("passes the observability gate only with enough measurable PII-free contexts", () => {
    const evaluation = evaluateProspectMemoryShadowRuns({
      minimumContextCount: 2,
      runs: [
        run({ criticalSourceCount: 3, legacyCoveredCriticalSourceCount: 1, memoryOnlyCriticalSourceCount: 2 }),
        run({ criticalSourceCount: 1, legacyCoveredCriticalSourceCount: 1, memoryOnlyCriticalSourceCount: 0 }),
      ],
    });

    expect(evaluation).toMatchObject({
      contextCount: 2,
      measurableContextCount: 2,
      invalidContextCount: 0,
      automaticActionViolationCount: 0,
      contextsWithMemoryOnlyCriticalSources: 1,
      criticalSourceCount: 4,
      legacyCoveredCriticalSourceCount: 2,
      memoryOnlyCriticalSourceCount: 2,
      memoryOnlyCriticalSourceRate: 0.5,
      observabilityGatePassed: true,
      semanticQualityGate: "not_measured",
      capabilityCounts: { setter_campaign: 2 },
    });
  });

  test("fails closed on malformed coverage, an effect-capable context or an undersized corpus", () => {
    const evaluation = evaluateProspectMemoryShadowRuns({
      minimumContextCount: 3,
      runs: [
        run({ automaticActionAllowed: true }),
        { output: { legacyCoverageMeasurable: false }, createdAt: new Date("2026-08-23T10:01:00.000Z") },
      ],
    });

    expect(evaluation).toMatchObject({
      contextCount: 2,
      measurableContextCount: 1,
      invalidContextCount: 1,
      automaticActionViolationCount: 2,
      observabilityGatePassed: false,
    });
  });
});

function run(overrides: Record<string, unknown>) {
  return {
    createdAt: new Date("2026-08-23T10:00:00.000Z"),
    output: {
      capability: "setter_campaign",
      memoryStatus: "fresh",
      automaticActionAllowed: false,
      legacyCoverageMeasurable: true,
      criticalSourceCount: 1,
      legacyCoveredCriticalSourceCount: 0,
      memoryOnlyCriticalSourceCount: 1,
      ...overrides,
    },
  };
}
