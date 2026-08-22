import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  authUsers,
  contentIdeaDiscoveryRuns,
  contentIdeaSources,
  contentIdeas,
  editorialStrategies,
  editorialStrategyVersions,
  icps,
  icpVersions,
  offerClaims,
  offers,
  offerVersions,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresContentAutopilotRepository } from "@outbound/infrastructure/content/postgres-content-autopilot-repository";
import { PostgresContentGenerationRepository } from "@outbound/infrastructure/content/postgres-content-generation-repository";
import { PostgresOperationalViews } from "@outbound/infrastructure/workspaces/postgres-operational-views";
import { ContentAutopilotReconciler } from "@outbound/application/content/content-autopilot";
import type { ContentPublicationApplication } from "@outbound/application/content/content-publications";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("AUT-101 bounded automatic editorial repair", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const generation = new PostgresContentGenerationRepository(database.db);
  const autopilot = new PostgresContentAutopilotRepository(database.db);
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const offerId = crypto.randomUUID();
  const offerVersionId = crypto.randomUUID();
  const claimId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const strategyId = crypto.randomUUID();
  const strategyVersionId = crypto.randomUUID();
  const discoveryRunId = crypto.randomUUID();
  const ideaId = crypto.randomUUID();
  const now = new Date("2026-08-21T06:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    const snapshot = strategySnapshot(claimId);
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `repair-${workspaceId}`, name: "Repair workspace" });
    await database.db.insert(authUsers).values({ id: userId, name: "Repair owner", email: `repair-${userId}@example.com` });
    await database.db.insert(offers).values({ id: offerId, workspaceId, name: "Noosphere", status: "draft", currentVersion: 1, category: "saas", valueProposition: "Relier le contenu aux conversations", targetAudience: "Équipes B2B", createdBy: userId });
    await database.db.insert(offerVersions).values({ id: offerVersionId, workspaceId, offerId, version: 1, name: "Noosphere", category: "saas", valueProposition: "Relier le contenu aux conversations", targetAudience: "Équipes B2B", publishedBy: userId, publishedAt: now });
    await database.db.insert(offerClaims).values({ id: claimId, workspaceId, offerVersionId, claim: "Noosphere relie le contenu aux conversations", validationStatus: "validated", evidenceUri: "https://example.com/proof" });
    await database.db.insert(icps).values({ id: icpId, workspaceId, name: "Équipes juridiques", currentVersion: 1 });
    await database.db.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "Équipes juridiques", confidence: "0.9000", criteria: {}, buyingCommittee: {}, problems: ["Recherche documentaire"], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedBy: userId, publishedAt: now });
    await database.db.insert(editorialStrategies).values({ id: strategyId, workspaceId, name: "Noosphere Legal", offerId, offerVersionId, icpId, icpVersionId, status: "active", currentVersion: 1, draft: snapshot, provider: "kimi-code", model: "k3", promptVersion: "test", createdBy: userId });
    await database.db.insert(editorialStrategyVersions).values({ id: strategyVersionId, workspaceId, strategyId, version: 1, offerVersionId, icpVersionId, snapshot, provider: "kimi-code", model: "k3", promptVersion: "test", publishedBy: userId, publishedAt: now });
    await database.db.insert(contentIdeaDiscoveryRuns).values({ id: discoveryRunId, workspaceId, strategyVersionId, trigger: "daily", status: "completed", queryPlan: ["legal"], cursor: 1, queryCount: 1, sourceCount: 1, ideaCount: 1, queryLimit: 1, sourceLimit: 10, deadlineAt: new Date(now.getTime() + 60_000), createdBy: userId, completedAt: now, createdAt: now, updatedAt: now });
    await database.db.insert(contentIdeas).values({ id: ideaId, workspaceId, strategyVersionId, status: "discovered", angle: "Pourquoi la preuve documentaire compte", rationale: "Une idée sourcée à réparer automatiquement.", audience: "Équipes juridiques", pillar: "Recherche documentaire", priority: 90, fingerprint: new Bun.CryptoHasher("sha256").update(ideaId).digest("hex"), freshnessUntil: new Date(now.getTime() + 86_400_000), firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
    await database.db.insert(contentIdeaSources).values({ id: crypto.randomUUID(), workspaceId, ideaId, runId: discoveryRunId, type: "offer_claim", sourceRef: claimId, canonicalUrl: "https://example.com/proof", title: "Claim validé", excerpt: "Noosphere relie le contenu aux conversations", contentHash: `claim-${ideaId}`, collectedAt: now });
    await autopilot.configure({ workspaceId, userId, requestKey: "autopilot:repair:enable", enabled: true, localTime: "06:00", timezone: "Europe/Paris", now });
  });

  afterAll(async () => {
    await database.close();
  });

  test("persists an operational cadence of two LinkedIn posts per day", async () => {
    const configured = await autopilot.configure({
      workspaceId,
      userId,
      requestKey: "autopilot:repair:two-per-day",
      enabled: true,
      localTime: "06:00",
      timezone: "Europe/Paris",
      publicationTimes: ["09:00", "17:00"],
      publicationDays: [1, 2, 3, 4, 5, 6, 7],
      now,
    });

    expect(configured.publicationTimes).toEqual(["09:00", "17:00"]);
    expect(configured.publicationDays).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(configured.postsPerWeek).toBe(14);
    expect((await autopilot.listEnabled({ limit: 10 })).find((item) => item.workspaceId === workspaceId)?.cadence).toEqual({
      postsPerWeek: 14,
      preferredDays: [1, 2, 3, 4, 5, 6, 7],
      publicationTimes: ["09:00", "17:00"],
      timezone: "Europe/Paris",
    });
  });

  test("retries a blocked asset twice, never concurrently and then leaves a localized exception", async () => {
    const waitingIdeaId = crypto.randomUUID();
    await database.db.insert(contentIdeas).values({
      id: waitingIdeaId,
      workspaceId,
      strategyVersionId,
      status: "discovered",
      angle: "Un angle distinct qui doit attendre",
      rationale: "La génération active du workspace doit terminer avant ce contenu.",
      audience: "Équipes juridiques",
      pillar: "Sécurité",
      priority: 80,
      fingerprint: new Bun.CryptoHasher("sha256").update(waitingIdeaId).digest("hex"),
      freshnessUntil: new Date(now.getTime() + 86_400_000),
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(contentIdeaSources).values({
      id: crypto.randomUUID(),
      workspaceId,
      ideaId: waitingIdeaId,
      runId: discoveryRunId,
      type: "offer_claim",
      sourceRef: claimId,
      canonicalUrl: "https://example.com/proof",
      title: "Claim validé",
      excerpt: "Noosphere relie le contenu aux conversations",
      contentHash: `claim-${waitingIdeaId}`,
      collectedAt: now,
    });
    const initial = await generation.createGeneration({ workspaceId, userId, ideaId, operation: "asset.generate", requestKey: "repair:seed", now });
    expect(await autopilot.listGenerationCandidates({ workspaceId, strategyVersionId, now, limit: 10 })).toEqual([]);
    await database.client`delete from content_idea_sources where workspace_id = ${workspaceId} and idea_id = ${waitingIdeaId}`;
    await database.client`delete from content_ideas where workspace_id = ${workspaceId} and id = ${waitingIdeaId}`;
    await completeBlocked(initial.id, now);
    expect(await autopilot.listRepairCandidates({ workspaceId, strategyVersionId, limit: 10 })).toEqual([
      { assetId: initial.assetId, attempt: 1, blockers: ["ungrounded_statement", "generic_language"] },
    ]);

    const reconciler = new ContentAutopilotReconciler(
      autopilot,
      generation,
      { async schedule() { throw new Error("REPAIR_TEST_MUST_NOT_PUBLISH"); } } as unknown as ContentPublicationApplication,
      { now: () => now },
    );
    expect(await reconciler.reconcile()).toBe(1);
    expect(await autopilot.listRepairCandidates({ workspaceId, strategyVersionId, limit: 10 })).toEqual([]);

    const firstRepair = await generation.findRequest({ workspaceId, operation: "asset.improve", requestKey: `autopilot:repair:${initial.assetId}:linkedin-editorial-v2:v1` });
    expect(firstRepair?.instruction).toContain("ungrounded_statement");
    await completeBlocked(firstRepair!.id, new Date(now.getTime() + 1_000));
    expect(await autopilot.listRepairCandidates({ workspaceId, strategyVersionId, limit: 10 })).toEqual([
      { assetId: initial.assetId, attempt: 2, blockers: ["ungrounded_statement", "generic_language"] },
    ]);

    expect(await reconciler.reconcile()).toBe(1);
    const secondRepair = await generation.findRequest({ workspaceId, operation: "asset.improve", requestKey: `autopilot:repair:${initial.assetId}:linkedin-editorial-v2:v2` });
    await completeBlocked(secondRepair!.id, new Date(now.getTime() + 2_000));
    expect(await reconciler.reconcile()).toBe(0);
    expect(await autopilot.listRepairCandidates({ workspaceId, strategyVersionId, limit: 10 })).toEqual([]);
  });

  test("keeps the Inbound engine available when one asset is blocked but another sourced asset is ready", async () => {
    const readyRun = await generation.createGeneration({
      workspaceId,
      userId,
      ideaId,
      operation: "asset.generate",
      requestKey: `health:ready:${crypto.randomUUID()}`,
      now,
    });
    await completeReady(readyRun.id, new Date(now.getTime() + 10_000));

    const blockedIdeaId = crypto.randomUUID();
    await database.db.insert(contentIdeas).values({
      id: blockedIdeaId,
      workspaceId,
      strategyVersionId,
      status: "discovered",
      angle: "Un second angle localement bloque",
      rationale: "Ce blocage ne doit pas arreter le reste du moteur.",
      audience: "Equipes juridiques",
      pillar: "Recherche documentaire",
      priority: 80,
      fingerprint: new Bun.CryptoHasher("sha256").update(blockedIdeaId).digest("hex"),
      freshnessUntil: new Date(now.getTime() + 86_400_000),
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(contentIdeaSources).values({
      id: crypto.randomUUID(),
      workspaceId,
      ideaId: blockedIdeaId,
      runId: discoveryRunId,
      type: "offer_claim",
      sourceRef: claimId,
      canonicalUrl: "https://example.com/proof",
      title: "Claim valide",
      excerpt: "Noosphere relie le contenu aux conversations",
      contentHash: `claim-${blockedIdeaId}`,
      collectedAt: now,
    });
    const blockedRun = await generation.createGeneration({
      workspaceId,
      userId,
      ideaId: blockedIdeaId,
      operation: "asset.generate",
      requestKey: `health:blocked:${crypto.randomUUID()}`,
      now: new Date(now.getTime() + 20_000),
    });
    expect((await generation.loadContext({ workspaceId, runId: blockedRun.id })).recentBodies).toEqual([
      expect.stringContaining("Noosphere relie le contenu aux conversations"),
    ]);
    await completeBlocked(blockedRun.id, new Date(now.getTime() + 30_000));

    const summary = await new PostgresOperationalViews(database.db).getSummary(workspaceId);
    expect(summary.engines.inbound).toMatchObject({
      status: "idle",
      label: "Inbound prêt",
    });
  });

  async function completeReady(runId: string, at: Date) {
    const context = await generation.loadContext({ workspaceId, runId });
    const sourceKey = context.evidence[0]!.key;
    const brief = { objective: "explain" as const, audience: "Equipes juridiques", problem: "Les preuves sont dispersees.", angle: "Relier la preuve a la decision.", format: "linkedin_text" as const, evidenceKeys: [sourceKey], allowedClaimIds: [claimId], callToAction: "Comment verifiez-vous vos preuves ?", constraints: ["Aucun fait sans preuve"] };
    const draft = { hook: "Une preuve change la decision.", body: "Une preuve change la decision lorsque sa source reste verifiable. Noosphere relie le contenu aux conversations. Comment verifiez-vous vos preuves ?", callToAction: "Comment verifiez-vous vos preuves ?", factualClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: [sourceKey] }], opinionStatements: ["Une preuve change la decision lorsque sa source reste verifiable."] };
    const audit = { reviewedClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: [sourceKey], verdict: "supported" as const, reason: "La source le prouve." }], ungroundedStatements: [], forbiddenTopicMatches: [] };
    const critique = { genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Le contenu est pret." };
    await generation.startRun({ workspaceId, runId, now: at });
    await generation.saveBrief({ workspaceId, runId, brief, now: at });
    await generation.saveDraft({ workspaceId, runId, draft, now: at });
    await generation.saveAudit({ workspaceId, runId, audit, now: at });
    await generation.completeRun({ workspaceId, runId, critique, readiness: { ready: true, blockers: [] }, now: at });
  }

  async function completeBlocked(runId: string, at: Date) {
    const context = await generation.loadContext({ workspaceId, runId });
    const sourceKey = context.evidence[0]!.key;
    const brief = { objective: "explain" as const, audience: "Équipes juridiques", problem: "Les preuves sont dispersées.", angle: "Relier la preuve à la décision.", format: "linkedin_text" as const, evidenceKeys: [sourceKey], allowedClaimIds: [claimId], callToAction: "Comment vérifiez-vous vos preuves ?", constraints: ["Aucun fait sans preuve"] };
    const draft = { hook: "Une preuve change la décision.", body: "Une preuve change la décision lorsque sa source reste vérifiable. Noosphere relie le contenu aux conversations. Comment vérifiez-vous vos preuves ?", callToAction: "Comment vérifiez-vous vos preuves ?", factualClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: [sourceKey] }], opinionStatements: ["Une preuve change la décision lorsque sa source reste vérifiable."] };
    const audit = { reviewedClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: [sourceKey], verdict: "supported" as const, reason: "La source le prouve." }], ungroundedStatements: ["Une généralisation non prouvée."], forbiddenTopicMatches: [] };
    const critique = { genericPhrases: ["Une formule générique"], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Une réécriture est requise." };
    await generation.startRun({ workspaceId, runId, now: at });
    await generation.saveBrief({ workspaceId, runId, brief, now: at });
    await generation.saveDraft({ workspaceId, runId, draft, now: at });
    await generation.saveAudit({ workspaceId, runId, audit, now: at });
    await generation.completeRun({ workspaceId, runId, critique, readiness: { ready: false, blockers: ["ungrounded_statement", "generic_language"] }, now: at });
  }
});

function strategySnapshot(claimId: string) {
  return {
    audience: { name: "Équipes juridiques", summary: "Juristes avec des documents dispersés", awareness: "problem_aware" as const },
    pillars: [
      { name: "Recherche documentaire", promise: "Retrouver les preuves", proofTypes: ["claim validé"] },
      { name: "Sécurité", promise: "Garder le contrôle", proofTypes: ["audit"] },
      { name: "Adoption", promise: "Déployer avec les équipes", proofTypes: ["chronologie"] },
    ],
    voice: { traits: ["direct", "précis"], avoid: ["générique"] },
    formats: ["linkedin_text" as const],
    cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" },
    callsToAction: ["Comment vérifiez-vous vos preuves ?"],
    allowedClaimIds: [claimId],
    forbiddenTopics: [],
  };
}
