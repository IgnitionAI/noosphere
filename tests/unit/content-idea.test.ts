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
    const leased = job();
    const discoveryRun = { ...run(), cursor: 1 };
    const businessContext = { offer: { versionId: "pinned-offer", name: "Specific offer" }, icp: { versionId: "pinned-icp", exclusions: ["unrelated buyers"] } };
    let completed = false;
    let acknowledged = false;
    const repository = {
      async loadDiscoveryContext() { return { run: discoveryRun, businessContext, strategy: strategy(), queries: ["q0", "q1", "q2"], internalEvidence: [] }; },
      async startRun() {},
      async saveStep(input: { cursor: number }) { saved.push(input.cursor); },
      async completeRun() { completed = true; },
      async failRun() {},
    } as unknown as ContentIdeaRepository;
    const queue = { async acknowledge() { acknowledged = true; } } as unknown as JobQueue;
    const processor = new ContentIdeaDiscoveryJobProcessor(
      repository,
      { async search(input) {
        expect(input.workspaceId).toBe(leased.workspaceId);
        expect(input.deadlineAt).toEqual(discoveryRun.deadlineAt);
        return [evidence(`proof:${input.query}`)];
      } },
      { async generate(input) { expect(input).toHaveProperty("businessContext", businessContext); return [candidate([input.evidence[0]!.key])]; } },
      queue,
    );
    await processor.process(leased);
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

test("provider pause keeps the discovery cursor resumable at the attempt limit", async () => {
  const { AiTaskPauseError } = await import("@outbound/application/ai/ai-task-pause");
  const { ModelGatewayError } = await import("@outbound/application/ai/model-gateway");
  const failure = new AiTaskPauseError(new ModelGatewayError("AI_PROVIDER_UNAVAILABLE", "anthropic", "unavailable", true, true), "content_idea", "ideas", []);
  let failed = 0, saved = 0;
  const repository = { async loadDiscoveryContext() { return { run: { ...run(), cursor: 1 }, strategy: strategy(), queries: ["q0", "q1"], internalEvidence: [] }; }, async startRun() {}, async failRun() { failed++; }, async saveStep() { saved++; } } as unknown as ContentIdeaRepository;
  const processor = new ContentIdeaDiscoveryJobProcessor(repository, { async search(input) { expect(input.query).toBe("q1"); return [evidence("proof")]; } }, { async generate() { throw failure; } }, {} as JobQueue);
  const leased = job();
  await expect(processor.process({ ...leased, attempts: leased.maxAttempts })).rejects.toBe(failure);
  expect(failed).toBe(0);
  expect(saved).toBe(0);
});

test("budget expiry during the final attempt completes partial without advancing the cursor", async () => {
  const { ContentIdeaSourceDeadlineError } = await import("@outbound/application/content/content-ideas");
  let failed = false, saved = false, partial = false, acknowledged = false;
  const repository = {
    async loadDiscoveryContext() { return { run: { ...run(), cursor: 1 }, strategy: strategy(), queries: ["q0", "q1"], internalEvidence: [] }; },
    async startRun() {}, async saveStep() { saved = true; }, async failRun() { failed = true; },
    async completeRun(input: { partial: boolean }) { partial = input.partial; },
  } as unknown as ContentIdeaRepository;
  const processor = new ContentIdeaDiscoveryJobProcessor(repository,
    { async search() { throw new ContentIdeaSourceDeadlineError(); } },
    { async generate() { throw new Error("must not generate after expiry"); } },
    { async acknowledge() { acknowledged = true; } } as unknown as JobQueue);
  const leased = job();
  await processor.process({ ...leased, attempts: leased.maxAttempts });
  expect({ failed, saved, partial, acknowledged }).toEqual({ failed: false, saved: false, partial: true, acknowledged: true });
});

test("a provider failure before the deadline remains a failure on the final attempt", async () => {
  let failed = false, completed = false, acknowledged = false;
  const repository = {
    async loadDiscoveryContext() { return { run: run(), strategy: strategy(), queries: ["q0"], internalEvidence: [] }; },
    async startRun() {}, async failRun() { failed = true; }, async completeRun() { completed = true; },
  } as unknown as ContentIdeaRepository;
  const failure = new Error("CRAWLER_UNAVAILABLE");
  const processor = new ContentIdeaDiscoveryJobProcessor(repository,
    { async search() { throw failure; } },
    { async generate() { throw new Error("must not generate"); } },
    { async acknowledge() { acknowledged = true; } } as unknown as JobQueue);
  const leased = job();
  await expect(processor.process({ ...leased, attempts: leased.maxAttempts })).rejects.toBe(failure);
  expect({ failed, completed, acknowledged }).toEqual({ failed: true, completed: false, acknowledged: false });
});


test("idea model receives pinned business context and traces changes to it", async () => {
  const { LangChainContentIdeaGenerator } = await import("@outbound/infrastructure/content/langchain-content-idea-generator");
  const calls: any[] = [], records: any[] = [];
  const routed = { async invoke(input: any) { calls.push(input); return {output: {ideas: []}, metadata: {provider: "codex-cli", model: "gpt-5.6-luna"}}; } };
  const agent = new LangChainContentIdeaGenerator({}, undefined, {async record(input) {records.push(input); return {id: crypto.randomUUID()};}}, undefined, routed as any);
  const businessContext = {
    offer: {versionId: "offer1", name: "Atelier", category: "service", valueProposition: "Refonte accessible", targetAudience: "Associations", constraints: [], objections: []},
    icp: {versionId: "icp1", name: "Associations", problems: ["Site inaccessible"], buyingCommittee: {}, exclusions: ["E-commerce"], criteria: {}},
  };
  const input = {workspaceId: crypto.randomUUID(), strategy: strategy(), query: "accessibilité", evidence: [evidence("source1")], businessContext};
  expect(await agent.generate(input)).toEqual([]);
  await agent.generate({...input, businessContext: {...businessContext, offer: {...businessContext.offer, versionId: "offer2"}}});
  expect(calls[0].payload.businessContext).toEqual(businessContext);
  expect(calls[0].requestKey).not.toBe(calls[1].requestKey);
  expect(records[0].inputHash).not.toBe(records[1].inputHash);
  expect(records[0].promptVersion).toBe("noosphere-content-ideas-v2");
});
