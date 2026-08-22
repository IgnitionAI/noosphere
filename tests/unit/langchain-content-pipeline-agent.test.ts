import { describe, expect, test } from "bun:test";
import { LangChainContentPipelineAgent } from "@outbound/infrastructure/content/langchain-content-pipeline-agent";
import type { ContentGenerationContext } from "@outbound/application/content/content-generation";
import { DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";

describe("LangChainContentPipelineAgent", () => {
  test("reserves K3 max reasoning for writing and critique and records every bounded stage", async () => {
    const invocations: Array<{ role: string; model: unknown; effort: unknown }> = [];
    const recorded: Array<{ purpose: string; model: string; promptVersion: string; contentGenerationRunId?: string }> = [];
    const context = pipelineContext();
    const agent = new LangChainContentPipelineAgent(
      { AI_PROVIDER: "kimi-code", KIMI_CODE_API_KEY: "test-key" },
      { async find() { return { researchModels: ["k3"], synthesisModels: ["kimi-for-coding-highspeed"] }; } },
      { async record(input) { recorded.push(input); return { id: crypto.randomUUID() }; } },
      async ({ role, fields }) => {
        invocations.push({ role, model: fields?.model, effort: fields?.reasoning?.effort });
        return role === "brief" ? brief() : role === "writer" ? draft() : role === "audit" ? audit() : critique();
      },
    );

    const briefResult = await agent.buildBrief(context);
    const draftResult = await agent.write({ ...context, brief: briefResult });
    const auditResult = await agent.audit({ ...context, brief: briefResult, draft: draftResult });
    await agent.critique({ ...context, brief: briefResult, draft: draftResult, audit: auditResult });

    expect(invocations).toEqual([
      { role: "brief", model: "kimi-for-coding-highspeed", effort: "low" },
      { role: "writer", model: "k3", effort: "max" },
      { role: "audit", model: "kimi-for-coding-highspeed", effort: "low" },
      { role: "critic", model: "k3", effort: "max" },
    ]);
    expect(recorded.map(({ purpose, model, promptVersion, contentGenerationRunId }) => ({ purpose, model, promptVersion, contentGenerationRunId }))).toEqual([
      { purpose: "content_brief", model: "kimi-for-coding-highspeed", promptVersion: "noosphere-content-brief-v2", contentGenerationRunId: context.run.id },
      { purpose: "content_writer", model: "k3", promptVersion: "noosphere-content-writer-v4", contentGenerationRunId: context.run.id },
      { purpose: "content_audit", model: "kimi-for-coding-highspeed", promptVersion: "noosphere-content-audit-v2", contentGenerationRunId: context.run.id },
      { purpose: "content_critic", model: "k3", promptVersion: "noosphere-content-critic-v3", contentGenerationRunId: context.run.id },
    ]);
  });
});

function pipelineContext(): ContentGenerationContext {
  const workspaceId = crypto.randomUUID();
  const now = new Date("2026-08-20T09:00:00.000Z");
  return {
    run: { id: crypto.randomUUID(), workspaceId, ideaId: crypto.randomUUID(), assetId: crypto.randomUUID(), assetVersionId: null, status: "running", stage: "brief", instruction: null, lastErrorCode: null, lastErrorMessage: null, createdAt: now, completedAt: null },
    idea: { id: crypto.randomUUID(), workspaceId, strategyVersionId: crypto.randomUUID(), status: "discovered", angle: "Pourquoi une preuve documentaire change une décision juridique", rationale: "Un problème observable relié à une preuve résoluble.", audience: "Équipes juridiques", pillar: "Recherche", priority: 90, freshnessUntil: now, firstSeenAt: now, lastSeenAt: now, sources: [evidence(now)] },
    strategy: { audience: { name: "Équipes juridiques", summary: "Juristes avec des preuves dispersées", awareness: "problem_aware" }, pillars: [{ name: "Recherche", promise: "Retrouver les preuves", proofTypes: ["claim"] }, { name: "Sécurité", promise: "Contrôler", proofTypes: ["audit"] }, { name: "Adoption", promise: "Déployer", proofTypes: ["chronologie"] }], voice: { traits: ["direct", "précis"], avoid: ["générique"] }, formats: ["linkedin_text"], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Comment vérifiez-vous vos preuves ?"], allowedClaimIds: [], forbiddenTopics: [] },
    brandKit: DEFAULT_CONTENT_BRAND_KIT,
    evidence: [evidence(now)], recentBodies: [], recentFormats: [], brief: null, draft: null, audit: null, critique: null,
  };
}

function evidence(now: Date) { return { key: "proof:1", type: "public_web" as const, sourceRef: "https://example.com", canonicalUrl: "https://example.com", title: "Preuve", excerpt: "Noosphere relie le contenu aux conversations.", contentHash: "proof", collectedAt: now }; }
function brief() { return { objective: "explain" as const, audience: "Équipes juridiques", problem: "Les preuves sont dispersées dans les dossiers juridiques.", angle: "Relier une recherche documentaire à une décision commerciale.", format: "linkedin_text" as const, evidenceKeys: ["proof:1"], allowedClaimIds: [], callToAction: "Comment vérifiez-vous vos preuves ?", constraints: ["Aucun fait sans preuve"] }; }
function draft() { return { hook: "Une clause introuvable coûte plus qu’une recherche.", body: "Une clause introuvable coûte plus qu’une recherche. Les équipes juridiques ont besoin d’une preuve résoluble avant de décider. Noosphere relie le contenu aux conversations.", callToAction: "Comment vérifiez-vous vos preuves ?", factualClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: ["proof:1"] }], opinionStatements: ["Une clause introuvable coûte plus qu’une recherche."] }; }
function audit() { return { reviewedClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: ["proof:1"], verdict: "supported" as const, reason: "La source le dit explicitement." }], ungroundedStatements: [], forbiddenTopicMatches: [] }; }
function critique() { return { genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Texte spécifique, étayé et aligné." }; }
