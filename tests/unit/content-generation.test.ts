import { describe, expect, test } from "bun:test";
import { assertGroundedContentDraft, evaluateContentReadiness } from "@outbound/domain/content/content-asset";
import { ContentGenerationJobProcessor, type ContentGenerationRepository } from "@outbound/application/content/content-generation";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";

describe("CNT-101 grounded content pipeline", () => {
  test("rejects a number that is absent from the sourced claim ledger", () => {
    expect(() => assertGroundedContentDraft({ ...draft(), body: `${draft().body} 42% des équipes y arrivent.` }, ["proof:1"])).toThrow("CONTENT_DRAFT_UNSOURCED_NUMBER");
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

  test("repairs a critic-rejected draft, then re-audits it before final readiness", async () => {
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
          ? { ...critique(), issues: [{ severity: "blocker" as const, code: "META_FRAMING_LABELS", message: "Supprimer le méta-discours et écrire le fait directement." }] }
          : critique();
      },
    }, queue);

    await processor.process(job(context.run.workspaceId, context.run.id));

    expect(feedback).toEqual([["CONTENT_CRITIQUE_BLOCKER [META_FRAMING_LABELS]: Supprimer le méta-discours et écrire le fait directement."]]);
    expect(calls).toEqual(["start", "audit", "audit_saved", "critic", "writer_repair", "draft_repaired_after_critique", "audit", "audit_saved", "critic", "ready", "ack"]);
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
function critique() { return { genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Texte spécifique, étayé et aligné." }; }
function brief() { return { objective: "explain" as const, audience: "Équipes juridiques", problem: "Les preuves sont dispersées dans les dossiers juridiques.", angle: "Relier une recherche documentaire à une décision commerciale.", format: "linkedin_text" as const, evidenceKeys: ["proof:1"], allowedClaimIds: [], callToAction: "Comment vérifiez-vous vos preuves ?", constraints: ["Aucun fait sans preuve"] }; }
function pipelineContext(stage: "writer" | "audit") { const workspaceId = crypto.randomUUID(); const runId = crypto.randomUUID(); return { run: { id: runId, workspaceId, ideaId: crypto.randomUUID(), assetId: crypto.randomUUID(), assetVersionId: null, status: "running" as const, stage, instruction: null, lastErrorCode: null, lastErrorMessage: null, createdAt: new Date(), completedAt: null }, idea: { id: crypto.randomUUID(), workspaceId, strategyVersionId: crypto.randomUUID(), status: "briefed" as const, angle: "Recherche documentaire prouvée", rationale: "Un angle précis pour les juristes.", audience: "Équipes juridiques", pillar: "Recherche", priority: 90, freshnessUntil: new Date(Date.now() + 60_000), firstSeenAt: new Date(), lastSeenAt: new Date(), sources: [evidence()] }, strategy: { audience: { name: "Équipes juridiques", summary: "Juristes avec des preuves dispersées", awareness: "problem_aware" as const }, pillars: [{ name: "Recherche", promise: "Retrouver les preuves", proofTypes: ["claim"] }, { name: "Sécurité", promise: "Contrôler", proofTypes: ["audit"] }, { name: "Adoption", promise: "Déployer", proofTypes: ["chronologie"] }], voice: { traits: ["direct", "précis"], avoid: ["générique"] }, formats: ["linkedin_text" as const], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Comment vérifiez-vous vos preuves ?"], allowedClaimIds: [], forbiddenTopics: [] }, evidence: [evidence()], recentBodies: [], brief: brief(), draft: stage === "audit" ? draft() : null, audit: null, critique: null }; }
function evidence() { return { key: "proof:1", type: "public_web" as const, sourceRef: "https://example.com", canonicalUrl: "https://example.com", title: "Preuve", excerpt: "Noosphere relie le contenu aux conversations.", contentHash: "proof", collectedAt: new Date() }; }
function job(workspaceId: string, runId: string): LeasedJob { const now = new Date(); return { id: crypto.randomUUID(), workspaceId, type: "content.asset.generate", payload: { runId }, idempotencyKey: "content", correlationId: "content:test", attempts: 1, maxAttempts: 4, availableAt: now, lockedBy: "worker", lockedUntil: new Date(now.getTime() + 60_000) }; }
