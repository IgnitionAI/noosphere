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
    const readiness = evaluateContentReadiness({ draft: draft(), audit: { ...audit(), reviewedClaims: [] }, critique: critique(), availableEvidenceKeys: ["proof:1"] });
    expect(readiness).toEqual({ ready: false, blockers: ["unaudited_claim"] });
  });

  test("blocks generic copy even when the model critique incorrectly passes it", () => {
    const readiness = evaluateContentReadiness({
      draft: { ...draft(), body: "Dans un monde en constante évolution, voici une analyse précise qui part du problème réel des équipes juridiques. Noosphere relie le contenu aux conversations." },
      audit: audit(),
      critique: critique(),
      availableEvidenceKeys: ["proof:1"],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("generic_language");
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
});

function draft() { return { hook: "Une clause introuvable coûte plus qu’une recherche.", body: "Une clause introuvable coûte plus qu’une recherche. Les équipes juridiques ont besoin d’une preuve résoluble avant de décider. Noosphere relie le contenu aux conversations.", callToAction: "Comment vérifiez-vous vos preuves ?", factualClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: ["proof:1"] }], opinionStatements: ["Une clause introuvable coûte plus qu’une recherche."] }; }
function audit() { return { reviewedClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: ["proof:1"], verdict: "supported" as const, reason: "La source le dit explicitement." }], ungroundedStatements: [], forbiddenTopicMatches: [] }; }
function critique() { return { genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Texte spécifique, étayé et aligné." }; }
function brief() { return { objective: "explain" as const, audience: "Équipes juridiques", problem: "Les preuves sont dispersées dans les dossiers juridiques.", angle: "Relier une recherche documentaire à une décision commerciale.", format: "linkedin_text" as const, evidenceKeys: ["proof:1"], allowedClaimIds: [], callToAction: "Comment vérifiez-vous vos preuves ?", constraints: ["Aucun fait sans preuve"] }; }
function pipelineContext(stage: "writer" | "audit") { const workspaceId = crypto.randomUUID(); const runId = crypto.randomUUID(); return { run: { id: runId, workspaceId, ideaId: crypto.randomUUID(), assetId: crypto.randomUUID(), assetVersionId: null, status: "running" as const, stage, instruction: null, lastErrorCode: null, lastErrorMessage: null, createdAt: new Date(), completedAt: null }, idea: { id: crypto.randomUUID(), workspaceId, strategyVersionId: crypto.randomUUID(), status: "briefed" as const, angle: "Recherche documentaire prouvée", rationale: "Un angle précis pour les juristes.", audience: "Équipes juridiques", pillar: "Recherche", priority: 90, freshnessUntil: new Date(Date.now() + 60_000), firstSeenAt: new Date(), lastSeenAt: new Date(), sources: [evidence()] }, strategy: { audience: { name: "Équipes juridiques", summary: "Juristes avec des preuves dispersées", awareness: "problem_aware" as const }, pillars: [{ name: "Recherche", promise: "Retrouver les preuves", proofTypes: ["claim"] }, { name: "Sécurité", promise: "Contrôler", proofTypes: ["audit"] }, { name: "Adoption", promise: "Déployer", proofTypes: ["chronologie"] }], voice: { traits: ["direct", "précis"], avoid: ["générique"] }, formats: ["linkedin_text" as const], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Comment vérifiez-vous vos preuves ?"], allowedClaimIds: [], forbiddenTopics: [] }, evidence: [evidence()], recentBodies: [], brief: brief(), draft: stage === "audit" ? draft() : null, audit: null, critique: null }; }
function evidence() { return { key: "proof:1", type: "public_web" as const, sourceRef: "https://example.com", canonicalUrl: "https://example.com", title: "Preuve", excerpt: "Noosphere relie le contenu aux conversations.", contentHash: "proof", collectedAt: new Date() }; }
function job(workspaceId: string, runId: string): LeasedJob { const now = new Date(); return { id: crypto.randomUUID(), workspaceId, type: "content.asset.generate", payload: { runId }, idempotencyKey: "content", correlationId: "content:test", attempts: 1, maxAttempts: 4, availableAt: now, lockedBy: "worker", lockedUntil: new Date(now.getTime() + 60_000) }; }
