import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { inArray } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  authUsers,
  connectedAccounts,
  contentMetricSnapshots,
  contentPublicationAttempts,
  contentPublicationReconciliations,
  contentPublications,
  contentIdeaDiscoveryRuns,
  contentIdeaSources,
  contentIdeas,
  editorialStrategies,
  editorialStrategyVersions,
  editorialLearningVersions,
  icps,
  icpVersions,
  offerClaims,
  offers,
  offerVersions,
  socialContentItems,
  socialContentSyncStates,
  socialInteractions,
  socialInteractionSyncStates,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresContentGenerationRepository } from "@outbound/infrastructure/content/postgres-content-generation-repository";
import { PostgresContentPublicationRepository } from "@outbound/infrastructure/content/postgres-content-publication-repository";
import { PostgresOperationalViews } from "@outbound/infrastructure/workspaces/postgres-operational-views";
import { PostgresSocialContentSyncRepository } from "@outbound/infrastructure/content/postgres-social-content-sync-repository";
import { SocialContentSynchronizer } from "@outbound/application/content/social-content-sync";
import { SocialEngagementSynchronizer } from "@outbound/application/content/social-engagement-sync";
import { PostgresSocialEngagementSyncRepository } from "@outbound/infrastructure/content/postgres-social-engagement-sync-repository";
import { PostgresContentAutopilotRepository } from "@outbound/infrastructure/content/postgres-content-autopilot-repository";
import { ContentAutopilotReconciler } from "@outbound/application/content/content-autopilot";
import { ContentPublicationApplication } from "@outbound/application/content/content-publications";
import { EditorialLearningReconciler } from "@outbound/application/content/editorial-learning";
import { PostgresEditorialLearningRepository } from "@outbound/infrastructure/content/postgres-editorial-learning-repository";
import { PostgresContentIdeaRepository } from "@outbound/infrastructure/content/postgres-content-idea-repository";
import { ContentPublicationOutcomeReconciler } from "@outbound/application/content/content-publication-reconciliation";
import { PostgresContentPublicationReconciliationRepository } from "@outbound/infrastructure/content/postgres-content-publication-reconciliation-repository";

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
  const connectedAccountId = crypto.randomUUID();
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
    await database.db.insert(connectedAccounts).values({ id: connectedAccountId, workspaceId, provider: "unipile", providerAccountId: "linkedin-account-fixture", displayName: "LinkedIn fixture", status: "connected", capabilities: { linkedin: true }, encryptedSecret: "integration-fixture", createdBy: userId });
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
    await database.db.delete(contentMetricSnapshots).where(inArray(contentMetricSnapshots.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(socialInteractions).where(inArray(socialInteractions.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(socialInteractionSyncStates).where(inArray(socialInteractionSyncStates.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(socialContentItems).where(inArray(socialContentItems.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(socialContentSyncStates).where(inArray(socialContentSyncStates.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(contentPublicationReconciliations).where(inArray(contentPublicationReconciliations.workspaceId, [workspaceId, otherWorkspaceId]));
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
    await database.client`alter table editorial_learning_versions disable trigger editorial_learning_versions_immutable_trg`;
    await database.db.delete(editorialLearningVersions).where(inArray(editorialLearningVersions.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.client`alter table editorial_learning_versions enable trigger editorial_learning_versions_immutable_trg`;
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
    await database.db.delete(connectedAccounts).where(inArray(connectedAccounts.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    await database.close();
  }, 30_000);

  test("is idempotent, checkpointed, immutable and isolated across workspaces", async () => {
    const first = await repository.createGeneration({ workspaceId, userId, ideaId, operation: "asset.generate", requestKey: "content:integration:1", now });
    const replay = await repository.createGeneration({ workspaceId, userId, ideaId, operation: "asset.generate", requestKey: "content:integration:1", now });
    expect(replay.id).toBe(first.id);
    const generationJobs = await database.client<{ count: number; priority: number }[]>`select count(*)::int as count, max(priority)::int as priority from jobs where workspace_id = ${workspaceId} and type = 'content.asset.generate'`;
    expect(generationJobs[0]?.count).toBe(1);
    expect(generationJobs[0]?.priority).toBe(60);
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

    const autopilotRepository = new PostgresContentAutopilotRepository(database.db);
    const autopilotClock = { now: () => now };
    const autopilotPublishing = new ContentPublicationApplication(
      publicationRepository,
      { async resolveLinkedin() { return { accountId: "linkedin-account-fixture", displayName: "Compte LinkedIn fixture", selectionVersion: now.toISOString() }; } },
      { async observeCapabilities() { return { network: "linkedin" as const, accountId: "linkedin-account-fixture", accountHealthy: true, textPublishing: "available" as const, observedAt: now }; }, async publishText() { throw new Error("SIMULATED_PTC_MUST_NOT_REACH_PROVIDER"); } },
    );
    await autopilotRepository.configure({ workspaceId, userId, requestKey: "autopilot:integration:enable", enabled: true, localTime: "06:00", timezone: "Europe/Paris", now });
    const autopilot = new ContentAutopilotReconciler(autopilotRepository, repository, autopilotPublishing, autopilotClock);
    expect(await autopilot.reconcile()).toBe(1);
    const firstAutopilot = (await database.client<{ id: string; status: string }[]>`select id, status from content_publications where workspace_id = ${workspaceId} and request_key like 'autopilot:publication:%' order by created_at desc limit 1`)[0]!;
    await autopilotRepository.configure({ workspaceId, userId, requestKey: "autopilot:integration:pause", enabled: false, localTime: "06:00", timezone: "Europe/Paris", now });
    expect((await publicationRepository.find({ workspaceId, publicationId: firstAutopilot.id }))?.status).toBe("cancelled");
    await autopilotRepository.configure({ workspaceId, userId, requestKey: "autopilot:integration:resume", enabled: true, localTime: "06:00", timezone: "Europe/Paris", now });
    expect(await autopilot.reconcile()).toBe(1);
    const resumedAutopilot = (await database.client<{ id: string; status: string; request_key: string }[]>`select id, status, request_key from content_publications where workspace_id = ${workspaceId} and request_key like 'autopilot:publication:%:v2' limit 1`)[0]!;
    expect(resumedAutopilot.id).not.toBe(firstAutopilot.id);
    expect(resumedAutopilot.request_key).toEndWith(":v2");
    await autopilotRepository.configure({ workspaceId, userId, requestKey: "autopilot:integration:pause-again", enabled: false, localTime: "06:00", timezone: "Europe/Paris", now });
    expect((await publicationRepository.find({ workspaceId, publicationId: resumedAutopilot.id }))?.status).toBe("cancelled");

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
    expect((await database.client<{ priority: number }[]>`select priority from jobs where workspace_id = ${workspaceId} and payload->>'publicationId' = ${scheduled.id}`)[0]?.priority).toBe(70);
    expect(await publicationRepository.find({ workspaceId: otherWorkspaceId, publicationId: scheduled.id })).toBeNull();
    const moved = await publicationRepository.reschedule({ workspaceId, userId, publicationId: scheduled.id, requestKey: "publication:move:1", scheduledFor: new Date(now.getTime() + 1_000), now });
    expect(moved.scheduledFor).toEqual(new Date(now.getTime() + 1_000));

    const improved = await repository.createGeneration({ workspaceId, userId, assetId: asset!.id, operation: "asset.improve", requestKey: "content:integration:2", instruction: "Un hook plus concret", now: new Date(now.getTime() + 1_000) });
    expect((await repository.loadContext({ workspaceId, runId: improved.id })).recentBodies).toEqual([]);
    await repository.startRun({ workspaceId, runId: improved.id, now });
    await repository.saveBrief({ workspaceId, runId: improved.id, brief, now });
    await repository.saveDraft({ workspaceId, runId: improved.id, draft: { ...draft, hook: "Le précédent n’est utile que s’il est retrouvable." }, now });
    const auditRepairedDraft = { ...draft, hook: "Une preuve auditée reste résoluble." };
    await repository.reviseDraftAfterAudit({ workspaceId, runId: improved.id, draft: auditRepairedDraft, now });
    expect((await repository.loadContext({ workspaceId, runId: improved.id })).draft?.hook).toBe(auditRepairedDraft.hook);
    await repository.saveAudit({ workspaceId, runId: improved.id, audit, now });
    await repository.completeRun({ workspaceId, runId: improved.id, critique, readiness: { ready: true, blockers: [] }, now });
    expect((await repository.findAssetByIdea({ workspaceId, ideaId }))?.latestVersion).toBe(2);

    const stale = await repository.createGeneration({ workspaceId, userId, assetId: asset!.id, operation: "asset.improve", requestKey: "content:integration:stale", now: new Date(now.getTime() + 2_000) });
    await repository.startRun({ workspaceId, runId: stale.id, now });
    await repository.saveBrief({ workspaceId, runId: stale.id, brief, now });
    await repository.saveDraft({ workspaceId, runId: stale.id, draft: { ...draft, body: `${draft.body} Ancien brouillon.` }, now });
    await repository.saveAudit({ workspaceId, runId: stale.id, audit, now });
    const newer = await repository.createGeneration({ workspaceId, userId, assetId: asset!.id, operation: "asset.improve", requestKey: "content:integration:newer", now: new Date(now.getTime() + 3_000) });
    await repository.startRun({ workspaceId, runId: newer.id, now });
    await repository.saveBrief({ workspaceId, runId: newer.id, brief, now });
    await repository.saveDraft({ workspaceId, runId: newer.id, draft, now });
    await repository.saveAudit({ workspaceId, runId: newer.id, audit, now });
    await repository.completeRun({ workspaceId, runId: newer.id, critique, readiness: { ready: true, blockers: [] }, now });
    const newestAsset = await repository.findAssetByIdea({ workspaceId, ideaId });
    await repository.completeRun({ workspaceId, runId: stale.id, critique, readiness: { ready: false, blockers: ["editorial_blocker"] }, now: new Date(now.getTime() + 4_000) });
    expect(await repository.findAssetByIdea({ workspaceId, ideaId })).toMatchObject({ latestVersion: newestAsset?.latestVersion, status: "ready", latest: { id: newestAsset?.latest?.id } });
    expect(await repository.findRun({ workspaceId, runId: stale.id })).toMatchObject({ status: "blocked", assetVersionId: null, lastErrorCode: "CONTENT_GENERATION_SUPERSEDED" });

    await database.client`update content_assets set latest_version = ${newestAsset!.latestVersion - 1} where workspace_id = ${workspaceId} and id = ${asset!.id}`;
    const afterRollback = await repository.createGeneration({ workspaceId, userId, assetId: asset!.id, operation: "asset.improve", requestKey: "content:integration:after-rollback", now: new Date(now.getTime() + 5_000) });
    await repository.startRun({ workspaceId, runId: afterRollback.id, now });
    await repository.saveBrief({ workspaceId, runId: afterRollback.id, brief, now });
    await repository.saveDraft({ workspaceId, runId: afterRollback.id, draft, now });
    await repository.saveAudit({ workspaceId, runId: afterRollback.id, audit, now });
    await repository.completeRun({ workspaceId, runId: afterRollback.id, critique, readiness: { ready: true, blockers: [] }, now: new Date(now.getTime() + 6_000) });
    expect((await repository.findAssetByIdea({ workspaceId, ideaId }))?.latestVersion).toBe(newestAsset!.latestVersion + 1);

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
    expect((await repository.loadContext({ workspaceId, runId: improved.id })).recentBodies).toContain(draft.body);
    await expectRejected(() => publicationRepository.markFailed({ workspaceId, publicationId: publishable.id, code: "STALE_WORKER", message: "A stale preflight must not overwrite success", now }), "CONTENT_PUBLICATION_EXECUTION_CONFLICT");
    expect((await publicationRepository.find({ workspaceId, publicationId: publishable.id }))?.status).toBe("published");

    const socialSyncRepository = new PostgresSocialContentSyncRepository(database.db);
    const socialPage = [
      { providerPostId: "provider-post-fixture", socialId: "social-fixture", authorProviderId: "owner-fixture", text: draft.body, url: "https://www.linkedin.com/feed/update/fixture", publishedAt: now, observedAt: now },
      { providerPostId: "external-post-fixture", socialId: "urn:li:activity:999", authorProviderId: "owner-fixture", text: "Post publié hors Noosphere", url: "https://www.linkedin.com/feed/update/urn:li:activity:999", publishedAt: new Date(now.getTime() - 60_000), observedAt: now },
    ];
    const firstSocialSync = new SocialContentSynchronizer(
      socialSyncRepository,
      { async listOwnContent() { return { data: socialPage, nextCursor: null }; } },
      { async readMetrics() { return socialPage.map((post, index) => ({ providerPostId: post.providerPostId, impressions: 100 + index, reactions: 5 + index, comments: 2, reposts: 1, observedAt: now })); } },
      { now: () => now },
    );
    expect(await firstSocialSync.reconcile(workspaceId)).toBe(2);
    const observed = await socialSyncRepository.list({ workspaceId, limit: 20 });
    expect(observed.data).toContainEqual(expect.objectContaining({ providerPostId: "provider-post-fixture", publicationId: publishable.id, origin: "internal", impressions: 100 }));
    expect(observed.data).toContainEqual(expect.objectContaining({ providerPostId: "external-post-fixture", publicationId: null, origin: "external", impressions: 101 }));
    expect((await socialSyncRepository.list({ workspaceId: otherWorkspaceId, limit: 20 })).data).toEqual([]);

    const restartedAt = new Date(now.getTime() + 60_000);
    await database.db.update(socialContentSyncStates).set({ nextSyncAt: restartedAt }).where(inArray(socialContentSyncStates.workspaceId, [workspaceId]));
    const restartedSocialSync = new SocialContentSynchronizer(
      new PostgresSocialContentSyncRepository(database.db),
      { async listOwnContent() { return { data: socialPage.map((post) => ({ ...post, observedAt: restartedAt })), nextCursor: null }; } },
      { async readMetrics() { return socialPage.map((post, index) => ({ providerPostId: post.providerPostId, impressions: 150 + index, reactions: 8 + index, comments: 3, reposts: 1, observedAt: restartedAt })); } },
      { now: () => restartedAt },
    );
    expect(await restartedSocialSync.reconcile(workspaceId)).toBe(2);
    const converged = await socialSyncRepository.list({ workspaceId, limit: 20 });
    expect(converged.data).toHaveLength(2);
    expect(converged.data).toContainEqual(expect.objectContaining({ providerPostId: "provider-post-fixture", origin: "internal", impressions: 150, metricsObservedAt: restartedAt }));
    expect((await database.client<{ count: number }[]>`select count(*)::int as count from content_metric_snapshots where workspace_id = ${workspaceId}`)[0]?.count).toBe(4);
    expect(await socialSyncRepository.status({ workspaceId })).toMatchObject({ status: "idle", backfillComplete: true, lastSuccessAt: restartedAt });

    const engagementRepository = new PostgresSocialEngagementSyncRepository(database.db);
    let engagementRevision = 1;
    const engagementReader = {
      async listEngagements(input: { providerSocialId: string; kind: "comments" | "reactions"; parentProviderInteractionId: string | null }) {
        if (input.providerSocialId !== "social-fixture") return { data: [], nextCursor: null };
        if (input.kind === "comments" && input.parentProviderInteractionId === null) return {
          data: [{ providerInteractionId: "comment-fixture", type: "comment" as const, parentProviderInteractionId: null, actor: { providerId: "prospect-provider", name: "Prospect", headline: "Juriste", profileUrl: "https://www.linkedin.com/in/prospect" }, body: engagementRevision === 1 ? "Commentaire initial" : "Commentaire modifié", reaction: null, mentionedProviderId: null, mentionedName: null, occurredAt: restartedAt, observedAt: new Date(restartedAt.getTime() + engagementRevision), replyCount: engagementRevision === 1 ? 1 : 0, reactionCount: engagementRevision === 1 ? 1 : 0 }],
          nextCursor: null,
        };
        if (input.kind === "comments" && input.parentProviderInteractionId === "comment-fixture") return {
          data: engagementRevision === 1 ? [{ providerInteractionId: "reply-fixture", type: "reply" as const, parentProviderInteractionId: "comment-fixture", actor: { providerId: "owner-fixture", name: "Owner", headline: null, profileUrl: null }, body: "Réponse du propriétaire", reaction: null, mentionedProviderId: null, mentionedName: null, occurredAt: restartedAt, observedAt: new Date(restartedAt.getTime() + engagementRevision), replyCount: 0, reactionCount: 0 }] : [],
          nextCursor: null,
        };
        if (input.kind === "reactions") return {
          data: engagementRevision === 1 ? [{ providerInteractionId: `reaction:${input.parentProviderInteractionId ?? "post"}:prospect-provider:LIKE`, type: "reaction" as const, parentProviderInteractionId: input.parentProviderInteractionId, actor: { providerId: "prospect-provider", name: "Prospect", headline: "Juriste", profileUrl: "https://www.linkedin.com/in/prospect" }, body: null, reaction: "LIKE", mentionedProviderId: null, mentionedName: null, occurredAt: null, observedAt: new Date(restartedAt.getTime() + engagementRevision), replyCount: 0, reactionCount: 0 }] : [],
          nextCursor: null,
        };
        return { data: [], nextCursor: null };
      },
    };
    const [messagesBefore, outreachJobsBefore] = await Promise.all([
      database.client<{ count: number }[]>`select count(*)::int as count from messages where workspace_id = ${workspaceId}`,
      database.client<{ count: number }[]>`select count(*)::int as count from jobs where workspace_id = ${workspaceId} and (type like '%outreach%' or type like '%reply%')`,
    ]);
    const firstEngagementSync = new SocialEngagementSynchronizer(engagementRepository, engagementReader, { now: () => new Date(restartedAt.getTime() + 1), targetLimit: 20 });
    expect(await firstEngagementSync.reconcile(workspaceId)).toBeGreaterThanOrEqual(2);
    const restartedEngagementSync = new SocialEngagementSynchronizer(new PostgresSocialEngagementSyncRepository(database.db), engagementReader, { now: () => new Date(restartedAt.getTime() + 2), targetLimit: 20 });
    await restartedEngagementSync.reconcile(workspaceId);
    const firstEngagements = await engagementRepository.list({ workspaceId, limit: 20 });
    expect(firstEngagements.data).toContainEqual(expect.objectContaining({ providerInteractionId: "comment-fixture", type: "comment", direction: "incoming", body: "Commentaire initial", status: "observed" }));
    expect(firstEngagements.data).toContainEqual(expect.objectContaining({ providerInteractionId: "reply-fixture", type: "reply", direction: "owner", status: "observed" }));
    expect(firstEngagements.data.filter((item) => item.type === "reaction").length).toBeGreaterThanOrEqual(1);
    expect((await engagementRepository.list({ workspaceId: otherWorkspaceId, limit: 20 })).data).toEqual([]);
    const firstInteractionCount = firstEngagements.data.length;

    engagementRevision = 2;
    const modifiedAt = new Date(restartedAt.getTime() + 15 * 60_000 + 10);
    await database.db.update(socialInteractionSyncStates).set({ nextSyncAt: modifiedAt }).where(inArray(socialInteractionSyncStates.workspaceId, [workspaceId]));
    const modificationSync = new SocialEngagementSynchronizer(new PostgresSocialEngagementSyncRepository(database.db), engagementReader, { now: () => modifiedAt, targetLimit: 20 });
    await modificationSync.reconcile(workspaceId);
    const reconciledEngagements = await engagementRepository.list({ workspaceId, limit: 30 });
    expect(reconciledEngagements.data).toContainEqual(expect.objectContaining({ providerInteractionId: "comment-fixture", body: "Commentaire modifié", status: "observed" }));
    expect(reconciledEngagements.data).toContainEqual(expect.objectContaining({ providerInteractionId: "reply-fixture", status: "removed", removedAt: modifiedAt }));
    expect(reconciledEngagements.data.filter((item) => item.status === "observed")).toHaveLength(1);
    expect(reconciledEngagements.data).toHaveLength(firstInteractionCount);
    const [messagesAfter, outreachJobsAfter] = await Promise.all([
      database.client<{ count: number }[]>`select count(*)::int as count from messages where workspace_id = ${workspaceId}`,
      database.client<{ count: number }[]>`select count(*)::int as count from jobs where workspace_id = ${workspaceId} and (type like '%outreach%' or type like '%reply%')`,
    ]);
    expect(messagesAfter[0]?.count).toBe(messagesBefore[0]?.count);
    expect(outreachJobsAfter[0]?.count).toBe(outreachJobsBefore[0]?.count);
    expect(await engagementRepository.status({ workspaceId })).toMatchObject({ status: "idle", observed: 1, incoming: 1 });

    await autopilotRepository.configure({ workspaceId, userId, requestKey: "autopilot:integration:learning-enable", enabled: true, localTime: "06:00", timezone: "Europe/Paris", now: modifiedAt });
    const learningRepository = new PostgresEditorialLearningRepository(database.db);
    const learning = new EditorialLearningReconciler(learningRepository, () => modifiedAt);
    expect(await learning.reconcile()).toBe(1);
    const learningView = await learningRepository.latest(workspaceId);
    expect(learningView).toMatchObject({ version: 1, modelVersion: "bounded-editorial-learning-v1", bounds: { icpVersionId, allowedClaimIds: [claimId], postsPerWeek: 3 } });
    expect(learningView?.facts).toContainEqual(expect.objectContaining({ kind: "response", certainty: "fact", pillar: "Recherche documentaire", sourceRef: expect.stringContaining("social-interaction:") }));
    expect(learningView?.inferences).toEqual([]);
    expect(learningView?.recommendations).toContainEqual(expect.objectContaining({ action: "prioritize", pillar: "Recherche documentaire", angle: "Pourquoi une preuve documentaire change une décision juridique" }));
    expect(await learning.reconcile()).toBe(0);
    expect(await learningRepository.latest(otherWorkspaceId)).toBeNull();
    const learnedDiscovery = await new PostgresContentIdeaRepository(database.db).createDiscovery({ workspaceId, userId, requestKey: "ideas:integration:learned", trigger: "daily", now: modifiedAt });
    const learnedPlan = (await database.client<{ query_plan: string[] }[]>`select query_plan from content_idea_discovery_runs where workspace_id = ${workspaceId} and id = ${learnedDiscovery.id}`)[0]!.query_plan;
    expect(learnedPlan[0]).toContain("Pourquoi une preuve documentaire change une décision juridique");

    const publicationIds: string[] = [];
    let publicationCursor: string | undefined;
    do {
      const page = await publicationRepository.list({ workspaceId, ...(publicationCursor ? { cursor: publicationCursor } : {}), limit: 1 });
      publicationIds.push(...page.data.map((item) => item.id));
      publicationCursor = page.nextCursor ?? undefined;
    } while (publicationCursor);
    expect(new Set(publicationIds)).toEqual(new Set([firstAutopilot.id, resumedAutopilot.id, scheduled.id, cancellable.id, publishable.id]));

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
    expect(activity.counters).toContainEqual({ key: "publications", label: "Publications", value: 5 });
    expect(activity.counters).toContainEqual({ key: "interactions", label: "Engagements", value: 1 });
    expect(activity.items).toContainEqual(expect.objectContaining({ id: expect.stringContaining("social-interaction:"), kind: "signal", source: "inbound", status: "completed" }));
    expect(activity.items).toContainEqual(expect.objectContaining({ id: `publication:${scheduled.id}`, status: "attention", href: "/content/calendar" }));
    expect(activity.items).toContainEqual(expect.objectContaining({ id: `publication:${publishable.id}`, status: "completed", href: "/content/calendar" }));
    expect(activity.items).toContainEqual(expect.objectContaining({ id: `content-asset:${asset!.id}`, status: "completed", href: `/content/ideas/${ideaId}` }));
    expect(isolatedActivity.items).toEqual([]);

    await expectRejected(() => database.client`update content_asset_versions set body = 'mutated' where workspace_id = ${workspaceId}`, "CONTENT_SNAPSHOT_IMMUTABLE");
    await expectRejected(() => database.client`update content_publications set content_snapshot = '{"body":"mutated"}'::jsonb where workspace_id = ${workspaceId}`, "CONTENT_PUBLICATION_SNAPSHOT_IMMUTABLE");
    await expectRejected(() => database.client`update editorial_learning_versions set model_version = 'mutated' where workspace_id = ${workspaceId}`, "EDITORIAL_LEARNING_VERSION_IMMUTABLE");
  });

  test("reconciles a lost provider result once and closes an absent result without replay", async () => {
    const reconciliationRepository = new PostgresContentPublicationReconciliationRepository(database.db);
    const searchAt = new Date(now.getTime() + 4_000);
    const targets = await reconciliationRepository.listDue({ workspaceId, now: searchAt });
    expect(targets).toHaveLength(1);
    expect(await reconciliationRepository.listDue({ workspaceId: otherWorkspaceId, now: searchAt })).toEqual([]);

    const acquisitions = await Promise.all([
      reconciliationRepository.acquire({ ...targets[0]!, now: searchAt, leaseMs: 60_000 }),
      reconciliationRepository.acquire({ ...targets[0]!, now: searchAt, leaseMs: 60_000 }),
    ]);
    const lease = acquisitions.find((value) => value !== null);
    expect(acquisitions.filter((value) => value !== null)).toHaveLength(1);
    expect(lease).toBeDefined();
    await reconciliationRepository.markProviderError({ lease: lease!, code: "SOCIAL_RATE_LIMITED", terminal: false, nextAttemptAt: searchAt, now: searchAt });

    const unknown = (await database.db.select().from(contentPublications).where(inArray(contentPublications.id, [targets[0]!.publicationId])).limit(1))[0]!;
    const body = (unknown.contentSnapshot as { body: string }).body;
    let publishCalls = 0;
    const reconciler = new ContentPublicationOutcomeReconciler(
      reconciliationRepository,
      { async listOwnContent() { return { data: [{ providerPostId: "provider-post-recovered", socialId: "urn:li:activity:recovered", authorProviderId: "owner-fixture", text: body, url: "https://www.linkedin.com/feed/update/recovered", publishedAt: unknown.publishStartedAt, observedAt: searchAt }], nextCursor: null }; } },
      { now: () => searchAt },
    );
    expect(await reconciler.reconcile(workspaceId)).toBe(1);
    expect(publishCalls).toBe(0);
    expect(await publicationRepository.find({ workspaceId, publicationId: unknown.id })).toMatchObject({
      status: "published",
      providerPostId: "provider-post-recovered",
      reconciliation: { status: "matched", candidatesCount: 1, correlationId: `content-publication:${unknown.id}` },
    });
    expect((await database.db.select().from(contentPublicationAttempts).where(inArray(contentPublicationAttempts.publicationId, [unknown.id])))[0]?.status).toBe("published");

    const asset = await repository.findAssetByIdea({ workspaceId, ideaId });
    const absent = await publicationRepository.schedule({
      workspaceId,
      userId,
      assetId: asset!.id,
      requestKey: "publication:integration:not-found",
      scheduledFor: searchAt,
      account: { provider: "unipile", providerAccountId: "linkedin-account-fixture", displayName: "Compte LinkedIn fixture", selectionVersion: searchAt.toISOString(), observedAt: searchAt.toISOString() },
      now: searchAt,
    });
    await publicationRepository.claimExecution({ workspaceId, publicationId: absent.id, currentAccountId: "linkedin-account-fixture", executionToken: crypto.randomUUID(), now: searchAt });
    await publicationRepository.inspectExecution({ workspaceId, publicationId: absent.id, now: new Date(searchAt.getTime() + 1) });
    const afterWindow = new Date(searchAt.getTime() + 2 * 60 * 60_000 + 1);
    const noMatch = new ContentPublicationOutcomeReconciler(
      reconciliationRepository,
      { async listOwnContent() { return { data: [], nextCursor: null }; } },
      { now: () => afterWindow },
    );
    expect(await noMatch.reconcile(workspaceId)).toBe(1);
    expect(await publicationRepository.find({ workspaceId, publicationId: absent.id })).toMatchObject({
      status: "unknown",
      reconciliation: { status: "not_found", candidatesCount: 0, lastErrorCode: "CONTENT_PUBLICATION_PROVIDER_NOT_FOUND" },
    });
    const [criteria] = await database.db.select({ snapshot: contentPublicationReconciliations.criteriaSnapshot }).from(contentPublicationReconciliations).where(inArray(contentPublicationReconciliations.publicationId, [absent.id]));
    expect(JSON.stringify(criteria?.snapshot)).not.toContain(body);
    expect((await database.db.select().from(contentPublicationReconciliations).where(inArray(contentPublicationReconciliations.publicationId, [absent.id])))[0]?.completedAt).toEqual(afterWindow);
    const decisions = await database.client<{ event_type: string; payload: unknown }[]>`select event_type, payload from outbox_events where workspace_id = ${workspaceId} and aggregate_id in (${unknown.id}, ${absent.id}) and event_type in ('ContentPublicationReconciled', 'ContentPublicationReconciliationDecided') order by event_type`;
    expect(decisions.map((decision) => decision.event_type)).toEqual(["ContentPublicationReconciled", "ContentPublicationReconciliationDecided"]);
    expect(JSON.stringify(decisions)).not.toContain(body);
    await expectRejected(() => database.client`update content_publication_reconciliations set status = 'pending', completed_at = null where workspace_id = ${workspaceId} and publication_id = ${absent.id}`, "CONTENT_PUBLICATION_RECONCILIATION_FINAL");
  });
});

function strategySnapshot(claimId: string) { return { audience: { name: "Équipes juridiques", summary: "Juristes avec des documents dispersés", awareness: "problem_aware" as const }, pillars: [{ name: "Recherche documentaire", promise: "Retrouver les preuves", proofTypes: ["claim validé"] }, { name: "Sécurité", promise: "Garder le contrôle", proofTypes: ["audit"] }, { name: "Adoption", promise: "Déployer avec les équipes", proofTypes: ["chronologie"] }], voice: { traits: ["direct", "précis"], avoid: ["générique"] }, formats: ["linkedin_text" as const], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Comment vérifiez-vous vos preuves ?"], allowedClaimIds: [claimId], forbiddenTopics: [] }; }

async function expectRejected(operation: () => Promise<unknown>, message: string) {
  let error: unknown;
  try { await operation(); } catch (caught) { error = caught; }
  expect(error).toBeDefined();
  expect(String(error)).toContain(message);
}
