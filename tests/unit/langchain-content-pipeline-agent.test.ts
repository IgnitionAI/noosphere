import { contentAuditDeclarations } from "@outbound/infrastructure/content/content-audit-declarations";
import { contentDraftSnapshotSchema } from "@outbound/contracts/content";
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
        return { output: input.capability === "content_critic" ? modelCritique(input.payload, output as ReturnType<typeof critique>) : input.capability === "content_audit" ? modelAudit(input.payload) : output, metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
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

  test.each(["linkedin_text", "linkedin_image", "linkedin_document", "linkedin_video"] as const)("restricts generated media to its requested format: %s", async format => {
    const plan = { format, visualTone: "editorial" as const, title: format === "linkedin_text" ? null : "Contrôler les droits",
      subtitle: null, altText: format === "linkedin_text" ? null : "Vérifier les documents autorisés.",
      slides: format === "linkedin_document" ? Array.from({ length: 3 }, () => ({ title: "Vérifier", body: "Comparer les permissions." })) : [],
      scenes: format === "linkedin_video" ? Array.from({ length: 3 }, () => ({ title: "Vérifier", body: "Comparer les permissions.", durationSeconds: 4 })) : [],
    };
    const candidate = { ...draft(), mediaPlan: plan };
    const routedModel = { async invoke(input: { schema: z.ZodType }) {
      expect(input.schema.safeParse(candidate).success).toBe(true);
      expect(input.schema.safeParse(draft()).success).toBe(false);
      const otherFormat = format === "linkedin_text" ? "linkedin_image" : "linkedin_text";
      expect(input.schema.safeParse({ ...candidate, mediaPlan: { ...plan, format: otherFormat } }).success).toBe(false);
      const invalid = format === "linkedin_document" ? { ...plan, slides: plan.slides.slice(0, 2) }
        : format === "linkedin_video" ? { ...plan, scenes: plan.scenes.slice(0, 2) }
        : { ...plan, slides: [{ title: "Vérifier", body: "Comparer les permissions." }] };
      expect(input.schema.safeParse({ ...candidate, mediaPlan: invalid }).success).toBe(false);
      return { output: candidate, metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
    } } as unknown as WorkspaceStructuredModel;
    await new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routedModel).write({ ...pipelineContext(), brief: { ...brief(), format } });
  });

  test("still reads historical text drafts without a media plan", () => {
    expect(contentDraftSnapshotSchema.parse(draft()).mediaPlan).toMatchObject({ format: "linkedin_text", title: null, altText: null, slides: [], scenes: [] });
  });

  test("requires document metadata in the model schema on initial writing and repair", async () => {
    const document = { ...draft(), mediaPlan: { format: "linkedin_document" as const, visualTone: "editorial" as const,
      title: "Contrôler les droits", subtitle: null, altText: "Trois pages sur le contrôle des droits.", scenes: [],
      slides: Array.from({ length: 3 }, () => ({ title: "Vérifier", body: "Comparer les permissions." })),
    } };
    let calls = 0;
    const routedModel = { async invoke(input: { schema: z.ZodType }) {
      calls++;
      expect(input.schema.safeParse(document).success).toBe(true);
      for (const field of ["title", "altText"] as const) {
        expect(input.schema.safeParse({ ...document, mediaPlan: { ...document.mediaPlan, [field]: null } }).success).toBe(false);
      }
      expect(input.schema.safeParse({ ...document, mediaPlan: { ...document.mediaPlan, format: "linkedin_text" } }).success).toBe(false);
      expect(input.schema.safeParse({ ...document, mediaPlan: { ...document.mediaPlan, slides: [] } }).success).toBe(false);
      return { output: document, metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
    } } as unknown as WorkspaceStructuredModel;
    const agent = new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routedModel);
    const context = { ...pipelineContext(), brief: { ...brief(), format: "linkedin_document" as const } };
    await agent.write(context);
    await agent.write({ ...context, draft: document, validationFeedback: ["CONTENT_DRAFT_UNSOURCED_NUMBER"] });
    expect(calls).toBe(2);
  });

  test("supplies document layout limits on first writing and later editorial repairs", async () => {
    const payloads: unknown[] = [];
    const routedModel = { async invoke(input: { payload: unknown }) {
      payloads.push(input.payload);
      return { output: draft(), metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
    } } as unknown as WorkspaceStructuredModel;
    const agent = new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routedModel);
    const context = { ...pipelineContext(), brief: { ...brief(), format: "linkedin_document" as const } };
    await agent.write(context);
    await agent.write({ ...context, draft: draft(), audit: audit(), validationFeedback: ["CONTENT_CRITIQUE_BLOCKER: Complete the explanation."] });
    for (const payload of payloads) expect(payload).toMatchObject({ mediaLayoutConstraints: { layouts: {
      cover: { kicker: { maxCharactersPerLine: 24, maxLines: 1 } },
      closing: { body: { maxCharactersPerLine: 34, maxLines: 5 }, callout: { maxCharactersPerLine: 32, maxLines: 2 } },
    } } });
    await agent.write({ ...context, brief: { ...brief(), format: "linkedin_text" } });
    expect(payloads[2]).not.toHaveProperty("mediaLayoutConstraints");
  });

  test("guides complete short posts while preserving oversized drafts for application repair", async () => {
    let requestedSchema: z.ZodType | undefined;
    const oversized = { ...draft(), body: "a".repeat(1_501), mediaPlan: { format: "linkedin_text", visualTone: "editorial", title: null, subtitle: null, altText: null, slides: [], scenes: [] } };
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
      { purpose: "content_brief", model: "kimi-for-coding-highspeed", promptVersion: "noosphere-content-brief-v11", contentGenerationRunId: context.run.id },
      { purpose: "content_writer", model: "k3", promptVersion: "noosphere-content-writer-v31", contentGenerationRunId: context.run.id },
      { purpose: "content_audit", model: "kimi-for-coding-highspeed", promptVersion: "noosphere-content-audit-v11", contentGenerationRunId: context.run.id },
      { purpose: "content_critic", model: "k3", promptVersion: "noosphere-content-critic-v21", contentGenerationRunId: context.run.id },
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

test("repairs only missing claim metadata while preserving every other draft field", async () => {
  const original = contentDraftSnapshotSchema.parse(draft());
  const statement = original.body;
  const sourceKey = pipelineContext().evidence[0]!.key;
  const routed = { async invoke(input: any) {
    expect(input.payload.claimStatements).toEqual([{ id: "s1", statement }]);
    expect(input.schema.safeParse({ reviews: [{ statementId: "s1", sourceKeys: [sourceKey], supported: true, reason: "The supplied evidence supports this passage." }], body: "changed" }).success).toBe(false);
    return { output: { reviews: [{ statementId: "s1", sourceKeys: [sourceKey], supported: true, reason: "The supplied evidence supports this passage." }] }, metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
  } } as unknown as WorkspaceStructuredModel;
  const result = await new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).write({ ...pipelineContext(), brief: brief(), draft: original,
    audit: { ...audit(), ungroundedStatements: [statement] }, repairMode: "claim_ledger" });
  expect(result).toEqual({ ...original, factualClaims: [...original.factualClaims, { statement, sourceKeys: [sourceKey] }] });
});

test("keeps unsupported ledger statements unchanged and rejects invalid review selections", async () => {
  const original = contentDraftSnapshotSchema.parse(draft());
  const statements = [original.hook, original.body];
  const key = pipelineContext().evidence[0]!.key;
  const reviews = statements.map((_, i) => ({ statementId: `s${i + 1}`, sourceKeys: [] as string[], supported: false, reason: "No supplied evidence supports this statement." }));
  const invokeWith = async (output: unknown) => {
    const routed = { async invoke() { return { output, metadata: {provider: "codex-cli", model: "gpt-5.6-luna"} }; } } as unknown as WorkspaceStructuredModel;
    return new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).write({ ...pipelineContext(), brief: brief(), draft: original, audit: { ...audit(), ungroundedStatements: statements }, repairMode: "claim_ledger" });
  };
  expect(await invokeWith({reviews})).toEqual(original);
  for (const invalid of [
    { reviews: [reviews[0], reviews[0]] },
    { reviews: [reviews[0]] },
    { reviews: [{ ...reviews[0], statementId: "s99" }, reviews[1]] },
    { reviews: [{ ...reviews[0], supported: true, sourceKeys: ["invented:key"] }, reviews[1]] },
    { reviews: [{ ...reviews[0], supported: true }, reviews[1]] },
    { reviews: [{ ...reviews[0], sourceKeys: [key] }, reviews[1]] },
    { reviews, illustrativeScenarios: ["rewritten"] },
  ]) await expect(invokeWith(invalid)).rejects.toThrow();
});

test("requires an audit assessment for every public field and retains unsupported media findings", async () => {
  const context = pipelineContext();
  const candidate = { ...contentDraftSnapshotSchema.parse(draft()), mediaPlan: { format: "linkedin_image" as const, visualTone: "editorial" as const, title: "Tous les clients gagnent un contrat.", subtitle: null, altText: "Titre du visuel", slides: [], scenes: [] } };
  let wire: any;
  const routed = { async invoke(input: any) {
    expect(input.payload.publicPassages.map((p: any) => p.field)).toEqual(["body", "mediaPlan.title"]);
    wire = { passageReviews: [
      { passageId: "body", classification: "mixed", nonFactualReason: "The opening expresses the author's point of view.", claims: audit().reviewedClaims.map(c => ({...c, kind: "factual" as const})) },
      { passageId: "mediaPlan.title", classification: "factual", nonFactualReason: null, claims: [{ statement: candidate.mediaPlan.title, sourceKeys: [], kind: "factual", verdict: "unsupported", reason: "No supplied evidence establishes this guaranteed outcome." }] },
    ], declarationReviews: declaredReviews(candidate), reviewedScenarios: [], forbiddenTopicMatches: [] };
    return { output: wire, metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
  } } as unknown as WorkspaceStructuredModel;
  const result = await new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).audit({ ...context, brief: brief(), draft: candidate });
  expect(result.reviewedClaims).toContainEqual(expect.objectContaining({statement: candidate.mediaPlan.title, verdict: "unsupported"}));
  expect(result.coverage?.passages.map(p => p.field)).toEqual(["body", "mediaPlan.title"]);
  expect(result.coverage?.passages[1]?.text).toBe(candidate.mediaPlan.title);
});

function modelAudit(payload: unknown) {
  const passages = (payload as {publicPassages: Array<{id: string; text: string}>}).publicPassages;
  return {passageReviews: passages.map(p => {
    const claims = audit().reviewedClaims.map(c => ({...c, kind: "factual" as const})).filter(c => p.text.includes(c.statement));
    return {passageId: p.id, classification: claims.length ? "mixed" : "non_factual", nonFactualReason: "The remaining wording expresses editorial context rather than factual assertions.", claims};
  }), declarationReviews: declaredReviews((payload as {draft: ReturnType<typeof draft>}).draft), reviewedScenarios: [], forbiddenTopicMatches: []};
}

test("re-audits corrected copy without presenting the previous audit as current evidence", async () => {
  const previous = { ...audit(), ungroundedStatements: ["La vérification utile comporte deux niveaux :"] };
  const context = { ...pipelineContext(), brief: brief(), draft: contentDraftSnapshotSchema.parse(draft()), audit: previous };
  const routed = { async invoke(input: { payload: unknown }) {
    expect(input.payload).not.toHaveProperty("audit");
    expect(input.payload).toMatchObject({ draft: context.draft, evidence: context.evidence });
    expect(JSON.stringify(input.payload)).not.toContain("La vérification utile comporte deux niveaux :");
    return { output: modelAudit(input.payload), metadata: { provider: "codex-cli", model: "gpt-5.6-luna" } };
  } } as unknown as WorkspaceStructuredModel;
  await new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).audit(context);
  expect(context.audit).toEqual(previous);
});

test("exposes consistent factual classifications in the provider schema", async () => {
  const candidate = contentDraftSnapshotSchema.parse(draft());
  const routed = { async invoke(input: {schema: z.ZodType; payload: unknown}) {
    const valid = modelAudit(input.payload);
    const review = valid.passageReviews[0]!;
    const assess = (replacement: unknown) => input.schema.safeParse({...valid, passageReviews: [replacement]}).success;
    expect(assess(review)).toBe(true);
    expect(assess({...review, classification: "mixed", claims: []})).toBe(false);
    expect(assess({...review, classification: "factual", claims: [], nonFactualReason: null})).toBe(false);
    expect(assess({...review, classification: "factual", nonFactualReason: null})).toBe(true);
    expect(assess({...review, classification: "factual"})).toBe(false);
    expect(assess({...review, classification: "non_factual"})).toBe(false);
    expect(assess({...review, classification: "non_factual", claims: []})).toBe(true);
    expect(assess({...review, classification: "non_factual", claims: [], nonFactualReason: null})).toBe(false);
    return {output: valid, metadata: {provider: "codex-cli", model: "gpt-5.6-luna"}};
  }} as unknown as WorkspaceStructuredModel;
  await new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).audit({...pipelineContext(), brief: brief(), draft: candidate});
});

