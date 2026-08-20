import { describe, expect, test } from "bun:test";
import { assertGroundedIdeaCandidate, normalizeIdeaConcept } from "@outbound/domain/content/content-idea";
import { ContentIdeaDiscoveryJobProcessor, type ContentIdeaRepository } from "@outbound/application/content/content-ideas";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";

describe("Noosphere content idea radar", () => {
  test("normalizes concept keys so stylistic variations deduplicate", () => {
    expect(normalizeIdeaConcept("  RGPD : équipes juridiques  ")).toBe("rgpd equipes juridiques");
    expect(normalizeIdeaConcept("R.G.P.D — équipes juridiques")).toBe("rgpd equipes juridiques");
  });

  test("rejects any idea whose proof cannot be resolved", () => {
    expect(() => assertGroundedIdeaCandidate(candidate(["missing"]), ["public_web:proof"])).toThrow("CONTENT_IDEA_UNRESOLVED_SOURCE");
  });

  test("resumes from the durable cursor and acknowledges only after completion", async () => {
    const saved: number[] = [];
    let completed = false;
    let acknowledged = false;
    const repository = {
      async loadDiscoveryContext() { return { run: { ...run(), cursor: 1 }, strategy: strategy(), queries: ["q0", "q1", "q2"], internalEvidence: [] }; },
      async startRun() {},
      async saveStep(input: { cursor: number }) { saved.push(input.cursor); },
      async completeRun() { completed = true; },
      async failRun() {},
    } as unknown as ContentIdeaRepository;
    const queue = { async acknowledge() { acknowledged = true; } } as unknown as JobQueue;
    const processor = new ContentIdeaDiscoveryJobProcessor(
      repository,
      { async search(input) { return [evidence(`proof:${input.query}`)]; } },
      { async generate(input) { return [candidate([input.evidence[0]!.key])]; } },
      queue,
    );
    await processor.process(job());
    expect(saved).toEqual([2, 3]);
    expect(completed).toBe(true);
    expect(acknowledged).toBe(true);
  });
});

function candidate(sourceKeys: string[]) { return { angle: "Ce que les équipes juridiques perdent dans leurs dossiers", rationale: "L’angle part d’une preuve résoluble et d’un problème précis.", audience: "Équipes juridiques", pillar: "Recherche documentaire", priority: 82, freshnessDays: 30, sourceKeys, conceptKey: "temps perdu recherche documentaire" }; }
function evidence(key: string) { return { key, type: "public_web" as const, sourceRef: "https://example.com", canonicalUrl: "https://example.com", title: "Source", excerpt: "Preuve précise", contentHash: key, collectedAt: new Date() }; }
function run() { return { id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), strategyVersionId: crypto.randomUUID(), status: "running" as const, trigger: "manual" as const, cursor: 0, queryCount: 0, sourceCount: 0, ideaCount: 0, queryLimit: 3, sourceLimit: 40, deadlineAt: new Date(Date.now() + 60_000), lastErrorCode: null, lastErrorMessage: null, createdAt: new Date(), completedAt: null }; }
function strategy() { return { audience: { name: "Legal", summary: "Legal teams", awareness: "problem_aware" as const }, pillars: [{ name: "Recherche", promise: "Retrouver les preuves", proofTypes: ["étude"] }, { name: "Sécurité", promise: "Garder le contrôle", proofTypes: ["audit"] }, { name: "Déploiement", promise: "Livrer vite", proofTypes: ["chronologie"] }], voice: { traits: ["direct", "précis"], avoid: ["générique"] }, formats: ["linkedin_text" as const], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Répondre"], allowedClaimIds: [], forbiddenTopics: [] }; }
function job(): LeasedJob { const now = new Date(); return { id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), type: "content.ideas.discover", payload: { runId: crypto.randomUUID() }, idempotencyKey: "ideas", correlationId: "ideas:test", attempts: 1, maxAttempts: 5, availableAt: now, lockedBy: "worker", lockedUntil: new Date(now.getTime() + 60_000) }; }
