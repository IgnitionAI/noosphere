import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  authUsers,
  editorialStrategies,
  editorialStrategyVersions,
  icps,
  icpVersions,
  offerClaims,
  offers,
  offerVersions,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresContentIdeaRepository } from "@outbound/infrastructure/content/postgres-content-idea-repository";
import { DailyContentIdeaScheduler } from "@outbound/infrastructure/content/daily-content-idea-scheduler";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("IDE-101 durable content idea discovery", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const repository = new PostgresContentIdeaRepository(database.db);
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
  const now = new Date("2026-08-20T06:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `ideas-a-${workspaceId}`, name: "Ideas A" },
      { id: otherWorkspaceId, slug: `ideas-b-${otherWorkspaceId}`, name: "Ideas B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Idea Owner", email: `ideas-${userId}@example.com` });
    await database.db.insert(offers).values({ id: offerId, workspaceId, name: "Noosphere", status: "draft", currentVersion: 1, category: "saas", valueProposition: "Relier contenu et revenu", targetAudience: "Équipes B2B", createdBy: userId });
    await database.db.insert(offerVersions).values({ id: offerVersionId, workspaceId, offerId, version: 1, name: "Noosphere", category: "saas", valueProposition: "Relier contenu et revenu", targetAudience: "Équipes B2B", publishedBy: userId, publishedAt: now });
    await database.db.insert(offerClaims).values({ id: claimId, workspaceId, offerVersionId, claim: "Noosphere relie le contenu aux conversations", validationStatus: "validated", evidenceUri: "https://example.com/proof" });
    await database.db.insert(icps).values({ id: icpId, workspaceId, name: "Équipes juridiques", currentVersion: 1 });
    await database.db.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "Équipes juridiques", confidence: "0.9000", criteria: {}, buyingCommittee: {}, problems: ["Recherche documentaire"], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedBy: userId, publishedAt: now });
    const snapshot = strategySnapshot(claimId);
    await database.db.insert(editorialStrategies).values({ id: strategyId, workspaceId, name: "Noosphere Legal", offerId, offerVersionId, icpId, icpVersionId, status: "active", currentVersion: 1, draft: snapshot, provider: "kimi-code", model: "k3", promptVersion: "test", createdBy: userId });
    await database.db.insert(editorialStrategyVersions).values({ id: strategyVersionId, workspaceId, strategyId, version: 1, offerVersionId, icpVersionId, snapshot, provider: "kimi-code", model: "k3", promptVersion: "test", publishedBy: userId, publishedAt: now });
  }, 30_000);

  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_operation_requests where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_idea_sources where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_ideas where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_idea_discovery_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from content_idea_schedules where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
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

  test("schedules once, resumes by cursor, deduplicates and isolates workspaces", async () => {
    const first = await repository.createDiscovery({ workspaceId, userId, requestKey: "ideas:integration:1", trigger: "manual", now });
    const replay = await repository.createDiscovery({ workspaceId, userId, requestKey: "ideas:integration:1", trigger: "manual", now });
    expect(replay.id).toBe(first.id);
    const queued = await database.client<{ count: number; priority: number }[]>`select count(*)::int as count, max(priority)::int as priority from jobs where workspace_id = ${workspaceId} and type = 'content.ideas.discover'`;
    expect(queued[0]?.count).toBe(1);
    expect(queued[0]?.priority).toBe(60);

    const context = await repository.loadDiscoveryContext({ workspaceId, runId: first.id });
    expect(context.strategy.allowedClaimIds).toEqual([claimId]);
    expect(context.internalEvidence.map((item) => item.key)).toContain(`offer_claim:${claimId}`);
    const source = context.internalEvidence[0]!;
    const candidate = { angle: "Pourquoi la recherche documentaire ralentit les équipes juridiques", rationale: "Le claim produit permet de traiter un problème explicite sans inventer de résultat.", audience: "Équipes juridiques", pillar: "Recherche documentaire", priority: 88, freshnessDays: 60, sourceKeys: [source.key], conceptKey: "temps recherche documentaire" };
    await repository.startRun({ workspaceId, runId: first.id, now });
    await repository.saveStep({ workspaceId, runId: first.id, cursor: 1, evidence: [source], candidates: [candidate], discoveredSourceCount: 0, now });
    await repository.saveStep({ workspaceId, runId: first.id, cursor: 1, evidence: [source], candidates: [candidate], discoveredSourceCount: 0, now });
    await repository.saveStep({ workspaceId, runId: first.id, cursor: 2, evidence: [source], candidates: [{ ...candidate, angle: "Un autre hook, le même concept", priority: 92 }], discoveredSourceCount: 0, now: new Date(now.getTime() + 1_000) });
    await repository.completeRun({ workspaceId, runId: first.id, partial: false, now: new Date(now.getTime() + 2_000) });

    const own = await repository.list({ workspaceId, limit: 20 });
    const other = await repository.list({ workspaceId: otherWorkspaceId, limit: 20 });
    expect(own.data).toHaveLength(1);
    expect(own.data[0]?.priority).toBe(92);
    expect(own.data[0]?.sources).toHaveLength(1);
    expect(other.data).toHaveLength(0);
    expect((await repository.findRun({ workspaceId, runId: first.id }))?.status).toBe("completed");

    const dailyNow = new Date("2026-08-21T04:00:00.000Z");
    const scheduler = new DailyContentIdeaScheduler(database.db, repository, { now: () => dailyNow });
    expect(await scheduler.reconcile()).toBe(1);
    expect(await scheduler.reconcile()).toBe(0);
    const dailyRuns = await database.client<{ trigger: string }[]>`select trigger from content_idea_discovery_runs where workspace_id = ${workspaceId} and trigger = 'daily'`;
    expect(dailyRuns).toHaveLength(1);
  });
});

function strategySnapshot(claimId: string) { return { audience: { name: "Équipes juridiques", summary: "Juristes avec des documents dispersés", awareness: "problem_aware" as const }, pillars: [{ name: "Recherche documentaire", promise: "Retrouver les preuves", proofTypes: ["claim validé"] }, { name: "Sécurité", promise: "Garder le contrôle", proofTypes: ["audit"] }, { name: "Adoption", promise: "Déployer avec les équipes", proofTypes: ["chronologie"] }], voice: { traits: ["direct", "précis"], avoid: ["générique"] }, formats: ["linkedin_text" as const], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Échanger"], allowedClaimIds: [claimId], forbiddenTopics: [] }; }
