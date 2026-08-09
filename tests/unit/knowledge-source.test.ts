import { describe, expect, test } from "bun:test";
import {
  assertKnowledgeContentHasNoProspectPii,
  assertKnowledgeSourceCanBeValidated,
  deriveKnowledgeClaimStatus,
  transitionKnowledgeSource,
} from "@outbound/domain/knowledge/knowledge-source";

const now = new Date("2026-08-09T12:00:00.000Z");

describe("F-050 knowledge source lifecycle", () => {
  test("allows only draft to validated then validated to expired or withdrawn", () => {
    expect(transitionKnowledgeSource("draft", "validate")).toBe("validated");
    expect(transitionKnowledgeSource("validated", "expire")).toBe("expired");
    expect(transitionKnowledgeSource("validated", "withdraw")).toBe("withdrawn");
    expect(() => transitionKnowledgeSource("draft", "withdraw")).toThrow("KNOWLEDGE_SOURCE_TRANSITION_INVALID");
    expect(() => transitionKnowledgeSource("withdrawn", "validate")).toThrow("KNOWLEDGE_SOURCE_TRANSITION_INVALID");
  });

  test("rejects validation when freshness is missing or already elapsed", () => {
    expect(() => assertKnowledgeSourceCanBeValidated({ freshnessUntil: null, now })).toThrow("KNOWLEDGE_FRESHNESS_REQUIRED");
    expect(() => assertKnowledgeSourceCanBeValidated({ freshnessUntil: now, now })).toThrow("KNOWLEDGE_SOURCE_ALREADY_EXPIRED");
    expect(() => assertKnowledgeSourceCanBeValidated({ freshnessUntil: new Date("2026-08-10T12:00:00.000Z"), now })).not.toThrow();
  });

  test("derives re-sourcing when no validated fresh source remains", () => {
    expect(deriveKnowledgeClaimStatus("validated", [{ status: "validated", freshnessUntil: new Date("2026-08-10T00:00:00.000Z") }], now)).toBe("validated");
    expect(deriveKnowledgeClaimStatus("validated", [{ status: "validated", freshnessUntil: new Date("2026-08-09T11:59:59.000Z") }], now)).toBe("needs_resourcing");
    expect(deriveKnowledgeClaimStatus("draft", [{ status: "validated", freshnessUntil: new Date("2026-08-10T00:00:00.000Z") }], now)).toBe("draft");
  });

  test("rejects prospect contact data before persistence", () => {
    expect(() => assertKnowledgeContentHasNoProspectPii("Contacter alice@example.com pour le dossier")).toThrow("KNOWLEDGE_PROSPECT_PII_DETECTED");
    expect(() => assertKnowledgeContentHasNoProspectPii("Profil https://linkedin.com/in/alice-martin")).toThrow("KNOWLEDGE_PROSPECT_PII_DETECTED");
    expect(() => assertKnowledgeContentHasNoProspectPii("Notre SLA est de 99,9 % et le déploiement prend 3 semaines.")).not.toThrow();
  });
});
