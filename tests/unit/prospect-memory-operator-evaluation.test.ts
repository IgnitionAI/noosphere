import { describe, expect, test } from "bun:test";
import {
  evaluateProspectMemoryOperatorComprehension,
  prospectMemoryOperatorQuestionIds,
} from "@outbound/application/prospect-memory/prospect-memory-operator-evaluation";

describe("Prospect 360 operator comprehension gate", () => {
  test("passes at ninety percent with no effect-boundary misconception", () => {
    const result = evaluateProspectMemoryOperatorComprehension([
      {
        participantId: "operator-1",
        answers: prospectMemoryOperatorQuestionIds.map((questionId) => ({
          questionId,
          correct: questionId !== "drawer_closure",
        })),
      },
      {
        participantId: "operator-2",
        answers: prospectMemoryOperatorQuestionIds.map((questionId) => ({ questionId, correct: true })),
      },
    ]);
    expect(result.comprehensionRate).toBe(0.9);
    expect(result.gatePassed).toBe(true);
  });

  test("fails when an operator thinks a dry-run can send", () => {
    const result = evaluateProspectMemoryOperatorComprehension([{
      participantId: "operator-1",
      answers: prospectMemoryOperatorQuestionIds.map((questionId) => ({
        questionId,
        correct: questionId !== "dry_run_effect",
      })),
    }]);
    expect(result.comprehensionRate).toBe(0.8);
    expect(result.criticalMisunderstandingCount).toBe(1);
    expect(result.gatePassed).toBe(false);
  });
});