test("rejects missing, duplicated, invented or ungrounded audit coverage", async () => {
  const context = pipelineContext();
  const candidate = contentDraftSnapshotSchema.parse(draft());
  const valid = { passageReviews: [{passageId: "body", classification: "mixed", nonFactualReason: "The opening expresses a personal point of view.", claims: audit().reviewedClaims.map(c => ({...c, kind: "factual" as const}))}], declarationReviews: declaredReviews(candidate), reviewedScenarios: [], forbiddenTopicMatches: [] };
  const review = valid.passageReviews[0]!;
  const factual = review.claims[0]!;
  for (const output of [
    {...valid, passageReviews: []},
    {...valid, passageReviews: [review, review]},
    {...valid, passageReviews: [{...review, passageId: "p99"}]},
    {...valid, passageReviews: [{...review, claims: [{...factual, statement: "A claim from a previous unrelated draft."}]}]},
    {...valid, passageReviews: [{...review, claims: [{...factual, sourceKeys: ["invented:key"]}]}]},
    {...valid, passageReviews: [{...review, claims: [{...factual, sourceKeys: []}]}]},
    {...valid, passageReviews: [{...review, classification: "non_factual"}]},
    {...valid, passageReviews: [{...review, classification: "factual"}]},
    {...valid, passageReviews: [{...review, claims: []}]},
  ]) {
    const routed = { async invoke() { return {output, metadata: {provider: "codex-cli", model: "gpt-5.6-luna"}}; } } as unknown as WorkspaceStructuredModel;
    await expect(new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).audit({...context, brief: brief(), draft: candidate})).rejects.toThrow();
  }
});

