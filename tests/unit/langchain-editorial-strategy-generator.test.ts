import { describe, expect, test } from "bun:test";
import { LangChainEditorialStrategyGenerator } from "@outbound/infrastructure/content/langchain-editorial-strategy-generator";
import type { EditorialStrategyGrounding } from "@outbound/application/content/editorial-strategy";

describe("LangChainEditorialStrategyGenerator", () => {
  test("retries one rejected structured output and records only the valid result", async () => {
    const invocations: Array<{ attempt: number; validationIssues: readonly string[] }> = [];
    const recorded: Array<{ status: string; output: unknown; promptVersion: string }> = [];
    const generator = new LangChainEditorialStrategyGenerator(
      { AI_PROVIDER: "kimi-code", KIMI_CODE_API_KEY: "test-key" },
      { async find() { return { researchModels: ["k3"], synthesisModels: ["k3"] }; } },
      { async record(input) { recorded.push(input); return { id: "30000000-0000-4000-8000-000000000001" }; } },
      async ({ attempt, validationIssues }) => {
        invocations.push({ attempt, validationIssues });
        return attempt === 1 ? {} : snapshot();
      },
    );

    const result = await generator.generate({ workspaceId: crypto.randomUUID(), grounding: grounding() });

    expect(invocations).toHaveLength(2);
    expect(invocations[0]).toEqual({ attempt: 1, validationIssues: [] });
    expect(invocations[1]!.validationIssues.length).toBeGreaterThan(0);
    expect(result.snapshot.pillars).toHaveLength(3);
    expect(result.metadata).toMatchObject({ provider: "kimi-code", model: "k3", promptVersion: "noosphere-editorial-strategy-v2" });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ status: "completed", output: snapshot(), promptVersion: "noosphere-editorial-strategy-v2" });
  });

  test("fails with a stable error and a sanitized AI run after the bounded retry", async () => {
    const recorded: Array<{ status: string; output: unknown }> = [];
    const generator = new LangChainEditorialStrategyGenerator(
      { AI_PROVIDER: "kimi-code", KIMI_CODE_API_KEY: "test-key" },
      undefined,
      { async record(input) { recorded.push(input); return { id: crypto.randomUUID() }; } },
      async () => ({ audience: { name: "incomplete" }, secretModelText: "must-not-be-recorded" }),
    );

    await expect(generator.generate({ workspaceId: crypto.randomUUID(), grounding: grounding() }))
      .rejects.toThrow("EDITORIAL_STRATEGY_OUTPUT_INVALID");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.status).toBe("failed");
    expect(JSON.stringify(recorded[0]!.output)).not.toContain("must-not-be-recorded");
  });
});

function grounding(): EditorialStrategyGrounding {
  return {
    offer: {
      id: crypto.randomUUID(), versionId: crypto.randomUUID(), name: "IgnitionRAG", category: "licence",
      valueProposition: "Déployer une IA documentaire isolée pour les connaissances sensibles.",
      targetAudience: "Cabinets juridiques et équipes conformité", pricing: {}, commercialRules: {}, constraints: {}, objections: [],
      claims: [{ id: "30000000-0000-4000-8000-000000000010", claim: "Déploiement isolé", validationStatus: "sourced", evidenceUri: "https://example.test/proof" }],
    },
    icp: {
      id: crypto.randomUUID(), versionId: crypto.randomUUID(), name: "Cabinets juridiques", criteria: {}, buyingCommittee: {},
      problems: ["Les preuves sont dispersées"], signals: [], exclusions: [],
    },
  };
}

function snapshot() {
  return {
    audience: { name: "Cabinets juridiques", summary: "Équipes qui traitent des connaissances sensibles.", awareness: "problem_aware" as const },
    pillars: [
      { name: "Recherche", promise: "Retrouver une preuve", proofTypes: ["source produit"] },
      { name: "Isolation", promise: "Garder le contrôle", proofTypes: ["architecture"] },
      { name: "Adoption", promise: "Déployer sans rupture", proofTypes: ["retour terrain"] },
    ],
    voice: { traits: ["direct", "précis"], avoid: ["générique"] },
    formats: ["linkedin_text" as const],
    cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" },
    callsToAction: ["Comment retrouvez-vous vos preuves ?"],
    allowedClaimIds: ["30000000-0000-4000-8000-000000000010"],
    forbiddenTopics: ["chiffres non sourcés"],
  };
}
