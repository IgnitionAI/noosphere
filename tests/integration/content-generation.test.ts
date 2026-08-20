import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { inArray } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  authUsers,
  contentPublicationAttempts,
  contentPublications,
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
import { PostgresContentGenerationRepository } from "@outbound/infrastructure/content/postgres-content-generation-repository";
import { PostgresContentPublicationRepository } from "@outbound/infrastructure/content/postgres-content-publication-repository";
import { PostgresOperationalViews } from "@outbound/infrastructure/workspaces/postgres-operational-views";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("CNT-101 durable content generation", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const repository = new PostgresContentGenerationRepository(database.db);
  const publicationRepository = new PostgresContentPublicationRepository(database.db);
  const operationalViews = new PostgresOperationalViews(database.db);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
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
  const now = new Date("2026-08-20T08:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `content-a-${workspaceId}`, name: "Content A" },
      { id: otherWorkspaceId, slug: `content-b-${otherWorkspaceId}`, name: "Content B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Content Owner", email: `content-${userId}@example.com` });
    await database.db.insert(offers).values({ id: offerId, workspaceId, name: "Noosphere", status: "draft", currentVersion: 1, category: "saas", valueProposition: "Relier contenu et revenu", targetAudience: "Équipes B2B", createdBy: userId });
    await database.db.insert(offerVersions).values({ id: offerVersionId, workspaceId, offerId, version: 1, name: "Noosphere", category: "saas", valueProposition: "Relier contenu et revenu", targetAudience: "Équipes B2B", publishedBy: userId, publishedAt: now });
    await database.db.insert(offerClaims).values({ id: claimId, workspaceId, offerVersionId, claim: "Noosphere relie le contenu aux conversations", validationStatus: "validated", evidenceUri: "https://example.com/proof" });
    await database.db.insert(icps).values({ id: icpId, workspaceId, name: "Équipes juridiques", currentVersion: 1 });
    await database.db.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "Équipes juridiques", confidence: "0.9000", criteria: {}, buyingCommittee: {}, problems: ["Recherche documentaire"], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedBy: userId, publishedAt: now });
    const snapshot = strategySnapshot(claimId);
    await database.db.insert(editorialStrategies).values({ id: strategyId, workspaceId, name: "Noosphere Legal", offerId, offerVersionId, icpId, icpVersionId, status: "active", currentVersion: 1, draft: snapshot, provider: "kimi-code", model: "k3", promptVersion: "test", createdBy: userId });
    await database.db.insert(editorialStrategyVersions).values({ id: strategyVersionId, workspaceId, strategyId, version: 1, offerVersionId, icpVersionId, snapshot, provider: "kimi-code", model: "k3", promptVersion: "test", publishedBy: userId, publishedAt: now });
    await database.db.insert(contentIdeaDiscoveryRuns).values({ id: discoveryRunId, workspaceId, strategyVersionId, trigger: "manual", status: "completed", queryPlan: ["legal"], cursor: 1, queryCount: 1, sourceCount: 1, ideaCount: 1, queryLimit: 1, sourceLimit: 10, deadlineAt: new Date(now.getTime() + 60_000), createdBy: userId, completedAt: now, createdAt: now, updatedAt: now });
    await database.db.insert(contentIdeas).values({ id: ideaId, workspaceId, strategyVersionId, status: "discovered", angle: "Pourquoi une preuve documentaire change une décision juridique", rationale: "Le contenu relie un problème explicite à un claim validé.", audience: "Équipes juridiques", pillar: "Recherche documentaire", priority: 92, fingerprint: new Bun.CryptoHasher("sha256").update(ideaId).digest("hex"), freshnessUntil: new Date(now.getTime() + 86_400_000), firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
    await database.db.insert(contentIdeaSources).values({ id: crypto.randomUUID(), workspaceId, ideaId, runId: discoveryRunId, type: "offer_claim", sourceRef: claimId, canonicalUrl: "https://example.com/proof", title: "Claim validé", excerpt: "Noosphere relie le contenu aux conversations", contentHash: "claim-hash", collectedAt: now });
  }, 30_000);

  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_operation_requests where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.db.delete(contentPublicationAttempts).where(inArray(contentPublicationAttempts.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(contentPublications).where(inArray(contentPublications.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.client`alter table content_asset_versions disable trigger content_asset_versions_immutable_trg`;
    await database.client`delete from content_asset_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table content_asset_versions enable trigger content_asset_versions_immutable_trg`;
    await database.client`alter table content_briefs disable trigger content_briefs_immutable_trg`;
    await database.client`delete from content_briefs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table content_briefs enable trigger content_briefs_immutable_trg`;
    await database.client`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_generation_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_assets where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_idea_sources where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_ideas where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_idea_discovery_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table editorial_strategy_versions disable trigger editorial_strategy_versions_immutable_trg`;
    await database.client`delete from editorial_strategy_versions where workspace_id = ${workspaceId}`;
    await database.client`alter table editorial_strategy_versions enable trigger editorial_strategy_versions_immutable_trg`;
    await database.client`delete from editorial_strategies where workspace_id = ${workspaceId}`;
    await database.client`alter table offer_claims disable trigger offer_claims_immutable_trg`;
    await database.client`delete from offer_claims where workspace_id = ${workspaceId}`;
    await database.client`alter table offer_claims enable trigger offer_claims_immutable_trg`;
    await database.client`alter table offer_versions disable trigger offer_versions_immutable_trg`;
    await database.client`delete from offer_versions where workspace_id = ${workspaceId}`;
    await database.client`alter table offer_versions enable trigger offer_versions_immutable_trg`;
    await database.client`delete from offers where workspace_id = ${workspaceId}`;
    await database.client`alter table icp_versions disable trigger icp_versions_immutable_trg`;
    await database.client`delete from icp_versions where workspace_id = ${workspaceId}`;
    await database.client`alter table icp_versions enable trigger icp_versions_immutable_trg`;
    await database.client`delete from icps where workspace_id = ${workspaceId}`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    await database.close();
  }, 30_000);

  test("is idempotent, checkpointed, immutable and isolated across workspaces", async () => {
    const first = await repository.createGeneration({ workspaceId, userId, ideaId, operation: "asset.generate", requestKey: "content:integration:1", now });
    const replay = await repository.createGeneration({ workspaceId, userId, ideaId, operation: "asset.generate", requestKey: "content:integration:1", now });
    expect(replay.id).toBe(first.id);
    expect((await database.client<{ count: number }[]>`select count(*)::int as count from jobs where workspace_id = ${workspaceId} and type = 'content.asset.generate'`)[0]?.count).toBe(1);
    const context = await repository.loadContext({ workspaceId, runId: first.id });
    const sourceKey = context.evidence[0]!.key;
    const brief = { objective: "explain" as const, audience: "Équipes juridiques", problem: "Les preuves sont dispersées dans les dossiers juridiques.", angle: "Relier une recherche documentaire à une décision commerciale.", format: "linkedin_text" as const, evidenceKeys: [sourceKey], allowedClaimIds: [claimId], callToAction: "Comment vérifiez-vous vos preuves ?", constraints: ["Aucun fait sans preuve"] };
    const draft = { hook: "Une clause introuvable coûte plus qu’une recherche.", body: "Une clause introuvable coûte plus qu’une recherche. Les équipes juridiques ont besoin d’une preuve résoluble avant de décider. Noosphere relie le contenu aux conversations.", callToAction: "Comment vérifiez-vous vos preuves ?", factualClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: [sourceKey] }], opinionStatements: ["Une clause introuvable coûte plus qu’une recherche."] };
    const audit = { reviewedClaims: [{ statement: "Noosphere relie le contenu aux conversations.", sourceKeys: [sourceKey], verdict: "supported" as const, reason: "La source le dit explicitement." }], ungroundedStatements: [], forbiddenTopicMatches: [] };
    const critique = { genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Texte spécifique, étayé et aligné." };
    await repository.startRun({ workspaceId, runId: first.id, now });
    await repository.saveBrief({ workspaceId, runId: first.id, brief, now });
    await repository.saveBrief({ workspaceId, runId: first.id, brief, now });
    await repository.saveDraft({ workspaceId, runId: first.id, draft, now });
    await repository.saveAudit({ workspaceId, runId: first.id, audit, now });
    await repository.completeRun({ workspaceId, runId: first.id, critique, readiness: { ready: true, blockers: [] }, now });
    const asset = await repository.findAssetByIdea({ workspaceId, ideaId });
    expect(asset?.latestVersion).toBe(1);
    expect(asset?.latest?.readiness.ready).toBe(true);
    expect(await repository.findAssetByIdea({ workspaceId: otherWorkspaceId, ideaId })).toBeNull();
    expect((await repository.findRun({ workspaceId, runId: first.id }))?.status).toBe("ready");
    expect(await repository.findRun({ workspaceId: otherWorkspaceId, runId: first.id })).toBeNull();

    const scheduled = await publicationRepository.schedule({
      workspaceId,
      userId,
      assetId: asset!.id,
      requestKey: "publication:integration:1",
      scheduledFor: new Date(now.getTime() + 10_000),
      account: { provider: "unipile", providerAccountId: "linkedin-account-fixture", displayName: "Compte LinkedIn fixture", selectionVersion: now.toISOString(), observedAt: now.toISOString() },
      now,
    });
    const scheduledReplay = await publicationRepository.schedule({
      workspaceId,
      userId,
      assetId: asset!.id,
      requestKey: "publication:integration:1",
      scheduledFor: new Date(now.getTime() + 20_000),
      account: { provider: "unipile", providerAccountId: "linkedin-account-fixture", displayName: "Compte LinkedIn fixture", selectionVersion: now.toISOString(), observedAt: now.toISOString() },
      now,
    });
    expect(scheduledReplay.id).toBe(scheduled.id);
    expect(await publicationRepository.find({ workspaceId: otherWorkspaceId, publicationId: scheduled.id })).toBeNull();
    const moved = await publicationRepository.reschedule({ workspaceId, userId, publicationId: scheduled.id, requestKey: "publication:move:1", scheduledFor: new Date(now.getTime() + 1_000), now });
    expect(moved.scheduledFor).toEqual(new Date(now.getTime() + 1_000));

    const improved = await repository.createGeneration({ workspaceId, userId, assetId: asset!.id, operation: "asset.improve", requestKey: "content:integration:2", instruction: "Un hook plus concret", now: new Date(now.getTime() + 1_000) });
    await repository.startRun({ workspaceId, runId: improved.id, now });
    await repository.saveBrief({ workspaceId, runId: improved.id, brief, now });
    await repository.saveDraft({ workspaceId, runId: improved.id, draft: { ...draft, hook: "Le précédent n’est utile que s’il est retrouvable." }, now });
    await repository.saveAudit({ workspaceId, runId: improved.id, audit, now });
    await repository.completeRun({ workspaceId, runId: improved.id, critique, readiness: { ready: true, blockers: [] }, now });
    expect((await repository.findAssetByIdea({ workspaceId, ideaId }))?.latestVersion).toBe(2);

    const execution = await publicationRepository.claimExecution({ workspaceId, publicationId: scheduled.id, currentAccountId: "linkedin-account-fixture", executionToken: crypto.randomUUID(), now: new Date(now.getTime() + 2_000) });
    expect(execution.text).toBe(draft.body);
    expect(await publicationRepository.inspectExecution({ workspaceId, publicationId: scheduled.id, now: new Date(now.getTime() + 3_000) })).toBe("unknown");
    expect((await publicationRepository.find({ workspaceId, publicationId: scheduled.id }))?.status).toBe("unknown");

    const cancellable = await publicationRepository.schedule({ workspaceId, userId, assetId: asset!.id, requestKey: "publication:integration:cancel", scheduledFor: new Date(now.getTime() + 30_000), account: { provider: "unipile", providerAccountId: "linkedin-account-fixture", displayName: "Compte LinkedIn fixture", selectionVersion: now.toISOString(), observedAt: now.toISOString() }, now });
    const cancelled = await publicationRepository.cancel({ workspaceId, userId, publicationId: cancellable.id, requestKey: "publication:cancel:1", now });
    const cancelReplay = await publicationRepository.cancel({ workspaceId, userId, publicationId: cancellable.id, requestKey: "publication:cancel:1", now });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelReplay.status).toBe("cancelled");

    const publishable = await publicationRepository.schedule({ workspaceId, userId, assetId: asset!.id, requestKey: "publication:integration:published", scheduledFor: now, account: { provider: "unipile", providerAccountId: "linkedin-account-fixture", displayName: "Compte LinkedIn fixture", selectionVersion: now.toISOString(), observedAt: now.toISOString() }, now });
    const publishToken = crypto.randomUUID();
    await publicationRepository.claimExecution({ workspaceId, publicationId: publishable.id, currentAccountId: "linkedin-account-fixture", executionToken: publishToken, now });
    await publicationRepository.markPublished({ workspaceId, publicationId: publishable.id, executionToken: publishToken, result: { providerPostId: "provider-post-fixture", socialId: "social-fixture", url: "https://www.linkedin.com/feed/update/fixture", publishedAt: now }, now });
    expect(await publicationRepository.find({ workspaceId, publicationId: publishable.id })).toMatchObject({ status: "published", providerPostId: "provider-post-fixture", providerUrl: "https://www.linkedin.com/feed/update/fixture" });
    await expectRejected(() => publicationRepository.markFailed({ workspaceId, publicationId: publishable.id, code: "STALE_WORKER", message: "A stale preflight must not overwrite success", now }), "CONTENT_PUBLICATION_EXECUTION_CONFLICT");
    expect((await publicationRepository.find({ workspaceId, publicationId: publishable.id }))?.status).toBe("published");

    const firstPublicationPage = await publicationRepository.list({ workspaceId, limit: 1 });
    const secondPublicationPage = await publicationRepository.list({ workspaceId, cursor: firstPublicationPage.nextCursor!, limit: 1 });
    const thirdPublicationPage = await publicationRepository.list({ workspaceId, cursor: secondPublicationPage.nextCursor!, limit: 1 });
    expect(new Set([
      firstPublicationPage.data[0]?.id,
      secondPublicationPage.data[0]?.id,
      thirdPublicationPage.data[0]?.id,
    ])).toEqual(new Set([scheduled.id, cancellable.id, publishable.id]));
    expect(thirdPublicationPage.nextCursor).toBeNull();

    const [summary, activity, isolatedActivity] = await Promise.all([
      operationalViews.getSummary(workspaceId),
      operationalViews.getActivity({ workspaceId, lens: "inbound" }),
      operationalViews.getActivity({ workspaceId: otherWorkspaceId, lens: "inbound" }),
    ]);
    expect(summary.engines.inbound).toMatchObject({
      status: "degraded",
      label: "Inbound nécessite une attention",
      summary: "Le résultat LinkedIn est incertain : la publication attend une réconciliation et ne sera pas rejouée.",
    });
    expect(summary.engines.inbound.nextAction).toEqual({ label: "Voir l’exception", href: "/content/calendar" });
    expect(summary.nextOutcomes).toContainEqual(expect.objectContaining({ id: `content:${asset!.id}`, type: "publication", source: "inbound" }));
    expect(activity.counters).toContainEqual({ key: "assets", label: "Contenus", value: 1 });
    expect(activity.counters).toContainEqual({ key: "publications", label: "Publications", value: 3 });
    expect(activity.items).toContainEqual(expect.objectContaining({ id: `publication:${scheduled.id}`, status: "attention", href: "/content/calendar" }));
    expect(activity.items).toContainEqual(expect.objectContaining({ id: `publication:${publishable.id}`, status: "completed", href: "/content/calendar" }));
    expect(activity.items).toContainEqual(expect.objectContaining({ id: `content-asset:${asset!.id}`, status: "completed", href: `/content/ideas/${ideaId}` }));
    expect(isolatedActivity.items).toEqual([]);

    await expectRejected(() => database.client`update content_asset_versions set body = 'mutated' where workspace_id = ${workspaceId}`, "CONTENT_SNAPSHOT_IMMUTABLE");
    await expectRejected(() => database.client`update content_publications set content_snapshot = '{"body":"mutated"}'::jsonb where workspace_id = ${workspaceId}`, "CONTENT_PUBLICATION_SNAPSHOT_IMMUTABLE");
  });
});

function strategySnapshot(claimId: string) { return { audience: { name: "Équipes juridiques", summary: "Juristes avec des documents dispersés", awareness: "problem_aware" as const }, pillars: [{ name: "Recherche documentaire", promise: "Retrouver les preuves", proofTypes: ["claim validé"] }, { name: "Sécurité", promise: "Garder le contrôle", proofTypes: ["audit"] }, { name: "Adoption", promise: "Déployer avec les équipes", proofTypes: ["chronologie"] }], voice: { traits: ["direct", "précis"], avoid: ["générique"] }, formats: ["linkedin_text" as const], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Comment vérifiez-vous vos preuves ?"], allowedClaimIds: [claimId], forbiddenTopics: [] }; }

async function expectRejected(operation: () => Promise<unknown>, message: string) {
  let error: unknown;
  try { await operation(); } catch (caught) { error = caught; }
  expect(error).toBeDefined();
  expect(String(error)).toContain(message);
}