test("retains opposing audit verdicts for the same statement repeated in two public fields", async () => {
  const statement = draft().factualClaims[0]!.statement;
  const candidate = { ...contentDraftSnapshotSchema.parse(draft()), mediaPlan: {format: "linkedin_image" as const, visualTone: "editorial" as const, title: statement, subtitle: null, altText: "A simple title", slides: [], scenes: []} };
  const negative = {...audit().reviewedClaims[0]!, kind: "factual", verdict: "unsupported" as const, reason: "This repeated standalone wording loses necessary context."};
  const routed = { async invoke() { return {output: {
    passageReviews: [
      {passageId: "body", classification: "mixed", nonFactualReason: "The opening expresses a personal point of view.", claims: audit().reviewedClaims.map(c => ({...c, kind: "factual" as const}))},
      {passageId: "mediaPlan.title", classification: "factual", nonFactualReason: null, claims: [negative]},
    ], declarationReviews: declaredReviews(candidate), reviewedScenarios: [], forbiddenTopicMatches: [],
  }, metadata: {provider: "codex-cli", model: "gpt-5.6-luna"}}; } } as unknown as WorkspaceStructuredModel;
  const result = await new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).audit({...pipelineContext(), brief: brief(), draft: candidate});
  expect(result.reviewedClaims).toHaveLength(2);
  expect(result.reviewedClaims).toContainEqual(expect.objectContaining({statement: negative.statement, verdict: "unsupported"}));
});

