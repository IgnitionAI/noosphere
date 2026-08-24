import { describe, expect, test } from "bun:test";
import { evaluateProspectMemorySetterQuality } from "@outbound/application/prospect-memory/prospect-memory-setter-quality-evaluation";

describe("Prospect 360 Setter quality evaluation", () => {
  test("passes only a fully traced, violation-free labelled corpus", () => {
    const labels = Array.from({ length: 100 }, (_, index) => ({
      commandId: `command-${index}`,
      commitments: [{ id: `commitment-${index}`, recalled: index !== 99 }],
      criticalViolations: [],
      unjustifiedRepetition: false,
    }));
    const result = evaluateProspectMemorySetterQuality({
      minimumCaseCount: 100,
      labels,
      commands: labels.map((label, index) => ({
        commandId: label.commandId,
        executionMode: "dry_run",
        status: "generated",
        generationMetadata: { aiRunId: `run-${index}`, memoryReceiptId: `receipt-${index}` },
      })),
    });
    expect(result.commitmentRecallRate).toBe(0.99);
    expect(result.unjustifiedRepetitionRate).toBe(0);
    expect(result.qualityGatePassed).toBe(true);
  });

  test("fails closed on an untraced command, a critical violation or the one-percent repetition boundary", () => {
    const result = evaluateProspectMemorySetterQuality({
      minimumCaseCount: 2,
      labels: [
        { commandId: "missing-trace", commitments: [{ id: "c1", recalled: true }], criticalViolations: [], unjustifiedRepetition: false },
        { commandId: "unsafe", commitments: [{ id: "c2", recalled: false }], criticalViolations: ["invented_commitment"], unjustifiedRepetition: true },
      ],
      commands: [
        { commandId: "missing-trace", executionMode: "dry_run", status: "generated", generationMetadata: {} },
        { commandId: "unsafe", executionMode: "dry_run", status: "generated", generationMetadata: { aiRunId: "run", memoryReceiptId: "receipt" } },
      ],
    });
    expect(result.invalidCaseCount).toBe(1);
    expect(result.criticalViolationCount).toBe(1);
    expect(result.qualityGatePassed).toBe(false);
  });
});
