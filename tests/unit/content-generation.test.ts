import { fixtureAuditCoverage, fixtureReadinessInput } from "../fixtures/content/audit-coverage";
import type { ContentDraftSnapshot } from "@outbound/domain/content/content-asset";
import { ContentMediaTextOverflowsError, ContentMediaTextOverflowError } from "@outbound/application/content/content-media";
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
      async saveDraft() {}, async checkpointAudit() {}, async saveAudit() {}, async completeRun() {}, async failRun() {},
    } as unknown as ContentGenerationRepository;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { return brief(); },
      async write(input) { received.push(input.brief); return draft(); },
      async audit(input) { return audit(input.draft, input.evidence); }, async critique() { return critique(); },
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

  test.each([
    {labels:["1 — Identité","2 — Résultat"],extra:"",valid:true},
    {labels:["1. Identité","2. Résultat"],extra:"",valid:true},
    {labels:["1 — Identité","3 — Résultat"],extra:"",valid:false},
    {labels:["1 — 42% de réussite","2 — Résultat"],extra:"",valid:false},
    {labels:["1% Identité","2 — Résultat"],extra:"",valid:false},
    {labels:["1 — Identité","2 — Résultat"],extra:"42% de réussite.",valid:false},
  ])("separates ordered item labels from factual numbers: %j", ({labels,extra,valid}) => {
    const candidate={...draft(),mediaPlan:{format:"linkedin_document" as const,visualTone:"editorial" as const,title:"Contrôler",subtitle:null,altText:"Contrôle",scenes:[],
      slides:[{title:"Une procédure",body:"Examiner les éléments.",items:labels.map(label=>({label,text:extra}))}]}};
    if(valid)expect(()=>assertGroundedContentDraft(candidate,["proof:1"])).not.toThrow();
    else expect(()=>assertGroundedContentDraft(candidate,["proof:1"])).toThrow("CONTENT_DRAFT_UNSOURCED_NUMBER");
  });

  test("rejects a factual ledger detached from the actual post", () => {
    expect(() => assertGroundedContentDraft({ ...draft(), factualClaims: [{ statement: "Une promesse absente du texte.", sourceKeys: ["proof:1"] }] }, ["proof:1"])).toThrow("CONTENT_DRAFT_CLAIM_NOT_IN_BODY");
  });

  test("blocks a draft claim that the evidence auditor silently skipped", () => {
    const readiness = evaluateContentReadiness(fixtureReadinessInput({ draft: draft(), audit: { ...audit(), reviewedClaims: [] }, critique: critique(), availableEvidenceKeys: ["proof:1"], recentBodies: [] }));
    expect(readiness).toEqual({ ready: false, blockers: ["unaudited_claim"] });
  });

  test("blocks generic copy even when the model critique incorrectly passes it", () => {
    const readiness = evaluateContentReadiness(fixtureReadinessInput({
      draft: { ...draft(), body: "Dans un monde en constante évolution, voici une analyse précise qui part du problème réel des équipes juridiques. Noosphere relie le contenu aux conversations." },
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    }));
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("generic_language");
  });

  test("blocks internal evidence-audit narration from leaking into the visible post", () => {
    const readiness = evaluateContentReadiness(fixtureReadinessInput({
      draft: {
        ...draft(),
        body: "Ce qui est documenté : Noosphere relie le contenu aux conversations. Notre analyse ne constitue pas une garantie. La seule affirmation factuelle est celle du registre de preuves.",
      },
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    }));

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("audit_language");
  });

  test("blocks an overlong LinkedIn post before publication", () => {
    const readiness = evaluateContentReadiness(fixtureReadinessInput({
      draft: {
        ...draft(),
        body: `${draft().body} ${"Une décision utile part d’un problème précis et se termine par une action claire. ".repeat(24)}`,
      },
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    }));

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("too_long");
  });

  test("blocks a post that asks the reader to answer multiple questions", () => {
    const readiness = evaluateContentReadiness(fixtureReadinessInput({
      draft: {
        ...draft(),
        body: "Pourquoi perdre une preuve au moment de décider ? Noosphere relie le contenu aux conversations. Comment vérifiez-vous vos preuves ?",
      },
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    }));

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("multiple_questions");
  });

  test("blocks a near-duplicate of a recent workspace post even when the critic misses it", () => {
    const readiness = evaluateContentReadiness(fixtureReadinessInput({
      draft: draft(),
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [
        "Une clause introuvable coûte plus qu'une recherche. Les équipes juridiques ont besoin d'une preuve résoluble avant de décider. Noosphere relie le contenu aux conversations. Échangeons.",
      ],
    }));

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("repetition");
  });

  test("allows a distinct angle to reuse the same grounded product claim", () => {
    const readiness = evaluateContentReadiness(fixtureReadinessInput({
      draft: draft(),
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [
        "Publier ne suffit pas à créer une opportunité commerciale. Une équipe doit savoir relier un signal social à la bonne personne, puis garder le contexte quand la discussion commence. Noosphere relie le contenu aux conversations.",
      ],
    }));

    expect(readiness).toEqual({ ready: true, blockers: [] });
  });

  test("keeps editorial polish advice non-blocking", () => {
    const readiness = evaluateContentReadiness(fixtureReadinessInput({
      draft: draft(),
      audit: audit(),
      critique: {
        ...critique(),
        genericPhrases: ["D'où la seule question qui compte vraiment"],
        issues: [{ severity: "advice", code: "mild_rhetorical_inflation", message: "Retirer cette emphase rendrait le texte plus sobre." }],
      },
      availableEvidenceKeys: ["proof:1"],
      recentBodies: [],
    }));

    expect(readiness).toEqual({ ready: true, blockers: [] });
  });

  test("accepts full claim review with literal surrounding context and nonfactual reasoning", () => {
    const candidate = { ...draft(), body: `Ce qui est documenté : ${draft().factualClaims[0]!.statement}` };
    const assessment = { ...audit(), reviewedClaims: [{ statement: candidate.body, sourceKeys: ["proof:1"], verdict: "supported" as const, reason: "La source reprend explicitement le fait cité." }] };
    expect(evaluateContentReadiness(fixtureReadinessInput({ draft: candidate, audit: assessment, critique: critique(), availableEvidenceKeys: ["proof:1"], recentBodies: [] }))).toEqual({ready: true, blockers: []});
  });

  test("repairs one deterministically rejected writer draft with explicit feedback", async () => {
    const calls: string[] = [];
    const feedback: Array<readonly string[] | undefined> = [];
    const context = pipelineContext("writer");
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async saveDraft() { calls.push("draft_saved"); },
      async checkpointAudit() {}, async saveAudit() { calls.push("audit_saved"); },
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
      async audit(input) { calls.push("audit"); return audit(input.draft, input.evidence); },
      async critique() { calls.push("critic"); return critique(); },
    }, queue);

    await processor.process(job(context.run.workspaceId, context.run.id));

    expect(feedback).toEqual([undefined, [expect.stringContaining("CONTENT_DRAFT_UNSOURCED_NUMBER: body: 42.")]]);
    expect(calls).toEqual(["start", "draft_saved", "audit", "audit_saved", "critic", "ready", "ack"]);
  });

  test.each([false, true])("checks document fit before audit or checkpoint (persistent: %s)", async persistent => {
    const candidate = {...draft(), mediaPlan: {format: "linkedin_document" as const, visualTone: "editorial" as const,
      title: "Une distinction", subtitle: null, altText: "Un contrôle expliqué", scenes: [],
      slides: Array.from({length: 3}, () => ({title: "Un contrôle", body: "Examiner les preuves."}))}};
    const context = {...pipelineContext("writer"), brief: {...brief(), format: "linkedin_document" as const}};
    const calls: string[] = [];
    const received: (readonly string[])[] = [];
    let checks = 0;
    const repository = {async loadContext(){return context;}, async startRun(){},
      async saveDraft(){calls.push("save");},async checkpointAudit() {}, async saveAudit(){},async completeRun(){},async failRun(){}} as unknown as ContentGenerationRepository;
    const producer = {async checkDraftLayout(){calls.push("layout"); if (++checks === 1 || persistent) throw new ContentMediaTextOverflowError(2, "comparison");},
      async produce(){calls.push("store");return {marker:"validated"};}} as unknown as import("@outbound/application/content/content-media").ContentMediaProducer;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief(){return context.brief;},async write(input){calls.push("write");received.push(input.validationFeedback ?? []);return candidate;},
      async audit(input) {calls.push("audit");return audit(input.draft, input.evidence);},async critique(){calls.push("critic");return critique();}
    },{async acknowledge(){}} as unknown as JobQueue,()=>new Date(),producer);
    const processing = processor.process(job(context.run.workspaceId,context.run.id));
    if (persistent) await expect(processing).rejects.toThrow("CONTENT_MEDIA_TEXT_OVERFLOW"); else await processing;
    expect(calls).toEqual(persistent ? ["write","layout","write","layout"] : ["write","layout","write","layout","save","audit","critic","store"]);
    expect(received[1]!.join(" ")).toContain("media_text_overflow on slide 2 (comparison)");
  });

  test.each([false, true])("checks writer length before persistence and audit (persistent: %s)", async persistent => {
    const context = pipelineContext("writer");
    const oversized = {...draft(), body: draft().body.padEnd(1581, "x")};
    const inputs: any[] = [], saved: any[] = [], audited: any[] = [];
    const repository = {
      async loadContext() {return context;}, async startRun() {},
      async saveDraft(input: any) {saved.push(input.draft);},
      async checkpointAudit() {}, async saveAudit() {}, async completeRun() {}, async failRun() {},
    } as unknown as ContentGenerationRepository;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() {return brief();},
      async write(input) {inputs.push(input); return inputs.length === 1 || persistent ? oversized : draft();},
      async audit(input) {audited.push(input.draft); return audit(input.draft, input.evidence);},
      async critique() {return critique();},
    }, {async acknowledge() {}} as unknown as JobQueue);
    const processing = processor.process(job(context.run.workspaceId, context.run.id));
    if (persistent) await expect(processing).rejects.toThrow("CONTENT_DRAFT_TOO_LONG");
    else await processing;
    expect(inputs).toHaveLength(2);
    expect(inputs[1].draft).toEqual(oversized);
    expect(inputs[1].validationFeedback.join(" ")).toContain("1581");
    expect(inputs[1].validationFeedback.join(" ")).toContain("1500");
    expect(saved).toEqual(persistent ? [] : [draft()]);
    expect(audited).toEqual(persistent ? [] : [draft()]);
  });

  test("resumes from the audit checkpoint and acknowledges only after an immutable version is finalized", async () => {
    const calls: string[] = [];
    const context = pipelineContext("audit");
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async checkpointAudit() {}, async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write() { throw new Error("writer must not replay"); },
      async audit(input) { calls.push("audit"); return audit(input.draft, input.evidence); },
      async critique() { calls.push("critic"); return critique(); },
    }, queue);
    await processor.process(job(context.run.workspaceId, context.run.id));
    expect(calls).toEqual(["start", "audit", "audit_saved", "critic", "ready", "ack"]);
  });

  test("repairs a repeatedly audit-rejected draft with a bounded second pass before the critic sees it", async () => {
    const calls: string[] = [];
    const feedback: Array<readonly string[] | undefined> = [];
    const context = pipelineContext("audit");
    const receivedAudits: unknown[] = [];
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async reviseDraftAfterAudit() { calls.push("draft_repaired"); },
      async checkpointAudit() {}, async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    let auditAttempt = 0;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { calls.push("writer_repair"); feedback.push(input.validationFeedback); receivedAudits.push(input.audit); return draft(); },
      async audit(input) {
        calls.push("audit");
        auditAttempt += 1;
        return auditAttempt <= 2
          ? { ...audit(input.draft, input.evidence), ungroundedStatements: [`Le hook factuel manque au registre (audit ${auditAttempt}).`] }
          : audit(input.draft, input.evidence);
      },
      async critique() { calls.push("critic"); return critique(); },
    }, queue);

    await processor.process(job(context.run.workspaceId, context.run.id));

    expect(receivedAudits).toEqual([1, 2].map(attempt => ({ ...audit(), ungroundedStatements: [`Le hook factuel manque au registre (audit ${attempt}).`] })));
    expect(feedback).toEqual([
      ["CONTENT_AUDIT_UNGROUNDED_STATEMENT: Le hook factuel manque au registre (audit 1)."],
      ["CONTENT_AUDIT_UNGROUNDED_STATEMENT: Le hook factuel manque au registre (audit 2)."],
    ]);
    expect(calls).toEqual(["start", "audit", "writer_repair", "draft_repaired", "audit", "writer_repair", "draft_repaired", "audit", "audit_saved", "critic", "ready", "ack"]);
  });

  test("uses the latest audit when a critic repair causes a new factual rejection", async () => {
    const initial = pipelineContext("audit");
    const context = { ...initial, run: { ...initial.run, stage: "critic" as const }, audit: audit() };
    const latestAudit = { ...audit(), ungroundedStatements: ["Une conclusion ajoutée après la critique manque au registre."] };
    const receivedAudits: unknown[] = [];
    let auditCount = 0;
    let criticCount = 0;
    let finalReady = false;
    const repository = {
      async loadContext() { return context; },
      async startRun() {}, async reviseDraftAfterCritique() {}, async reviseDraftAfterAudit() {}, async checkpointAudit() {}, async saveAudit() {},
      async completeRun(input: { readiness: { ready: boolean } }) { finalReady = input.readiness.ready; },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { receivedAudits.push(input.audit); return draft(); },
      async audit(input) { return ++auditCount === 1 ? latestAudit : audit(input.draft, input.evidence); },
      async critique() {
        return ++criticCount === 1
          ? { ...critique(), issues: [{ severity: "blocker" as const, code: "READER_VALUE", message: "Expliquer la décision." }] }
          : critique();
      },
    }, { async acknowledge() {} } as unknown as JobQueue);
    await processor.process(job(context.run.workspaceId, context.run.id));
    expect(receivedAudits).toEqual([context.audit, latestAudit]);
    expect(auditCount).toBe(2);
    expect(finalReady).toBe(true);
  });

  test.each(["issue", "assessment"] as const)("repairs a critic rejection from %s and re-audits before readiness", async (kind) => {
    const calls: string[] = [];
    const feedback: Array<readonly string[] | undefined> = [];
    const context = pipelineContext("audit");
    const repository = {
      async loadContext() { return context; },
      async startRun() { calls.push("start"); },
      async reviseDraftAfterCritique() { calls.push("draft_repaired_after_critique"); },
      async checkpointAudit() {}, async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    let criticAttempt = 0;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { calls.push("writer_repair"); feedback.push(input.validationFeedback); return draft(); },
      async audit(input) { calls.push("audit"); return audit(input.draft, input.evidence); },
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
      async checkpointAudit() {}, async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    let criticAttempt = 0;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { calls.push("writer_repair"); feedback.push(input.validationFeedback); return feedback.length === 1 ? { ...draft(), body: draft().body + " Gain de 42%." } : draft(); },
      async audit(input) { calls.push("audit"); return audit(input.draft, input.evidence); },
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
    expect(feedback[1]).toEqual([...feedback[0]!, expect.stringContaining("CONTENT_DRAFT_UNSOURCED_NUMBER: body: 42.")]);
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
      async checkpointAudit() {}, async saveAudit() {}, async completeRun() {}, async failRun() {},
    } as unknown as ContentGenerationRepository;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { candidates.push(input.draft); feedback.push(input.validationFeedback); return candidates.length === 1 || stillInvalid ? invalid : repaired; },
      async audit(input) { audits += 1; return audits === 1 ? { ...audit(input.draft, input.evidence), ungroundedStatements: ["Clarifier le scénario."] } : { ...audit(input.draft, input.evidence), reviewedScenarios: [{ statement: repaired.illustrativeScenarios[0]!, verdict: "hypothetical" as const, reason: "Entrée fictive sans promesse." }] }; },
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
      async reviseDraftAfterCritique() {}, async checkpointAudit() {}, async saveAudit() {}, async completeRun() {},
    } as unknown as ContentGenerationRepository;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("must not replay"); },
      async write(input) { feedback.push(input.validationFeedback ?? []); return draft(); },
      async audit(input) { return audit(input.draft, input.evidence); },
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

  test.each(["fatal", "incompatible"] as const)("keeps preflight error boundaries when copy is too long: %s", async (outcome) => {
    const base = pipelineContext("writer");
    const context = { ...base, brief: { ...brief(), format: "linkedin_document" as const } };
    const candidate = { ...draft(), body: draft().body + " Texte".repeat(300), mediaPlan: {
      format: "linkedin_document" as const, visualTone: "editorial" as const, title: "Accès", subtitle: null, altText: "Accès", scenes: [],
      slides: Array.from({ length: 3 }, () => ({ title: "Vérifier", body: "Examiner les preuves." })),
    } };
    const repository = { async loadContext() { return context; }, async startRun() {}, async failRun() {},
      async saveDraft() { throw new Error("Invalid draft must not be saved"); },
    } as unknown as ContentGenerationRepository;
    const fatal = new Error("STORAGE_UNAVAILABLE");
    let checks = 0;
    let writes = 0;
    const producer = { async checkDraftLayout() { checks++; throw fatal; } } as unknown as import("@outbound/application/content/content-media").ContentMediaProducer;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("must not replay"); },
      async write() { writes++; return outcome === "fatal" ? candidate : { ...candidate, mediaPlan: { ...candidate.mediaPlan, format: "linkedin_image" as const, slides: [] } }; },
      async audit(input) { throw new Error("must not audit invalid draft"); }, async critique() { return critique(); },
    }, { async acknowledge() {} } as unknown as JobQueue, undefined, producer);
    const run = processor.process(job(context.run.workspaceId, context.run.id));
    if (outcome === "fatal") {
      await expect(run).rejects.toBe(fatal);
      expect(writes).toBe(1);
      expect(checks).toBe(1);
    } else {
      await expect(run).rejects.toThrow("CONTENT_DRAFT_TOO_LONG");
      expect(writes).toBe(2);
      expect(checks).toBe(0);
    }
  });

  test("gives the writer the failing field and limits during layout preflight repair", async () => {
    const base = pipelineContext("writer");
    const candidate = { ...draft(), mediaPlan: { format: "linkedin_document" as const, visualTone: "editorial" as const,
      title: "Accès", subtitle: null, altText: "Accès", scenes: [],
      slides: Array.from({ length: 3 }, () => ({ title: "Vérifier les droits", body: "Examiner les preuves." })),
    } };
    const context = { ...base, brief: { ...brief(), format: "linkedin_document" as const } };
    const feedback: Array<readonly string[] | undefined> = [];
    const repository = { async loadContext() { return context; }, async startRun() {}, async saveDraft() {},
      async checkpointAudit() {}, async saveAudit() {}, async completeRun() {}, async failRun() {},
    } as unknown as ContentGenerationRepository;
    let checks = 0;
    const producer = { async checkDraftLayout() {
      if (++checks === 1) throw new ContentMediaTextOverflowError(1, "cover", { field: "kicker", maxCharactersPerLine: 24, maxLines: 1, actualCharacters: 26 });
    }, async produce() { return {}; } } as unknown as import("@outbound/application/content/content-media").ContentMediaProducer;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("must not replay"); },
      async write(input) { feedback.push(input.validationFeedback); return candidate; },
      async audit(input) { return audit(input.draft, input.evidence); }, async critique() { return critique(); },
    }, { async acknowledge() {} } as unknown as JobQueue, undefined, producer);
    await processor.process(job(context.run.workspaceId, context.run.id));
    expect(feedback).toHaveLength(2);
    expect(feedback[1]?.[0]).toContain("slide 1 (cover)");
    expect(feedback[1]?.[0]).toContain("Field kicker currently has 26 characters and must fit within 1 line(s) of at most 24 characters each");
    expect(checks).toBe(2);
  });

  test("reports excessive post length and independent page overflows in the same bounded repair", async () => {
    const base = pipelineContext("writer");
    const candidate = { ...draft(), mediaPlan: { format: "linkedin_document" as const, visualTone: "editorial" as const,
      title: "Accès", subtitle: null, altText: "Accès", scenes: [],
      slides: Array.from({ length: 3 }, () => ({ title: "Vérifier les droits", body: "Examiner les preuves." })),
    } };
    const context = { ...base, brief: { ...brief(), format: "linkedin_document" as const } };
    const feedback: Array<readonly string[] | undefined> = [];
    const repository = { async loadContext() { return context; }, async startRun() {}, async saveDraft() {},
      async checkpointAudit() {}, async saveAudit() {}, async completeRun() {}, async failRun() {},
    } as unknown as ContentGenerationRepository;
    let checks = 0;
    const producer = { async checkDraftLayout() {
      if (++checks === 1) throw new ContentMediaTextOverflowsError([
        new ContentMediaTextOverflowError(1, "cover", { field: "kicker", maxCharactersPerLine: 24, maxLines: 1, actualCharacters: 26 }),
        new ContentMediaTextOverflowError(3, "closing", { field: "body", maxCharactersPerLine: 34, maxLines: 5, actualCharacters: 185 }),
      ]);
    }, async produce() { return {}; } } as unknown as import("@outbound/application/content/content-media").ContentMediaProducer;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("must not replay"); },
      async write(input) { feedback.push(input.validationFeedback); return feedback.length === 1 ? { ...candidate, body: candidate.body + " ".repeat(1) + "Texte ".repeat(300) } : candidate; },
      async audit(input) { return audit(input.draft, input.evidence); }, async critique() { return critique(); },
    }, { async acknowledge() {} } as unknown as JobQueue, undefined, producer);
    await processor.process(job(context.run.workspaceId, context.run.id));
    expect(feedback).toHaveLength(2);
    expect(feedback[1]).toHaveLength(3);
    expect(feedback[1]?.[0]).toContain("CONTENT_DRAFT_TOO_LONG");
    expect(feedback[1]?.[1]).toContain("slide 1 (cover)");
    expect(feedback[1]?.[1]).toContain("Field kicker currently has 26 characters");
    expect(feedback[1]?.[2]).toContain("slide 3 (closing)");
    expect(feedback[1]?.[2]).toContain("Field body currently has 185 characters");
    expect(checks).toBe(2);
  });

  test.each(["repaired", "persistent", "storage"])("handles media overflow with bounded audited repairs: %s", async (outcome) => {
    const original = pipelineContext("audit");
    const candidate = { ...draft(), mediaPlan: { format: "linkedin_document" as const, visualTone: "editorial" as const,
      title: "Retrouver une preuve", subtitle: null, altText: "Examiner les preuves", scenes: [],
      slides: Array.from({ length: 3 }, () => ({ title: "Retrouver une preuve", body: "Examiner les preuves disponibles." })),
    } };
    const context = { ...original, run: { ...original.run, stage: "critic" as const },
      brief: { ...brief(), format: "linkedin_document" as const }, draft: candidate, audit: audit(candidate) };
    const calls: string[] = [];
    const feedback: unknown[] = [];
    let completed: { readiness: { ready: boolean; blockers: readonly string[] }; media: unknown } | undefined;
    const repository = { async loadContext() { return context; }, async startRun() {},
      async reviseDraftAfterCritique() { calls.push("saved"); }, async checkpointAudit() {}, async saveAudit() {},
      async completeRun(input: typeof completed) { completed = input; }, async failRun() {},
    } as unknown as ContentGenerationRepository;
    let renders = 0;
    const producer = { async checkDraftLayout() {}, async produce() {
      calls.push("render"); renders++;
      if (outcome === "storage") throw new Error("STORAGE_UNAVAILABLE");
      if (renders === 1 || outcome === "persistent") throw new Error("CONTENT_MEDIA_TEXT_OVERFLOW");
      return { marker: "complete media" };
    } } as unknown as import("@outbound/application/content/content-media").ContentMediaProducer;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("must not replay"); },
      async write(input) { calls.push("write"); feedback.push(input.validationFeedback); return candidate; },
      async audit(input) { calls.push("audit"); return audit(input.draft, input.evidence); },
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
      async checkpointAudit() {}, async saveAudit() { calls.push("audit_saved"); },
      async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); },
      async failRun() {},
    } as unknown as ContentGenerationRepository;
    const queue = { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue;
    let auditAttempt = 0;
    const processor = new ContentGenerationJobProcessor(repository, {
      async buildBrief() { throw new Error("brief must not replay"); },
      async write(input) { calls.push("writer_repair"); feedback.push(input.validationFeedback); return draft(); },
      async audit(input) {
        calls.push("audit");
        auditAttempt += 1;
        return auditAttempt === 1
          ? { ...audit(input.draft, input.evidence), forbiddenTopicMatches: ["Capacité produit non sourcée"] }
          : audit(input.draft, input.evidence);
      },
      async critique() { calls.push("critic"); return critique(); },
    }, queue);

    await processor.process(job(context.run.workspaceId, context.run.id));

    expect(feedback).toEqual([["CONTENT_AUDIT_FORBIDDEN_TOPIC: Capacité produit non sourcée"]]);
    expect(calls).toEqual(["start", "audit", "writer_repair", "draft_repaired", "audit", "audit_saved", "critic", "ready", "ack"]);
  });
});