test("records verified bibliographic attribution without inventing a missing substantive claim", async () => {
  const credit = "Source : Guide documentaire";
  const candidate = {...contentDraftSnapshotSchema.parse(draft()), mediaPlan: {format: "linkedin_image" as const, visualTone: "editorial" as const, title: credit, subtitle: null, altText: credit, slides: [], scenes: []}};
  const routed = {async invoke() {return {output: {passageReviews: [
    {passageId: "body", classification: "mixed", nonFactualReason: "The opening expresses a personal point of view.", claims: audit().reviewedClaims.map(c => ({...c, kind: "factual" as const}))},
    {passageId: "mediaPlan.title", classification: "factual", nonFactualReason: null, claims: [{statement: credit, kind: "attribution", verdict: "supported", sourceKeys: ["proof:1"], reason: "The source title identifies the cited guide."}]},
  ], declarationReviews: declaredReviews(candidate), reviewedScenarios: [], forbiddenTopicMatches: []}, metadata: {provider: "codex-cli", model: "gpt-5.6-luna"}};}} as unknown as WorkspaceStructuredModel;
  const result = await new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).audit({...pipelineContext(), brief: brief(), draft: candidate});
  expect(result.ungroundedStatements).toEqual([]);
  expect(result.coverage?.passages[1]?.claims[0]?.kind).toBe("attribution");
});

