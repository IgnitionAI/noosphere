import { describe, expect, test } from "bun:test";

import {
  assertSyntheticEvaluationCase,
  createNextPromptVersion,
  scoreEvaluationOutput,
} from "@outbound/domain/ai/evaluation";
import { evaluationErrorCode } from "@outbound/infrastructure/ai/evaluation-run-processor";

describe("AI-140 continuous evaluation domain", () => {
  test("scores exact outputs and counts claims outside the authorized knowledge set as hallucinations", () => {
    const score = scoreEvaluationOutput({
      actual: { classification: "qualified", ctaPresent: true, knowledgeClaimIds: ["claim-1", "claim-invented"] },
      expected: { classification: "qualified", ctaPresent: true },
      authorizedKnowledgeClaimIds: ["claim-1"],
    });

    expect(score.exactness).toBe(1);
    expect(score.ctaQuality).toBe(1);
    expect(score.messageQuality).toBe(1);
    expect(score.claimCompliance).toBe(0.5);
    expect(score.hallucinationCount).toBe(1);
    expect(score.hallucinationRate).toBe(0.5);
  });

  test("grades message quality from a deterministic rubric and ignores the model self-score", () => {
    const score = scoreEvaluationOutput({
      actual: { content: "Bonjour, voici une démonstration claire.", qualitative: { messageQuality: 1 } },
      expected: {},
      criteria: { minLength: 20, maxLength: 80, requiredTerms: ["démonstration"], forbiddenTerms: ["garanti"] },
      authorizedKnowledgeClaimIds: [],
    });
    expect(score.messageQuality).toBe(1);
    const regression = scoreEvaluationOutput({
      actual: { content: "Résultat garanti", qualitative: { messageQuality: 1 } },
      expected: {},
      criteria: { minLength: 20, requiredTerms: ["démonstration"], forbiddenTerms: ["garanti"] },
      authorizedKnowledgeClaimIds: [],
    });
    expect(regression.messageQuality).toBe(0);
  });

  test("does not let the evaluated output self-grade deterministic metrics", () => {
    const score = scoreEvaluationOutput({
      actual: {
        classification: "unqualified",
        ctaPresent: false,
        knowledgeClaimIds: [],
        score: { exactness: 1, hallucinationRate: 0 },
      },
      expected: { classification: "qualified", ctaPresent: true },
      authorizedKnowledgeClaimIds: [],
    });

    expect(score.exactness).toBe(0);
    expect(score.ctaQuality).toBe(0);
    expect(score.hallucinationRate).toBe(0);
  });

  test("rejects real personal data in evaluation cases", () => {
    expect(() => assertSyntheticEvaluationCase({ input: "Contacte alice@example.com", expected: {} })).toThrow("EVALUATION_CASE_PII_FORBIDDEN");
    expect(() => assertSyntheticEvaluationCase({ input: "Profil https://linkedin.com/in/alice-martin", expected: {} })).toThrow("EVALUATION_CASE_PII_FORBIDDEN");
    expect(() => assertSyntheticEvaluationCase({ input: "Décideur au +33 6 12 34 56 78", expected: {} })).toThrow("EVALUATION_CASE_PII_FORBIDDEN");
    expect(() => assertSyntheticEvaluationCase({ input: "Entreprise Exemple, décideur PERSON_A", expected: { classification: "qualified" } })).not.toThrow();
  });

  test("creates an immutable successor instead of changing the referenced prompt version", () => {
    const current = { id: "prompt-v1", version: 1, content: "Prompt initial", createdAt: new Date("2026-08-01T00:00:00Z") };
    const next = createNextPromptVersion(current, { id: "prompt-v2", content: "Prompt amélioré", createdAt: new Date("2026-08-02T00:00:00Z") });

    expect(next).toEqual({ id: "prompt-v2", version: 2, content: "Prompt amélioré", createdAt: new Date("2026-08-02T00:00:00Z"), previousVersionId: "prompt-v1" });
    expect(current).toEqual({ id: "prompt-v1", version: 1, content: "Prompt initial", createdAt: new Date("2026-08-01T00:00:00Z") });
  });

  test("classifies provider quota and unavailable-model failures with stable retryable codes", () => {
    expect(evaluationErrorCode(Object.assign(new Error("usage limit quota reached"), { status: 403 }))).toBe("MODEL_PROVIDER_QUOTA_EXHAUSTED");
    expect(evaluationErrorCode(Object.assign(new Error("model not found"), { status: 404 }))).toBe("EVALUATION_MODEL_UNAVAILABLE");
    expect(evaluationErrorCode(new Error("network reset"))).toBe("EVALUATION_PROVIDER_ERROR");
  });
});
