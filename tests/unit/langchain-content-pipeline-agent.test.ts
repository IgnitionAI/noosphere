import { editorialQualityCriteria, type ContentQualityAssessment } from "@outbound/domain/content/content-asset";
import { describe, expect, test } from "bun:test";
import { LangChainContentPipelineAgent } from "@outbound/infrastructure/content/langchain-content-pipeline-agent";
import type { ContentGenerationContext } from "@outbound/application/content/content-generation";
import { DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";
import type { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

describe("LangChainContentPipelineAgent", () => {
  test("delivers adapted skills to the production model roles without changing the factual auditor", async () => {
    const calls: Array<{ capability: string; systemPrompt: string; payload: unknown }> = [];
    const routedModel = {
      async invoke(input: { capability: string; systemPrompt: string; payload: unknown }) {
        calls.push(input);
        const output = input.capability === "content_brief" ? brief()
          : input.capability === "content_writer" ? draft()
          : input.capability === "content_audit" ? audit() : critique();
        return { output, metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
      },
    } as unknown as WorkspaceStructuredModel;
    const context = pipelineContext();
    const agent = new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routedModel);
    const b = await agent.buildBrief(context);
    const d = await agent.write({ ...context, brief: b });
    const a = await agent.audit({ ...context, brief: b, draft: d });
    await agent.critique({ ...context, brief: b, draft: d, audit: a });
    expect(calls.map(({ systemPrompt }) => ({
      strategy: systemPrompt.includes("# Content strategy"),
      brand: systemPrompt.includes("# Brand and creative review"),
    }))).toEqual([
      { strategy: true, brand: false }, { strategy: true, brand: true },
      { strategy: false, brand: false }, { strategy: false, brand: true },
    ]);
    for (const { systemPrompt, payload } of calls) {
      expect(systemPrompt).not.toMatch(/MMIND|Hartmut|360Brew|Dusty Rose/);
      expect(payload).toMatchObject({ brandKit: context.brandKit });
    }
  });

  test("passes the versioned offer and buyer context to every editorial role", async () => {
    const businessContext = {
      offer: { versionId: "offer-v1", name: "Assistant documentaire", category: "software", valueProposition: "Retrouver une procédure autorisée", targetAudience: "Support", constraints: ["Pas de réponse hors périmètre"], objections: [] },
      icp: { versionId: "icp-v1", name: "Support technique", problems: ["Procédures dispersées"], buyingCommittee: ["Responsable support"], exclusions: [], criteria: {} },
    };
    const context = { ...pipelineContext(), businessContext };
    const payloads: unknown[] = [];
    const agent = new LangChainContentPipelineAgent(
      { AI_PROVIDER: "kimi-code", KIMI_CODE_API_KEY: "test-key" }, undefined, undefined,
      async ({ role, context: payload }) => {
        payloads.push(payload);
        return role === "brief" ? brief() : role === "writer" ? draft() : role === "audit" ? audit() : critique();
      },
    );
    const b = await agent.buildBrief(context);
    const d = await agent.write({ ...context, brief: b });
    const a = await agent.audit({ ...context, brief: b, draft: d });
    await agent.critique({ ...context, brief: b, draft: d, audit: a });
    expect(payloads).toHaveLength(4);
    for (const payload of payloads) expect(payload).toMatchObject({ businessContext });
  });

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
      { purpose: "content_brief", model: "kimi-for-coding-highspeed", promptVersion: "noosphere-content-brief-v8", contentGenerationRunId: context.run.id },
      { purpose: "content_writer", model: "k3", promptVersion: "noosphere-content-writer-v14", contentGenerationRunId: context.run.id },
      { purpose: "content_audit", model: "kimi-for-coding-highspeed", promptVersion: "noosphere-content-audit-v6", contentGenerationRunId: context.run.id },
      { purpose: "content_critic", model: "k3", promptVersion: "noosphere-content-critic-v11", contentGenerationRunId: context.run.id },
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
function critique() { return { qualityAssessment: Object.fromEntries(editorialQualityCriteria.map((key) => [key, { verdict: "pass", reason: "Fixture assessment for the content pipeline orchestration test.", excerpts: ["Noosphere relie le contenu aux conversations."] }])) as unknown as ContentQualityAssessment, genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Texte spécifique, étayé et aligné." }; }

test("repairs stale critic citations against the same draft without invoking the writer", async () => {
  const context = pipelineContext();
  const currentDraft = draft();
  const calls: Array<{ role: string; context: unknown }> = [];
  const invalid = critique();
  invalid.qualityAssessment = { ...invalid.qualityAssessment, brandVoice: { verdict: "pass", reason: "The old version supposedly uses an appropriate voice.", excerpts: ["This excerpt belonged to a previous draft and is absent here."] } };
  const agent = new LangChainContentPipelineAgent({}, undefined, undefined, async input => {
    calls.push(input);
    return calls.length === 1 ? invalid : critique();
  });
  const result = await agent.critique({ ...context, brief: brief(), draft: currentDraft, audit: audit() });
  expect(calls.map(call => call.role)).toEqual(["critic", "critic"]);
  expect(calls[1]!.context).not.toHaveProperty("rejectedAssessment");
  for (const call of calls) {
    expect(call.context).not.toHaveProperty("audit");
    expect(call.context).not.toHaveProperty("brief");
  }
  expect(calls[1]!.context).toMatchObject({ currentPublicPassages: expect.arrayContaining([currentDraft.body]), draft: currentDraft, validationFeedback: [expect.stringContaining("brandVoice")] });
  expect(result.qualityAssessment?.brandVoice.excerpts).toEqual(["Noosphere relie le contenu aux conversations."]);
});

test("bounds citation repair to one retry and preserves an invalid result for the readiness gate", async () => {
  const invalid = critique();
  invalid.qualityAssessment = { ...invalid.qualityAssessment, coherence: { verdict: "pass", reason: "A mistaken review refers to nonexistent text.", excerpts: ["This nonexistent passage must never become approval."] } };
  let calls = 0;
  const agent = new LangChainContentPipelineAgent({}, undefined, undefined, async () => { calls++; return invalid; });
  const result = await agent.critique({ ...pipelineContext(), brief: brief(), draft: draft(), audit: audit() });
  expect(calls).toBe(2);
  expect(result.qualityAssessment?.coherence.excerpts).toEqual([...invalid.qualityAssessment.coherence.excerpts]);
});


test("judges current public work without upstream approval or internal brief instructions", async () => {
  const context = { ...pipelineContext(), brief: brief(), draft: draft(), audit: audit() };
  const calls: Array<{ role: string; context: unknown }> = [];
  const agent = new LangChainContentPipelineAgent({}, undefined, undefined, async input => {
    calls.push(input);
    return input.role === "critic" ? critique() : draft();
  });
  await agent.critique(context);
  await agent.write(context);
  const payload = calls[0]!.context;
  for (const field of ["audit", "brief", "idea", "run", "validationFeedback"]) expect(payload).not.toHaveProperty(field);
  expect(payload).toMatchObject({draft: context.draft, evidence: context.evidence, strategy: {audience: context.strategy.audience, voice: context.strategy.voice}, brandKit: context.brandKit, recentBodies: []});
  expect(payload).not.toHaveProperty("strategy.pillars");
  expect(payload).not.toHaveProperty("strategy.callsToAction");
  expect(calls[1]!.context).toMatchObject({brief: context.brief, audit: context.audit});
});
