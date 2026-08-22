import { describe, expect, test } from "bun:test";
import { DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";
import { LangChainContentBrandDirectionDesigner } from "@outbound/infrastructure/content/langchain-content-brand-direction-designer";

describe("LangChainContentBrandDirectionDesigner", () => {
  test("rejects an inaccessible palette, retries, and records the validated proposal", async () => {
    const attempts: number[] = [];
    const runs: unknown[] = [];
    const designer = new LangChainContentBrandDirectionDesigner({
      AI_PROVIDER: "kimi-code",
      KIMI_CODE_API_KEY: "test-key",
      KIMI_RESEARCH_MODEL: "k3",
    }, undefined, {
      async record(input) { runs.push(input); return { id: crypto.randomUUID() }; },
    }, async (input) => {
      attempts.push(input.attempt);
      if (input.attempt === 1) return {
        colors: { primary: "#FFFFFF", accent: "#F8F8F8", background: "#FFFFFF", text: "#EEEEEE" },
        typography: "inter",
        imageStyle: "minimal",
        rationale: "Une palette volontairement invalide pour vérifier la reprise bornée.",
      };
      expect(input.validationIssues.length).toBeGreaterThan(0);
      return {
        colors: DEFAULT_CONTENT_BRAND_KIT.colors,
        typography: "space_grotesk",
        imageStyle: "technical",
        rationale: "Le bleu porte l’expertise, tandis que l’accent vert rend les signaux immédiatement visibles.",
      };
    });

    const result = await designer.design({
      workspaceId: crypto.randomUUID(),
      brand: DEFAULT_CONTENT_BRAND_KIT,
      landingPage: null,
      description: "Une plateforme experte, technique et accessible pour les entreprises.",
      sources: ["description"],
    });
    expect(attempts).toEqual([1, 2]);
    expect(result.colors).toEqual(DEFAULT_CONTENT_BRAND_KIT.colors);
    expect(result.metadata).toMatchObject({ provider: "kimi-code", model: "k3", promptVersion: "noosphere-brand-direction-v1" });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ purpose: "content_brand_direction", status: "completed" });
  });
});