function draft() { return { hook: "Une clause introuvable coûte plus qu’une recherche.", body: "Une clause introuvable coûte plus qu’une recherche. Les équipes juridiques ont besoin d’une preuve résoluble avant de décider. Noosphere relie le contenu aux conversations.", callToAction: "Comment vérifiez-vous vos preuves ?", factualClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: ["proof:1"] }], opinionStatements: ["Une clause introuvable coûte plus qu’une recherche."] }; }
function audit(candidate: ContentDraftSnapshot = draft(), sources: readonly { readonly key: string }[] = [evidence()]) { return fixtureAuditCoverage(candidate, { reviewedClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: ["proof:1"], verdict: "supported" as const, reason: "La source le dit explicitement." }], ungroundedStatements: [], forbiddenTopicMatches: [] }, sources); }
function critique() { return { qualityAssessment: Object.fromEntries(editorialQualityCriteria.map((key) => [key, { verdict: "pass", reason: "Fixture assessment for the content pipeline orchestration test.", excerpts: ["Noosphere relie le contenu aux conversations."] }])) as unknown as ContentQualityAssessment, genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Texte spécifique, étayé et aligné." }; }
function brief() { return { objective: "explain" as const, audience: "Équipes juridiques", problem: "Les preuves sont dispersées dans les dossiers juridiques.", angle: "Relier une recherche documentaire à une décision commerciale.", format: "linkedin_text" as const, evidenceKeys: ["proof:1"], allowedClaimIds: [], callToAction: "Comment vérifiez-vous vos preuves ?", constraints: ["Aucun fait sans preuve"] }; }
function pipelineContext(stage: "writer" | "audit") { const workspaceId = crypto.randomUUID(); const runId = crypto.randomUUID(); return { run: { id: runId, workspaceId, ideaId: crypto.randomUUID(), assetId: crypto.randomUUID(), assetVersionId: null, status: "running" as const, stage, instruction: null, lastErrorCode: null, lastErrorMessage: null, createdAt: new Date(), completedAt: null }, idea: { id: crypto.randomUUID(), workspaceId, strategyVersionId: crypto.randomUUID(), status: "briefed" as const, angle: "Recherche documentaire prouvée", rationale: "Un angle précis pour les juristes.", audience: "Équipes juridiques", pillar: "Recherche", priority: 90, freshnessUntil: new Date(Date.now() + 60_000), firstSeenAt: new Date(), lastSeenAt: new Date(), sources: [evidence()] }, strategy: { audience: { name: "Équipes juridiques", summary: "Juristes avec des preuves dispersées", awareness: "problem_aware" as const }, pillars: [{ name: "Recherche", promise: "Retrouver les preuves", proofTypes: ["claim"] }, { name: "Sécurité", promise: "Contrôler", proofTypes: ["audit"] }, { name: "Adoption", promise: "Déployer", proofTypes: ["chronologie"] }], voice: { traits: ["direct", "précis"], avoid: ["générique"] }, formats: ["linkedin_text" as const], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Comment vérifiez-vous vos preuves ?"], allowedClaimIds: [], forbiddenTopics: [] }, evidence: [evidence()], recentBodies: [], brief: brief(), draft: stage === "audit" ? draft() : null, audit: null, critique: null }; }
function evidence() { return { key: "proof:1", type: "public_web" as const, sourceRef: "https://example.com", canonicalUrl: "https://example.com", title: "Preuve", excerpt: "Noosphere relie le contenu aux conversations.", contentHash: "proof", collectedAt: new Date("2026-09-01T00:00:00Z") }; }
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
    async audit(input) { throw new Error("must not advance"); }, async critique() { throw new Error("must not advance"); },
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
    async loadContext() { return context; }, async startRun() {}, async checkpointAudit() {}, async saveAudit() {}, async failRun() {},
    async completeRun(input: unknown) { result = input; },
  } as unknown as ContentGenerationRepository;
  const processor = new ContentGenerationJobProcessor(repository, {
    async buildBrief() { throw new Error("must not rebuild"); },
    async write() { throw new Error("must not rewrite due to a critic citation error"); },
    async audit(input) { return audit(input.draft, input.evidence); },
    async critique() { return { ...critique(), qualityAssessment: { ...critique().qualityAssessment, brandVoice: { verdict: "revise" as const, reason: "A prior draft contains inappropriate language requiring changes.", excerpts: ["This passage is absent from the current post."] } } }; },
  }, { async acknowledge() {} } as unknown as JobQueue);
  await processor.process(job(context.run.workspaceId, context.run.id));
  expect(result).toMatchObject({ readiness: { ready: false, blockers: expect.arrayContaining(["editorial_assessment_invalid"]) } });
});

test.each([1, 20])("bounds ledger repair and keeps substantive rewriting available with %i existing claims", async existingClaims => {
  const context = pipelineContext("audit");
  const statement = draft().hook;
  context.draft = { ...draft(), factualClaims: Array.from({ length: existingClaims }, () => draft().factualClaims[0]!) };
  const modes: unknown[] = [];
  let audits = 0;
  const saved: unknown[] = [];
  const repository = { loadContext: async () => context, startRun: async () => {},
    reviseDraftAfterAudit: async (input: {draft: unknown}) => { saved.push(input.draft); },
    checkpointAudit: async () => {}, saveAudit: async () => {}, completeRun: async () => {}, failRun: async () => {},
  } as unknown as ContentGenerationRepository;
  const agent = { buildBrief: async () => brief(), write: async (input: any) => { modes.push(input.repairMode); return draft(); },
    audit: async () => ++audits <= 2 ? { ...audit(), ungroundedStatements: [statement] } : audit(),
    critique: async () => critique(),
  };
  await new ContentGenerationJobProcessor(repository, agent, { acknowledge: async () => {} } as unknown as JobQueue).process(job(context.run.workspaceId, context.run.id));
  expect(modes).toEqual([existingClaims === 20 ? undefined : "claim_ledger", undefined]);
  expect(audits).toBe(3);
  expect(saved).toHaveLength(2);
});

test("does not let an audited fragment validate a broader unaudited promise", () => {
  const original = draft();
  const broader = original.factualClaims[0]!.statement + " Il garantit aussi un rendez-vous pour chaque prospect.";
  const candidate = { ...original, body: original.body + " Il garantit aussi un rendez-vous pour chaque prospect.", factualClaims: [{ statement: broader, sourceKeys: ["proof:1"] }] };
  const result = evaluateContentReadiness(fixtureReadinessInput({ draft: candidate, audit: audit(candidate), critique: critique(), availableEvidenceKeys: ["proof:1"], recentBodies: [] }));
  expect(result.ready).toBe(false);
  expect(result.blockers).toContain("unaudited_claim");
});

test("does not approve a historical audit without current field coverage", () => {
  const historical = {...audit(), coverage: undefined};
  const result = evaluateContentReadiness({draft: draft(), audit: historical, critique: critique(), availableEvidenceKeys: ["proof:1"], recentBodies: [], evidenceFingerprint: "a".repeat(64)});
  expect(result.ready).toBe(false);
  expect(result.blockers).toContain("audit_coverage_missing");
});

test.each(["historical", "source_changed", "text_changed"] as const)("reassesses a critic checkpoint before approval when its audit is %s", async change => {
  const base = pipelineContext("audit");
  const storedAudit = change === "historical" ? { ...audit(), coverage: undefined } : audit();
  const context = { ...base, run: { ...base.run, stage: "critic" as const }, audit: storedAudit,
    draft: change === "text_changed" ? { ...draft(), body: draft().body + " Une piste à examiner." } : draft(),
    evidence: change === "source_changed" ? [{ ...evidence(), excerpt: "Texte de la source mis à jour." }] : base.evidence,
  };
  const calls: string[] = [];
  const repository = { async loadContext() { return context; }, async startRun() {}, async reopenAudit() { calls.push("reopen_audit"); }, async checkpointAudit() {}, async saveAudit() { calls.push("persist_audit"); },
    async completeRun(input: { readiness: { ready: boolean } }) { calls.push(input.readiness.ready ? "ready" : "blocked"); }, async failRun() {},
  } as unknown as ContentGenerationRepository;
  await new ContentGenerationJobProcessor(repository, {
    async buildBrief() { throw new Error("must preserve the brief"); },
    async write() { throw new Error("must preserve public copy for reassessment"); },
    async audit(input) { calls.push("audit"); expect(input.draft).toEqual(context.draft); return audit(input.draft, input.evidence); },
    async critique() { calls.push("critic"); return critique(); },
  }, { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue).process(job(context.run.workspaceId, context.run.id));
  expect(calls).toEqual(["reopen_audit", "audit", "persist_audit", "critic", "ready", "ack"]);
});

test("a redelivered completed job does not reopen its historical audit", async () => {
  const base = pipelineContext("audit");
  const context = { ...base, run: { ...base.run, stage: "completed" as const, status: "ready" as const }, audit: { ...audit(), coverage: undefined } };
  const calls: string[] = [];
  const repository = { async loadContext() { return context; }, async startRun() {}, async failRun() {},
  } as unknown as ContentGenerationRepository;
  await new ContentGenerationJobProcessor(repository, {
    async buildBrief() { throw new Error("completed job must not regenerate"); },
    async write() { throw new Error("completed job must not rewrite"); },
    async audit() { throw new Error("completed job must not re-audit"); },
    async critique() { throw new Error("completed job must not re-approve"); },
  }, { async acknowledge() { calls.push("ack"); } } as unknown as JobQueue).process(job(context.run.workspaceId, context.run.id));
  expect(calls).toEqual(["ack"]);
});

test("favorable re-audits cannot approve an unsupported assertion left unchanged by repairs", async () => {
  const context = pipelineContext("audit");
  let reviews = 0;
  let completed: unknown;
  const checkpoints: unknown[] = [];
  const repository = { async loadContext() { return context; }, async startRun() {},
    async checkpointAudit(input: unknown) { checkpoints.push(input); },
    async reviseDraftAfterAudit() {}, async saveAudit() {}, async failRun() {},
    async completeRun(input: unknown) { completed = input; },
  } as unknown as ContentGenerationRepository;
  await new ContentGenerationJobProcessor(repository, {
    async buildBrief() { throw new Error("must preserve brief"); }, async write() { return draft(); },
    async audit(input) {
      const result = audit(input.draft, input.evidence);
      if (++reviews > 1) return result;
      return fixtureAuditCoverage(input.draft, { ...result, reviewedClaims: result.reviewedClaims.map(c => ({ ...c, verdict: "unsupported" as const })) }, input.evidence);
    }, async critique() { return critique(); },
  }, { async acknowledge() {} } as unknown as JobQueue).process(job(context.run.workspaceId, context.run.id));
  expect(completed).toMatchObject({readiness: {ready: false, blockers: expect.arrayContaining(["unresolved_audit_claim"])}});
  expect(checkpoints.length).toBeGreaterThan(0);
});

test("an audit objection survives a quota pause before the writer repairs the draft", async () => {
  const { AiTaskPauseError } = await import("@outbound/application/ai/ai-task-pause");
  const { ModelGatewayError } = await import("@outbound/application/ai/model-gateway");
  const context = pipelineContext("audit");
  let storedAudit: import("@outbound/domain/content/content-asset").ContentEvidenceAudit | null = null;
  let completed: unknown;
  let reviews = 0;
  let pause = true;
  const failure = new AiTaskPauseError(new ModelGatewayError("AI_PROVIDER_QUOTA_EXHAUSTED", "openai-api", "quota", true, false), "content_writer", "write", []);
  const repository = { async loadContext() { return { ...context, audit: storedAudit }; }, async startRun() {},
    async checkpointAudit(input: {audit: import("@outbound/domain/content/content-asset").ContentEvidenceAudit}) { storedAudit = input.audit; },
    async reviseDraftAfterAudit() {}, async saveAudit() {}, async failRun() { throw new Error("quota pause must preserve the checkpoint"); },
    async completeRun(input: unknown) { completed = input; },
  } as unknown as ContentGenerationRepository;
  const agent: import("@outbound/application/content/content-generation").ContentPipelineAgent = {
    async buildBrief() { throw new Error("must preserve brief"); },
    async write() { if (pause) { pause = false; throw failure; } return draft(); },
    async audit(input) {
      const result = audit(input.draft, input.evidence);
      if (++reviews > 1) return result;
      return fixtureAuditCoverage(input.draft, { ...result, reviewedClaims: result.reviewedClaims.map(c => ({ ...c, verdict: "unsupported" as const })) }, input.evidence);
    }, async critique() { return critique(); },
  };
  const queue = { async acknowledge() {} } as unknown as JobQueue;
  await expect(new ContentGenerationJobProcessor(repository, agent, queue).process(job(context.run.workspaceId, context.run.id))).rejects.toBe(failure);
  expect(structuredClone(storedAudit)).toMatchObject({reviewedClaims: [expect.objectContaining({verdict: "unsupported"})]});
  expect(completed).toBeUndefined();
  await new ContentGenerationJobProcessor(repository, agent, queue).process(job(context.run.workspaceId, context.run.id));
  expect(completed).toMatchObject({readiness: {ready: false, blockers: expect.arrayContaining(["unresolved_audit_claim"])}});
});

test("synchronizes an audited omitted reference before the critic without another writer call", async () => {
  const base = pipelineContext("audit");
  const candidate = { ...draft(), factualClaims: [] };
  const context = { ...base, draft: candidate };
  const saved: unknown[] = [];
  let completed: unknown;
  const repository = { async loadContext() { return context; }, async startRun() {},
    async checkpointAudit(input: unknown) { saved.push(input); }, async saveAudit() {}, async failRun() {},
    async completeRun(input: unknown) { completed = input; },
  } as unknown as ContentGenerationRepository;
  await new ContentGenerationJobProcessor(repository, {
    async buildBrief() { throw new Error("must preserve brief"); },
    async write() { throw new Error("an already supported statement must not trigger a writer call"); },
    async audit(input) { return { ...audit(input.draft, input.evidence), ungroundedStatements: [draft().factualClaims[0]!.statement] }; },
    async critique(input) { expect(input.draft).toEqual(draft()); return critique(); },
  }, { async acknowledge() {} } as unknown as JobQueue).process(job(context.run.workspaceId, context.run.id));
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ draft: draft(), audit: {ungroundedStatements: []} });
  expect(completed).toMatchObject({readiness: {ready: true, blockers: []}});
});

test("a current critic checkpoint can complete audited references without repeating model audit", async () => {
  const base = pipelineContext("audit");
  const candidate = {...draft(), factualClaims: []};
  const context = {...base, run: {...base.run, stage: "critic" as const}, draft: candidate, audit: {...audit(candidate, base.evidence), ungroundedStatements: [draft().factualClaims[0]!.statement]}};
  const calls: string[] = [];
  const repository = { async loadContext() { return context; }, async startRun() {}, async reopenAudit() {calls.push("reopen");},
    async checkpointAudit(input: {draft: unknown}) {expect(input.draft).toEqual(draft()); calls.push("checkpoint");}, async saveAudit() {calls.push("audit_saved");}, async failRun() {},
    async completeRun(input: {readiness: {ready: boolean}}) {expect(input.readiness.ready).toBe(true); calls.push("complete");},
  } as unknown as ContentGenerationRepository;
  await new ContentGenerationJobProcessor(repository, {
    async buildBrief() {throw new Error("must preserve brief");}, async write() {throw new Error("must preserve public copy");},
    async audit() {throw new Error("current complete evidence audit must not repeat");}, async critique() {calls.push("critic"); return critique();},
  }, {async acknowledge() {calls.push("ack");}} as unknown as JobQueue).process(job(context.run.workspaceId, context.run.id));
  expect(calls).toEqual(["reopen", "checkpoint", "audit_saved", "critic", "complete", "ack"]);
});


test.each([
  {stage: "audit" as const, persistent: false}, {stage: "audit" as const, persistent: true},
  {stage: "critic" as const, persistent: false}, {stage: "critic" as const, persistent: true},
])("rechecks an omitted declaration without rewriting copy: %j", async ({stage, persistent}) => {
  const base = pipelineContext("audit");
  const context = { ...base, run: {...base.run, stage}, draft: draft(), audit: fixtureAuditCoverage(draft(), {...audit(draft(), base.evidence), reviewedClaims: []}, base.evidence) };
  let reopened = false;
  const checkpoints: unknown[] = [];
  let calls = 0;
  let completed: {readiness: {ready: boolean; blockers: string[]}} | undefined;
  const repository = { async loadContext() {return context;}, async startRun() {},
    async checkpointAudit(input: unknown) {checkpoints.push(input);}, async saveAudit() {},
    async reopenAudit() {reopened = true;},
    async failRun() {throw new Error("must complete with a truthful outcome");},
    async completeRun(input: typeof completed) {completed=input;},
  } as unknown as ContentGenerationRepository;
  const agent = {
    async buildBrief() {throw new Error("preserve brief");}, async write() {throw new Error("preserve copy");},
    async audit(input: {draft: ContentDraftSnapshot; validationFeedback?: readonly string[]}) {
      expect(input.draft).toEqual(context.draft);
      expect(reopened).toBe(stage === "critic");
      if (++calls === 2) {
        expect(checkpoints).toHaveLength(1);
        expect(input.validationFeedback?.join(" ")).toContain(context.draft.factualClaims[0]!.statement);
      }
      return calls === 1 || persistent
        ? fixtureAuditCoverage(input.draft, {...audit(input.draft, context.evidence), reviewedClaims: []}, context.evidence)
        : audit(input.draft, context.evidence);
    }, async critique() {return critique();},
  };
  await new ContentGenerationJobProcessor(repository,agent,{async acknowledge(){}} as unknown as JobQueue).process(job(context.run.workspaceId,context.run.id));
  expect(calls).toBe(2);
  expect(checkpoints).toHaveLength(2);
  expect(completed?.readiness.ready).toBe(!persistent);
  if (persistent) expect(completed?.readiness.blockers).toContain("unaudited_claim");
});
