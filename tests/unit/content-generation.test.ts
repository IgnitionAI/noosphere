import { editorialQualityCriteria, type ContentQualityAssessment } from "@outbound/domain/content/content-asset";
import { describe, expect, test } from "bun:test";
import { assertGroundedContentDraft, evaluateContentReadiness } from "@outbound/domain/content/content-asset";
import { ContentGenerationApplication, ContentGenerationJobProcessor, type ContentGenerationRepository } from "@outbound/application/content/content-generation";
import { DEFAULT_CONTENT_BRAND_KIT, selectNextContentFormat } from "@outbound/domain/content/content-brand-kit";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";

describe("CNT-101 grounded content pipeline", () => {
  test("forwards an explicit correlation id to generation persistence", async () => {
    let captured: unknown;
    const repository = {
      async findRequest() { return null; },
      async createGeneration(input: unknown) { captured = input; return {} as never; },
    } as unknown as ContentGenerationRepository;
    const application = new ContentGenerationApplication(repository);
    const correlationId = crypto.randomUUID();

    await application.generate({
      workspaceId: crypto.randomUUID(), userId: crypto.randomUUID(), ideaId: crypto.randomUUID(),
      requestKey: crypto.randomUUID(), correlationId,
    });

    expect(captured).toMatchObject({ correlationId });
  });

  test("keeps synthetic videos out of the default automatic mix", () => {
    expect(DEFAULT_CONTENT_BRAND_KIT.enabledFormats).toEqual(["linkedin_text", "linkedin_image", "linkedin_document"]);
    expect(DEFAULT_CONTENT_BRAND_KIT.weeklyMix.linkedin_video).toBe(0);
  });
  test("rebalances the next format deterministically against the configured weekly mix", () => {
    expect(selectNextContentFormat(DEFAULT_CONTENT_BRAND_KIT, ["linkedin_text", "linkedin_text", "linkedin_image"])).toBe("linkedin_document");
    expect(selectNextContentFormat({ ...DEFAULT_CONTENT_BRAND_KIT, enabledFormats: ["linkedin_image"], weeklyMix: { linkedin_text: 0, linkedin_image: 7, linkedin_document: 0, linkedin_video: 0 } }, [])).toBe("linkedin_image");
  });
  test.each([true, false])("preserves the editorial format when enabled and rejects it otherwise (enabled: %s)", async (enabled) => {
    const original = pipelineContext("writer");
    const context = { ...original, run: { ...original.run, stage: "brief" as const },
      brandKit: { ...DEFAULT_CONTENT_BRAND_KIT, enabledFormats: enabled ? ["linkedin_text", "linkedin_document"] : ["linkedin_document"], weeklyMix: { linkedin_text: 1, linkedin_image: 0, linkedin_document: 3, linkedin_video: 0 } },
      recentFormats: ["linkedin_text", "linkedin_text"],
    };
    const saved: unknown[] = [];
    const received: unknown[] = [];
    const repository = { async loadContext() { return context; }, async startRun() {},
      async saveBrief(input: { brief: unknown }) { saved.push(input.brief); },
      async saveDraft() {}, async saveAudit() {}, async completeRun() {}, async failRun() {},
    } as unknown as ContentGenerationRepository;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { return brief(); },
      async write(input) { received.push(input.brief); return draft(); },
      async audit() { return audit(); }, async critique() { return critique(); },
    }, { async acknowledge() {} } as unknown as JobQueue);
    const processing = processor.process(job(context.run.workspaceId, context.run.id));
    if (enabled) await processing;
    else await expect(processing).rejects.toThrow("CONTENT_BRIEF_FORMAT_DISABLED");
    expect(saved).toEqual(enabled ? [brief()] : []);
    expect(received).toEqual(enabled ? [brief()] : []);
  });
  test("rejects a number that is absent from the sourced claim ledger", () => {
    expect(() => assertGroundedContentDraft({ ...draft(), body: `${draft().body} 42% des équipes y arrivent.` }, ["proof:1"])).toThrow("CONTENT_DRAFT_UNSOURCED_NUMBER");
  });
  test.each([
    { name: "ordered branch labels", labels: ["BRANCHE 1", "BRANCHE 2"], extra: "", valid: true },
    { name: "ordered step labels", labels: ["Étape 1", "Étape 2"], extra: "", valid: true },
    { name: "skipped branch", labels: ["BRANCHE 1", "BRANCHE 3"], extra: "", valid: false },
    { name: "percent in a label", labels: ["BRANCHE 1%", "BRANCHE 2"], extra: "", valid: false },
    { name: "unrelated labels", labels: ["CLIENT 1", "CLIENT 2"], extra: "", valid: false },
    { name: "metric beside valid labels", labels: ["BRANCHE 1", "BRANCHE 2"], extra: "42% de réponses correctes.", valid: false },
  ])("distinguishes carousel navigation from claims: $name", ({ labels, extra, valid }) => {
    const candidate = { ...draft(), mediaPlan: { format: "linkedin_document" as const, visualTone: "editorial" as const,
      title: "Choisir le contrôle", subtitle: null, altText: "Une comparaison", scenes: [],
      slides: labels.map((kicker) => ({ title: "Une observation", kicker, body: "Examiner la procédure.", items: [{ label: "Résultat", text: extra }] })),
    } };
    if (valid) expect(() => assertGroundedContentDraft(candidate, ["proof:1"])).not.toThrow();
    else expect(() => assertGroundedContentDraft(candidate, ["proof:1"])).toThrow("CONTENT_DRAFT_UNSOURCED_NUMBER");
  });

  test("rejects a factual ledger detached from the actual post", () => {
    expect(() => assertGroundedContentDraft({ ...draft(), factualClaims: [{ statement: "Une promesse absente du texte.", sourceKeys: ["proof:1"] }] }, ["proof:1"])).toThrow("CONTENT_DRAFT_CLAIM_NOT_IN_BODY");
  });

  test("blocks a draft claim that the evidence auditor silently skipped", () => {
    const readiness = evaluateContentReadiness({ draft: draft(), audit: { ...audit(), reviewedClaims: [] }, critique: critique(), availableEvidenceKeys: ["proof:1"], recentBodies: [] });
    expect(readiness).toEqual({ ready: false, blockers: ["unaudited_claim"] });
  });

  test("blocks generic copy even when the model critique incorrectly passes it", () => {
    const readiness = evaluateContentReadiness({
      draft: { ...draft(), body: "Dans un monde en constante évolution, voici une analyse précise qui part du problème réel des équipes juridiques. Noosphere relie le contenu aux conversations." },
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("generic_language");
  });

  test("blocks internal evidence-audit narration from leaking into the visible post", () => {
    const readiness = evaluateContentReadiness({
      draft: {
        ...draft(),
        body: "Ce qui est documenté : Noosphere relie le contenu aux conversations. Notre analyse ne constitue pas une garantie. La seule affirmation factuelle est celle du registre de preuves.",
      },
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("audit_language");
  });

  test("blocks an overlong LinkedIn post before publication", () => {
    const readiness = evaluateContentReadiness({
      draft: {
        ...draft(),
        body: `${draft().body} ${"Une décision utile part d’un problème précis et se termine par une action claire. ".repeat(24)}`,
      },
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("too_long");
  });

  test("blocks a post that asks the reader to answer multiple questions", () => {
    const readiness = evaluateContentReadiness({
      draft: {
        ...draft(),
        body: "Pourquoi perdre une preuve au moment de décider ? Noosphere relie le contenu aux conversations. Comment vérifiez-vous vos preuves ?",
      },
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("multiple_questions");
  });

  test("blocks a near-duplicate of a recent workspace post even when the critic misses it", () => {
    const readiness = evaluateContentReadiness({
      draft: draft(),
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [
        "Une clause introuvable coûte plus qu'une recherche. Les équipes juridiques ont besoin d'une preuve résoluble avant de décider. Noosphere relie le contenu aux conversations. Échangeons.",
      ],
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("repetition");
  });

  test("allows a distinct angle to reuse the same grounded product claim", () => {
    const readiness = evaluateContentReadiness({
      draft: draft(),
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [
        "Publier ne suffit pas à créer une opportunité commerciale. Une équipe doit savoir relier un signal social à la bonne personne, puis garder le contexte quand la discussion commence. Noosphere relie le contenu aux conversations.",
      ],
    });

    expect(readiness).toEqual({ ready: true, blockers: [] });
  });

  test("keeps editorial polish advice non-blocking", () => {
    const readiness = evaluateContentReadiness({
      draft: draft(),
      audit: audit(),
      critique: {
        ...critique(),
        genericPhrases: ["D'où la seule question qui compte vraiment"],
        issues: [{ severity: "advice", code: "mild_rhetorical_inflation", message: "Retirer cette emphase rendrait le texte plus sobre." }],
      },
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    });

    expect(readiness).toEqual({ ready: true, blockers: [] });
  });

  test("accepts a sourced factual claim when the auditor wraps it in editorial context and also reviews opinions", () => {
    const readiness = evaluateContentReadiness({
      draft: draft(),
      audit: {
        ...audit(),
        reviewedClaims: [
          {
            statement: `Ce qui est documenté : ${draft().factualClaims[0]!.statement}`,
            sourceKeys: ["proof:1"],
            verdict: "supported",
            reason: "La preuve reprend explicitement le claim.",
          },
          {
            statement: draft().opinionStatements[0]!,
            sourceKeys: [],
            verdict: "supported",
            reason: "Cette phrase est explicitement une opinion.",
          },
        ],
      },
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    });

    expect(readiness).toEqual({ ready: true, blockers: [] });
  });

  test("repairs one deterministically rejected writer draft with explicit feedback", async () => {
    const calls: string[] = [];
    const feedback: Array<readonly string[] | undefined> = [];
    const context = pipelineContext("writer");
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async saveDraft() { calls.push("draft_saved"); },
      async saveAudit() { calls.push("audit_saved"); },
      async completeRun() { calls.push("ready"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    let writerAttempt = 0;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) {
        feedback.push(input.validationFeedback);
        writerAttempt += 1;
        return writerAttempt === 1 ? { ...draft(), body: `${draft().body} 42% des équipes y arrivent.` } : draft();
      },
      async audit() { calls.push("audit"); return audit(); },
      async critique() { calls.push("critic"); return critique(); },
    }, queue);

    await processor.process(job(context.run.workspaceId, context.run.id));

    expect(feedback).toEqual([undefined, ["CONTENT_DRAFT_UNSOURCED_NUMBER"]]);
    expect(calls).toEqual(["start", "draft_saved", "audit", "audit_saved", "critic", "ready", "ack"]);
  });

  test("resumes from the audit checkpoint and acknowledges only after an immutable version is finalized", async () => {
    const calls: string[] = [];
    const context = pipelineContext("audit");
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write() { throw new Error("writer must not replay"); },
      async audit() { calls.push("audit"); return audit(); },
      async critique() { calls.push("critic"); return critique(); },
    }, queue);
    await processor.process(job(context.run.workspaceId, context.run.id));
    expect(calls).toEqual(["start", "audit", "audit_saved", "critic", "ready", "ack"]);
  });

  test("repairs a repeatedly audit-rejected draft with a bounded second pass before the critic sees it", async () => {
    const calls: string[] = [];
    const feedback: Array<readonly string[] | undefined> = [];
    const context = pipelineContext("audit");
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async reviseDraftAfterAudit() { calls.push("draft_repaired"); },
      async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    let auditAttempt = 0;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { calls.push("writer_repair"); feedback.push(input.validationFeedback); return draft(); },
      async audit() {
        calls.push("audit");
        auditAttempt += 1;
        return auditAttempt <= 2
          ? { ...audit(), ungroundedStatements: [`Le hook factuel manque au registre (audit ${auditAttempt}).`] }
          : audit();
      },
      async critique() { calls.push("critic"); return critique(); },
    }, queue);

    await processor.process(job(context.run.workspaceId, context.run.id));

    expect(feedback).toEqual([
      ["CONTENT_AUDIT_UNGROUNDED_STATEMENT: Le hook factuel manque au registre (audit 1)."],
      ["CONTENT_AUDIT_UNGROUNDED_STATEMENT: Le hook factuel manque au registre (audit 2)."],
    ]);
    expect(calls).toEqual(["start", "audit", "writer_repair", "draft_repaired", "audit", "writer_repair", "draft_repaired", "audit", "audit_saved", "critic", "ready", "ack"]);
  });

  test.each(["issue", "assessment"] as const)("repairs a critic rejection from %s and re-audits before readiness", async (kind) => {
    const calls: string[] = [];
    const feedback: Array<readonly string[] | undefined> = [];
    const context = pipelineContext("audit");
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async reviseDraftAfterCritique() { calls.push("draft_repaired_after_critique"); },
      async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    let criticAttempt = 0;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { calls.push("writer_repair"); feedback.push(input.validationFeedback); return draft(); },
      async audit() { calls.push("audit"); return audit(); },
      async critique() {
        calls.push("critic");
        criticAttempt += 1;
        return criticAttempt === 1
          ? kind === "issue"
            ? { ...critique(), issues: [{ severity: "blocker" as const, code: "META_FRAMING_LABELS", message: "Supprimer le méta-discours et écrire le fait directement." }] }
            : { ...critique(), qualityAssessment: { ...critique().qualityAssessment, readerValue: { verdict: "revise" as const, reason: "Expliquer une décision concrète que le lecteur peut prendre.", excerpts: ["Noosphere relie le contenu aux conversations."] } } }
          : critique();
      },
    }, queue);

    await processor.process(job(context.run.workspaceId, context.run.id));

    expect(feedback).toEqual(kind === "issue"
      ? [["CONTENT_CRITIQUE_BLOCKER [META_FRAMING_LABELS]: Supprimer le méta-discours et écrire le fait directement."]]
      : [["CONTENT_CRITIQUE_BLOCKER [readerValue]: Expliquer une décision concrète que le lecteur peut prendre.", "CONTENT_READINESS_BLOCKER: editorial_readerValue"]]);
    expect(calls).toEqual(["start", "audit", "audit_saved", "critic", "writer_repair", "draft_repaired_after_critique", "audit", "audit_saved", "critic", "ready", "ack"]);
  });

  test("preserves editorial feedback when a repair itself needs deterministic correction", async () => {
    const calls: string[] = [];
    const feedback: Array<readonly string[] | undefined> = [];
    const context = pipelineContext("audit");
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async reviseDraftAfterCritique() { calls.push("draft_repaired_after_critique"); },
      async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    let criticAttempt = 0;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { calls.push("writer_repair"); feedback.push(input.validationFeedback); return feedback.length === 1 ? { ...draft(), body: draft().body + " Gain de 42%." } : draft(); },
      async audit() { calls.push("audit"); return audit(); },
      async critique() {
        calls.push("critic");
        criticAttempt += 1;
        return criticAttempt === 1
          ? { ...critique(), qualityAssessment: { ...critique().qualityAssessment, readerValue: { verdict: "revise" as const, reason: "Expliquer une décision concrète que le lecteur peut prendre.", excerpts: ["Noosphere relie le contenu aux conversations."] } } }
          : critique();
      },
    }, queue);

    await processor.process(job(context.run.workspaceId, context.run.id));

    expect(feedback).toHaveLength(2);
    expect(feedback[0]).toContain("CONTENT_CRITIQUE_BLOCKER [readerValue]: Expliquer une décision concrète que le lecteur peut prendre.");
    expect(feedback[1]).toEqual([...feedback[0]!, "CONTENT_DRAFT_UNSOURCED_NUMBER"]);
    expect(calls).toContain("ready");
  });

  test.each([false, true])("repairs the rejected scenario candidate without checkpointing invalid copy (still invalid: %s)", async (stillInvalid) => {
    const context = pipelineContext("audit");
    const invalid = { ...draft(), body: draft().body + " Exemple fictif : le portail est inaccessible.", illustrativeScenarios: ["Exemple fictif : le réseau est inaccessible."] };
    const repaired = { ...invalid, illustrativeScenarios: ["Exemple fictif : le portail est inaccessible."] };
    const candidates: unknown[] = [];
    const saved: unknown[] = [];
    const feedback: Array<readonly string[] | undefined> = [];
    let audits = 0;
    const repository = {
      async loadContext() { return context; }, async startRun() {},
      async reviseDraftAfterAudit(input: { draft: unknown }) { saved.push(input.draft); },
      async saveAudit() {}, async completeRun() {}, async failRun() {},
    } as unknown as ContentGenerationRepository;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { candidates.push(input.draft); feedback.push(input.validationFeedback); return candidates.length === 1 || stillInvalid ? invalid : repaired; },
      async audit() { audits += 1; return audits === 1 ? { ...audit(), ungroundedStatements: ["Clarifier le scénario."] } : { ...audit(), reviewedScenarios: [{ statement: repaired.illustrativeScenarios[0]!, verdict: "hypothetical" as const, reason: "Entrée fictive sans promesse." }] }; },
      async critique() { return critique(); },
    }, { async acknowledge() {} } as unknown as JobQueue);
    const processing = processor.process(job(context.run.workspaceId, context.run.id));
    if (stillInvalid) await expect(processing).rejects.toThrow("CONTENT_DRAFT_SCENARIO_INVALID");
    else await processing;
    expect(candidates).toEqual([context.draft, invalid]);
    expect(feedback[1]).toEqual([...feedback[0]!, "CONTENT_DRAFT_SCENARIO_INVALID"]);
    expect(saved).toEqual(stillInvalid ? [] : [repaired]);
    expect(audits).toBe(stillInvalid ? 1 : 2);
  });

  test("retains corrected attribution feedback when a later critique requests a better demonstration", async () => {
    const base = pipelineContext("audit");
    const context = { ...base, run: { ...base.run, stage: "critic" as const }, audit: audit() };
    const feedback: Array<readonly string[]> = [];
    let critiques = 0;
    const repository = { async loadContext() { return context; }, async startRun() {},
      async reviseDraftAfterCritique() {}, async saveAudit() {}, async completeRun() {},
    } as unknown as ContentGenerationRepository;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("must not replay"); },
      async write(input) { feedback.push(input.validationFeedback ?? []); return draft(); },
      async audit() { return audit(); },
      async critique() {
        critiques++;
        return critiques <= 2 ? { ...critique(), issues: [{ severity: "blocker" as const,
          code: critiques === 1 ? "missing_source_attribution" : "missing_demonstration",
          message: critiques === 1 ? "Keep a visible source attribution." : "Show the discriminating observation." }] } : critique();
      },
    }, { async acknowledge() {} } as unknown as JobQueue);
    await processor.process(job(context.run.workspaceId, context.run.id));
    expect(feedback).toHaveLength(2);
    expect(feedback[1]).toEqual(expect.arrayContaining(feedback[0]!));
    expect(feedback[1]!.some((item) => item.includes("missing_demonstration"))).toBe(true);
    expect(critiques).toBe(3);
  });

  test.each(["repaired", "persistent", "storage"])("handles media overflow with bounded audited repairs: %s", async (outcome) => {
    const original = pipelineContext("audit");
    const candidate = { ...draft(), mediaPlan: { format: "linkedin_document" as const, visualTone: "editorial" as const,
      title: "Retrouver une preuve", subtitle: null, altText: "Examiner les preuves", scenes: [],
      slides: Array.from({ length: 3 }, () => ({ title: "Retrouver une preuve", body: "Examiner les preuves disponibles." })),
    } };
    const context = { ...original, run: { ...original.run, stage: "critic" as const },
      brief: { ...brief(), format: "linkedin_document" as const }, draft: candidate, audit: audit() };
    const calls: string[] = [];
    const feedback: unknown[] = [];
    let completed: { readiness: { ready: boolean; blockers: readonly string[] }; media: unknown } | undefined;
    const repository = { async loadContext() { return context; }, async startRun() {},
      async reviseDraftAfterCritique() { calls.push("saved"); }, async saveAudit() {},
      async completeRun(input: typeof completed) { completed = input; }, async failRun() {},
    } as unknown as ContentGenerationRepository;
    let renders = 0;
    const producer = { async produce() {
      calls.push("render"); renders++;
      if (outcome === "storage") throw new Error("STORAGE_UNAVAILABLE");
      if (renders === 1 || outcome === "persistent") throw new Error("CONTENT_MEDIA_TEXT_OVERFLOW");
      return { marker: "complete media" };
    } } as unknown as import("@outbound/application/content/content-media").ContentMediaProducer;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("must not replay"); },
      async write(input) { calls.push("write"); feedback.push(input.validationFeedback); return candidate; },
      async audit() { calls.push("audit"); return audit(); },
      async critique() { calls.push("critic"); return critique(); },
    }, { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue, () => new Date(), producer);
    const processing = processor.process(job(context.run.workspaceId, context.run.id));
    if (outcome === "storage") {
      await expect(processing).rejects.toThrow("STORAGE_UNAVAILABLE");
      expect(completed).toBeUndefined(); expect(feedback).toEqual([]); return;
    }
    await processing;
    const repairs = outcome === "repaired" ? 1 : 2;
    expect(feedback).toEqual(Array.from({ length: repairs }, () => ["CONTENT_READINESS_BLOCKER: media_text_overflow"]));
    expect(calls).toEqual(["critic", "render", ...Array.from({ length: repairs }, () => ["write", "saved", "audit", "critic", "render"]).flat(), "ack"]);
    expect(completed?.readiness).toEqual(outcome === "repaired" ? { ready: true, blockers: [] } : { ready: false, blockers: ["media_text_overflow"] });
    expect(completed?.media).toEqual(outcome === "repaired" ? { marker: "complete media" } : null);
  });

  test("repairs a removable forbidden topic before the final critic", async () => {
    const calls: string[] = [];
    const feedback: Array<readonly string[] | undefined> = [];
    const context = pipelineContext("audit");
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async reviseDraftAfterAudit() { calls.push("draft_repaired"); },
      async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    let auditAttempt = 0;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { calls.push("writer_repair"); feedback.push(input.validationFeedback); return draft(); },
      async audit() {
        calls.push("audit");
        auditAttempt += 1;
        return auditAttempt === 1
          ? { ...audit(), forbiddenTopicMatches: ["Capacité produit non sourcée"] }
          : audit();
      },
      async critique() { calls.push("critic"); return critique(); },
    }, queue);

    await processor.process(job(context.run.workspaceId, context.run.id));

    expect(feedback).toEqual([["CONTENT_AUDIT_FORBIDDEN_TOPIC: Capacité produit non sourcée"]]);
    expect(calls).toEqual(["start", "audit", "writer_repair", "draft_repaired", "audit", "audit_saved", "critic", "ready", "ack"]);
  });
});