test("audits source-free proposed advice while prohibiting invented evidence keys", async () => {
  const candidate = {...contentDraftSnapshotSchema.parse(draft()), body: "Je propose de commencer par un cas simple et de noter les questions qui restent ouvertes avant de poursuivre.", factualClaims: []};
  const output = {passageReviews: [{passageId: "body", classification: "non_factual", nonFactualReason: "This passage proposes an approach without claiming a measured result.", claims: []}], declarationReviews: declaredReviews(candidate), reviewedScenarios: [], forbiddenTopicMatches: []};
  const routed = {async invoke(input: any) {
    expect(input.schema.safeParse({...output, passageReviews: [{...output.passageReviews[0], classification: "factual", nonFactualReason: null, claims: [{statement: candidate.body, kind: "factual", verdict: "supported", sourceKeys: ["invented:key"], reason: "An invented source must be rejected."}]}]}).success).toBe(false);
    return {output, metadata: {provider: "codex-cli", model: "gpt-5.6-luna"}};
  }} as unknown as WorkspaceStructuredModel;
  const result = await new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).audit({...pipelineContext(), evidence: [], brief: brief(), draft: candidate});
  expect(result.reviewedClaims).toEqual([]);
  expect(result.coverage?.passages).toHaveLength(1);
});

test.each([{count: 21, existing: 0}, {count: 31, existing: 20}])("rejects aggregate audit overflow explicitly without dropping findings: %j", async ({count, existing}) => {
  const claims = Array.from({length: count}, (_, i) => ({statement: `F${i + 1}.`, kind: "factual" as const, sourceKeys: ["proof:1"], verdict: "unsupported" as const, reason: "The source does not establish this assertion."}));
  const split = Math.ceil(count / 2);
  const candidate = {...contentDraftSnapshotSchema.parse(draft()), body: "The following claims all require independent review. " + claims.slice(0, split).map(c => c.statement).join(" "), factualClaims: claims.slice(0, existing).map(c => ({statement: c.statement, sourceKeys: c.sourceKeys})), mediaPlan: {format: "linkedin_image" as const, visualTone: "editorial" as const, title: claims.slice(split).map(c => c.statement).join(" "), subtitle: null, altText: "Claim list", slides: [], scenes: []}};
  const output = {passageReviews: [
    {passageId: "body", classification: "mixed", nonFactualReason: "The introductory wording provides context for the claims.", claims: claims.slice(0, split)},
    {passageId: "mediaPlan.title", classification: "factual", nonFactualReason: null, claims: claims.slice(split)},
  ], declarationReviews: declaredReviews(candidate), reviewedScenarios: [], forbiddenTopicMatches: []};
  const routed = {async invoke(input: any) {
    expect(input.schema.safeParse(output).success).toBe(true);
    return {output, metadata: {provider: "codex-cli", model: "gpt-5.6-luna"}};
  }} as unknown as WorkspaceStructuredModel;
  await expect(new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).audit({...pipelineContext(), brief: brief(), draft: candidate})).rejects.toThrow("CONTENT_AUDIT_CAPACITY_EXCEEDED");
});

test.each(["duplicate", "cross_field"])("rejects %s field assignments even when the response count and source keys are valid", async failure => {
  const candidate = {...contentDraftSnapshotSchema.parse(draft()), mediaPlan: {format: "linkedin_image" as const, visualTone: "editorial" as const, title: "Un titre propre au visuel.", subtitle: null, altText: "Le titre", slides: [], scenes: []}};
  const first = {passageId: "body", classification: "mixed", nonFactualReason: "The opening expresses a personal point of view.", claims: audit().reviewedClaims.map(c => ({...c, kind: "factual" as const}))};
  const second = {passageId: "mediaPlan.title", classification: "factual", nonFactualReason: null, claims: [{statement: candidate.mediaPlan.title, kind: "factual", sourceKeys: ["proof:1"], verdict: "supported", reason: "This title is reviewed in its own media context."}]};
  const output = {passageReviews: failure === "duplicate" ? [first, first] : [{...first, claims: second.claims}, second], declarationReviews: declaredReviews(candidate), reviewedScenarios: [], forbiddenTopicMatches: []};
  const routed = {async invoke(input: any) {
    expect(input.schema.safeParse(output).success).toBe(true);
    return {output, metadata: {provider: "codex-cli", model: "gpt-5.6-luna"}};
  }} as unknown as WorkspaceStructuredModel;
  await expect(new LangChainContentPipelineAgent({}, undefined, undefined, undefined, routed).audit({...pipelineContext(), brief: brief(), draft: candidate})).rejects.toThrow("CONTENT_AUDIT_COVERAGE_INVALID");
});

// Synthetic verdicts for transport/coverage tests, not semantic source-verification evidence.
function declaredReviews(candidate: Parameters<typeof contentAuditDeclarations>[0]) {
  return Object.fromEntries(contentAuditDeclarations(candidate).map(item => [item.id, {kind: "factual" as const, sourceKeys: item.claimedSourceKeys, verdict: "supported" as const, reason: "Synthetic declaration assessment for the model-contract fixture."}]));
}
