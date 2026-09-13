import { AiTaskPauseError } from "@outbound/application/ai/ai-task-pause";
import { ModelGatewayError } from "@outbound/application/ai/model-gateway";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import { editorialQualityCriteria, type ContentQualityAssessment } from "@outbound/domain/content/content-asset";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
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
        return { output: input.capability === "content_critic" ? modelCritique(input.payload, output as ReturnType<typeof critique>) : output, metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
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

  test("guides complete short posts while preserving oversized drafts for application repair", async () => {
    let requestedSchema: z.ZodType | undefined;
    const oversized = { ...draft(), body: "a".repeat(1_501) };
    const routedModel = {
      async invoke(input: { schema: z.ZodType }) {
        requestedSchema = input.schema;
        return { output: oversized, metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
      },
    } as unknown as WorkspaceStructuredModel;
    const agent = new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routedModel);
    const result = await agent.write({ ...pipelineContext(), brief: brief() });
    const schema = z.toJSONSchema(requestedSchema!);
    const body = schema.properties?.body as { description?: string; maxLength?: number };
    expect(body.description).toContain("500-1100 characters");
    expect(body.description).toContain("at or below 1500 characters");
    expect(body.description).toContain("do not cut words or URLs");
    expect(body.maxLength).toBe(3_000);
    expect(result.body).toBe(oversized.body);
    expect(requestedSchema!.safeParse({ ...oversized, body: "a".repeat(3_000) }).success).toBe(true);
    expect(requestedSchema!.safeParse({ ...oversized, body: "a".repeat(3_001) }).success).toBe(false);
  });

  test.each([false, true])("records a safe timeout trace while preserving the pause error (recorder fails: %s)", async (recorderFails) => {
    const context = pipelineContext();
    const error = new AiTaskPauseError(
      new ModelGatewayError("AI_PROVIDER_TIMEOUT", "codex-cli", "private upstream detail", true, true),
      "content_writer", "writer-test", [{ provider: "codex-cli", model: "gpt-5.6-luna", reasoningEffort: "medium" }],
    );
    const recorded: Parameters<AiRunRecorder["record"]>[0][] = [];
    const agent = new LangChainContentPipelineAgent({}, undefined, {
      async record(input) {
        recorded.push(input);
        if (recorderFails) throw new Error("recorder unavailable");
        return { id: crypto.randomUUID() };
      },
    }, undefined, { async invoke() { throw error; } } as unknown as WorkspaceStructuredModel);
    await expect(agent.write({ ...context, brief: brief() })).rejects.toBe(error);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      workspaceId: context.run.workspaceId, contentGenerationRunId: context.run.id,
      purpose: "content_writer", status: "failed", provider: "codex-cli", model: "gpt-5.6-luna",
      output: { code: "AI_PROVIDER_TIMEOUT" }, cost: null,
    });
    expect(recorded[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(recorded)).not.toContain("private upstream detail");
  });

  test("passes the complete current audit to the writer repair model", async () => {
    const currentAudit = { ...audit(), ungroundedStatements: ["Une conclusion manque au registre."] };
    let payload: unknown;
    const agent = new LangChainContentPipelineAgent(
      { AI_PROVIDER: "kimi-code", KIMI_CODE_API_KEY: "test-key" }, undefined, undefined,
      async ({ context }) => { payload = context; return draft(); },
    );
    await agent.write({ ...pipelineContext(), brief: brief(), draft: draft(), audit: currentAudit,
      validationFeedback: ["CONTENT_AUDIT_UNGROUNDED_STATEMENT: Une conclusion manque au registre."] });
    expect(payload).toMatchObject({ audit: currentAudit, draft: draft() });
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
      { purpose: "content_brief", model: "kimi-for-coding-highspeed", promptVersion: "noosphere-content-brief-v9", contentGenerationRunId: context.run.id },
      { purpose: "content_writer", model: "k3", promptVersion: "noosphere-content-writer-v23", contentGenerationRunId: context.run.id },
      { purpose: "content_audit", model: "kimi-for-coding-highspeed", promptVersion: "noosphere-content-audit-v6", contentGenerationRunId: context.run.id },
      { purpose: "content_critic", model: "k3", promptVersion: "noosphere-content-critic-v18", contentGenerationRunId: context.run.id },
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
  expect(calls[1]!.context).toMatchObject({ currentPublicPassages: expect.arrayContaining([expect.objectContaining({ text: currentDraft.body })]), draft: currentDraft, validationFeedback: [expect.stringContaining("brandVoice")] });
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


test("constrains model citations to exact current public passages without changing revise verdicts", async () => {
  const currentDraft = { ...draft(), body: "Un champ masqué ne filtre pas les résultats.\n\nLe document doit être exclu pour un utilisateur non autorisé." };
  const expected = "Un champ masqué ne filtre pas les résultats.";
  let calls = 0;
  const routedModel = { async invoke(input: any) {
    calls++;
    const candidate = critique();
    candidate.qualityAssessment = Object.fromEntries(editorialQualityCriteria.map(key => [key, {
      verdict: "revise", reason: "Le document répète la distinction sans expliquer une décision nouvelle.", excerpts: [expected],
    }])) as unknown as ContentQualityAssessment;
    const wire = modelCritique(input.payload, candidate);
    expect(input.schema.safeParse(wire).success).toBe(true);
    for (const id of ["p99999", "un champ masqué ne filtre pas les résultats."]) {
      const bad = { ...wire, qualityAssessment: { ...wire.qualityAssessment, readerValue: { ...wire.qualityAssessment.readerValue, passageIds: [id] } } };
      expect(input.schema.safeParse(bad).success).toBe(false);
    }
    expect(input.payload.currentPublicPassages).toContainEqual(expect.objectContaining({ text: expected }));
    return { output: wire, metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
  } } as unknown as WorkspaceStructuredModel;
  const agent = new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routedModel);
  const result = await agent.critique({ ...pipelineContext(), brief: brief(), draft: currentDraft, audit: audit() });
  expect(calls).toBe(1);
  expect(result.qualityAssessment?.readerValue).toMatchObject({ verdict: "revise", excerpts: [expected] });
});


test("keeps multiline short copy and the end of historical long paragraphs citable", async () => {
  for (const body of [
    "Qui lit ?\nQuel rôle ?\nQuel accès ?\nUn compte.\nUn groupe.\nUne règle.\nUn essai.\nUn refus.\nÀ vérifier.",
    "Une longue explication historique. ".repeat(60) + "La décision finale doit rester visible.",
  ]) {
    let calls = 0;
    const routedModel = { async invoke(input: any) {
      calls++;
      const providerSchema = z.toJSONSchema(input.schema);
      const checkEnums = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          if (key === "enum" && Array.isArray(child)) for (const literal of child) expect(String(literal)).not.toContain("\n");
          else checkEnums(child);
        }
      };
      checkEnums(providerSchema);
      const passages = (input.payload.currentPublicPassages as Array<{ id: string; text: string }>).map(p => p.text);
      expect(passages.length).toBeGreaterThan(0);
      const ending = body.includes("La décision finale") ? "La décision finale doit rester visible." : "À vérifier.";
      expect(passages.some(passage => passage.includes(ending))).toBe(true);
      for (const passage of passages) {
        expect(passage.length).toBeGreaterThanOrEqual(12);
        expect(passage.length).toBeLessThanOrEqual(1500);
        expect(body.includes(passage)).toBe(true);
      }
      const candidate = critique();
      candidate.qualityAssessment = Object.fromEntries(editorialQualityCriteria.map(key => [key, {
        verdict: "revise", reason: "Ce passage doit être retravaillé pour démontrer la décision.", excerpts: [passages.at(-1)!],
      }])) as unknown as ContentQualityAssessment;
      return { output: input.schema.parse(modelCritique(input.payload, candidate)), metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
    } } as unknown as WorkspaceStructuredModel;
    const agent = new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routedModel);
    await agent.critique({ ...pipelineContext(), brief: brief(), draft: { ...draft(), body, hook: body.split("\n")[0]!, callToAction: null }, audit: audit() });
    expect(calls).toBe(1);
  }
});


function modelCritique(payload: unknown, candidate: ReturnType<typeof critique>) {
  const passages = (payload as { currentPublicPassages: Array<{ id: string; text: string }> }).currentPublicPassages;
  return { ...candidate, qualityAssessment: Object.fromEntries(Object.entries(candidate.qualityAssessment).map(([key, { excerpts, ...criterion }]) => [key, {
    ...criterion, passageIds: excerpts.map(excerpt => passages.find(p => p.text.includes(excerpt))!.id),
  }])) as Record<string, { verdict: string; reason: string; passageIds: string[] }> };
}