function draft() { return { hook: "Une clause introuvable coûte plus qu’une recherche.", body: "Une clause introuvable coûte plus qu’une recherche. Les équipes juridiques ont besoin d’une preuve résoluble avant de décider. Noosphere relie le contenu aux conversations.", callToAction: "Comment vérifiez-vous vos preuves ?", factualClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: ["proof:1"] }], opinionStatements: ["Une clause introuvable coûte plus qu’une recherche."] }; }
function audit() { return { reviewedClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: ["proof:1"], verdict: "supported" as const, reason: "La source le dit explicitement." }], ungroundedStatements: [], forbiddenTopicMatches: [] }; }
function critique() { return { qualityAssessment: Object.fromEntries(editorialQualityCriteria.map((key) => [key, { verdict: "pass", reason: "Fixture assessment for the content pipeline orchestration test.", excerpts: ["Noosphere relie le contenu aux conversations."] }])) as unknown as ContentQualityAssessment, genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Texte spécifique, étayé et aligné." }; }
function brief() { return { objective: "explain" as const, audience: "Équipes juridiques", problem: "Les preuves sont dispersées dans les dossiers juridiques.", angle: "Relier une recherche documentaire à une décision commerciale.", format: "linkedin_text" as const, evidenceKeys: ["proof:1"], allowedClaimIds: [], callToAction: "Comment vérifiez-vous vos preuves ?", constraints: ["Aucun fait sans preuve"] }; }
function pipelineContext(stage: "writer" | "audit") { const workspaceId = crypto.randomUUID(); const runId = crypto.randomUUID(); return { run: { id: runId, workspaceId, ideaId: crypto.randomUUID(), assetId: crypto.randomUUID(), assetVersionId: null, status: "running" as const, stage, instruction: null, lastErrorCode: null, lastErrorMessage: null, createdAt: new Date(), completedAt: null }, idea: { id: crypto.randomUUID(), workspaceId, strategyVersionId: crypto.randomUUID(), status: "briefed" as const, angle: "Recherche documentaire prouvée", rationale: "Un angle précis pour les juristes.", audience: "Équipes juridiques", pillar: "Recherche", priority: 90, freshnessUntil: new Date(Date.now() + 60_000), firstSeenAt: new Date(), lastSeenAt: new Date(), sources: [evidence()] }, strategy: { audience: { name: "Équipes juridiques", summary: "Juristes avec des preuves dispersées", awareness: "problem_aware" as const }, pillars: [{ name: "Recherche", promise: "Retrouver les preuves", proofTypes: ["claim"] }, { name: "Sécurité", promise: "Contrôler", proofTypes: ["audit"] }, { name: "Adoption", promise: "Déployer", proofTypes: ["chronologie"] }], voice: { traits: ["direct", "précis"], avoid: ["générique"] }, formats: ["linkedin_text" as const], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Comment vérifiez-vous vos preuves ?"], allowedClaimIds: [], forbiddenTopics: [] }, evidence: [evidence()], recentBodies: [], brief: brief(), draft: stage === "audit" ? draft() : null, audit: null, critique: null }; }
function evidence() { return { key: "proof:1", type: "public_web" as const, sourceRef: "https://example.com", canonicalUrl: "https://example.com", title: "Preuve", excerpt: "Noosphere relie le contenu aux conversations.", contentHash: "proof", collectedAt: new Date() }; }
function job(workspaceId: string, runId: string): LeasedJob { const now = new Date(); return { id: crypto.randomUUID(), workspaceId, type: "content.asset.generate", payload: { runId }, idempotencyKey: "content", correlationId: "content:test", attempts: 1, maxAttempts: 4, availableAt: now, lockedBy: "worker", lockedUntil: new Date(now.getTime() + 60_000) }; }

test("quota pause preserves the writing checkpoint even on the last processing attempt", async () => {
  const { AiTaskPauseError } = await import("@outbound/application/ai/ai-task-pause");
  const { ModelGatewayError } = await import("@outbound/application/ai/model-gateway");
  const context = pipelineContext("writer");
  const failure = new AiTaskPauseError(new ModelGatewayError("AI_PROVIDER_QUOTA_EXHAUSTED", "openai-api", "quota", true, false), "content_writer", "write", []);
  let failed = 0;
  const repository = { async loadContext() { return context; }, async startRun() {}, async failRun() { failed++; } } as unknown as ContentGenerationRepository;
  const processor = new ContentGenerationJobProcessor(repository, {
    async buildBrief() { throw new Error("completed brief must not replay"); }, async write() { throw failure; },
    async audit() { throw new Error("must not advance"); }, async critique() { throw new Error("must not advance"); },
  }, {} as JobQueue);
  const leased = job(context.run.workspaceId, context.run.id);
  await expect(processor.process({ ...leased, attempts: leased.maxAttempts })).rejects.toBe(failure);
  expect(failed).toBe(0);
  expect(context.run.stage).toBe("writer");
});

test("an invalid critic assessment blocks without rewriting the post to match invented citations", async () => {
  const context = pipelineContext("audit");
  let result: unknown;
  const repository = {
    async loadContext() { return context; }, async startRun() {}, async saveAudit() {}, async failRun() {},
    async completeRun(input: unknown) { result = input; },
  } as unknown as ContentGenerationRepository;
  const processor = new ContentGenerationJobProcessor(repository, {
    async buildBrief() { throw new Error("must not rebuild"); },
    async write() { throw new Error("must not rewrite due to a critic citation error"); },
    async audit() { return audit(); },
    async critique() { return { ...critique(), qualityAssessment: { ...critique().qualityAssessment, brandVoice: { verdict: "revise" as const, reason: "A prior draft contains inappropriate language requiring changes.", excerpts: ["This passage is absent from the current post."] } } }; },
  }, { async acknowledge() {} } as unknown as JobQueue);
  await processor.process(job(context.run.workspaceId, context.run.id));
  expect(result).toMatchObject({ readiness: { ready: false, blockers: expect.arrayContaining(["editorial_assessment_invalid"]) } });
});
