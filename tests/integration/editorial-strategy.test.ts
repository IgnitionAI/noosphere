import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { EditorialStrategyApplication } from "@outbound/application/content/editorial-strategy";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";
import { PostgresEditorialStrategyRepository } from "@outbound/infrastructure/content/postgres-editorial-strategy-repository";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  authUsers,
  icps,
  icpVersions,
  offerClaims,
  offers,
  offerVersions,
  workspaces,
} from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("Noosphere editorial strategy persistence", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let generated = 0;
  const repository = new PostgresEditorialStrategyRepository(database.db);
  const application = new EditorialStrategyApplication(repository, {
    async generate({ grounding }) {
      generated += 1;
      return {
        snapshot: snapshot(grounding.offer.claims[0]!.id),
        metadata: { provider: "kimi-code", model: "k3", promptVersion: "integration-v1", aiRunId: null },
      };
    },
  });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `strategy-a-${workspaceId}`, name: "Strategy A" },
      { id: otherWorkspaceId, slug: `strategy-b-${otherWorkspaceId}`, name: "Strategy B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Strategy Owner", email: `strategy-${userId}@example.com` });
    await seedGrounding(workspaceId, "Noosphere A");
    await seedGrounding(otherWorkspaceId, "Noosphere B");
  });

  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`drop trigger if exists editorial_strategy_versions_immutable_trg on editorial_strategy_versions`;
    await database.client`alter table offer_claims disable trigger offer_claims_immutable_trg`;
    await database.client`alter table offer_versions disable trigger offer_versions_immutable_trg`;
    await database.client`alter table icp_versions disable trigger icp_versions_immutable_trg`;
    try {
      await database.client`delete from content_operation_requests where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from editorial_strategy_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from editorial_strategies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from offer_claims where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from offer_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from offers where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from icp_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from icps where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from auth_users where id = ${userId}`;
      await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    } finally {
      await database.client`alter table offer_claims enable trigger offer_claims_immutable_trg`;
      await database.client`alter table offer_versions enable trigger offer_versions_immutable_trg`;
      await database.client`alter table icp_versions enable trigger icp_versions_immutable_trg`;
      await database.client`create trigger editorial_strategy_versions_immutable_trg before update or delete on editorial_strategy_versions for each row execute function reject_editorial_strategy_version_mutation()`;
      await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    }
    await database.close();
  });

  test("derivation and publication replay safely by request key", async () => {
    const derived = await application.derive({ workspaceId, userId, requestKey: "derive:stable" });
    const replay = await application.derive({ workspaceId, userId, requestKey: "derive:stable" });
    expect(replay.id).toBe(derived.id);
    expect(generated).toBe(1);

    const published = await application.publish({ workspaceId, userId, requestKey: "publish:stable" });
    const publishedReplay = await application.publish({ workspaceId, userId, requestKey: "publish:stable" });
    expect(publishedReplay.id).toBe(published.id);
    expect(publishedReplay.version).toBe(1);

    const concurrent = await Promise.all(Array.from({ length: 5 }, () =>
      application.publish({ workspaceId, userId, requestKey: "publish:concurrent" })
    ));
    expect(new Set(concurrent.map((version) => version.id)).size).toBe(1);
    expect(concurrent[0]?.id).toBe(published.id);
  });

  test("isolates workspaces and keeps published versions immutable", async () => {
    const first = await repository.find(workspaceId);
    expect(first?.workspaceId).toBe(workspaceId);
    expect(await repository.find(otherWorkspaceId)).toBeNull();

    const other = await application.derive({ workspaceId: otherWorkspaceId, userId, requestKey: "derive:other" });
    expect(other.workspaceId).toBe(otherWorkspaceId);
    expect(other.id).not.toBe(first?.id);

    const published = await application.publish({ workspaceId, userId, requestKey: "publish:immutable" });
    await expectRejected(
      () => database.client`update editorial_strategy_versions set version = 99 where id = ${published.id}`,
      "EDITORIAL_STRATEGY_VERSION_IMMUTABLE",
    );
  });

  async function seedGrounding(targetWorkspaceId: string, name: string) {
    const offerId = crypto.randomUUID();
    const offerVersionId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    const icpId = crypto.randomUUID();
    const icpVersionId = crypto.randomUUID();
    await database.db.insert(offers).values({
      id: offerId,
      workspaceId: targetWorkspaceId,
      name,
      category: "saas",
      valueProposition: "Relier création et capture de demande",
      targetAudience: "Fondateurs B2B",
      createdBy: userId,
      currentVersion: 1,
    });
    await database.db.insert(offerVersions).values({
      id: offerVersionId,
      workspaceId: targetWorkspaceId,
      offerId,
      version: 1,
      name,
      category: "saas",
      valueProposition: "Relier création et capture de demande",
      targetAudience: "Fondateurs B2B",
      publishedBy: userId,
      publishedAt: new Date(),
    });
    await database.db.insert(offerClaims).values({
      id: claimId,
      workspaceId: targetWorkspaceId,
      offerVersionId,
      claim: "Unifie les opérations Inbound et Outbound",
      validationStatus: "validated",
      evidenceUri: "https://example.test/noosphere-proof",
    });
    await database.db.insert(icps).values({ id: icpId, workspaceId: targetWorkspaceId, name: "SaaS B2B", currentVersion: 1 });
    await database.db.insert(icpVersions).values({
      id: icpVersionId,
      workspaceId: targetWorkspaceId,
      icpId,
      version: 1,
      name: "SaaS B2B",
      confidence: "0.9000",
      criteria: { industries: ["software"] },
      buyingCommittee: [{ title: "Founder" }],
      problems: ["Acquisition fragmentée"],
      signals: ["Équipe commerciale en croissance"],
      exclusions: [],
      unknowns: [],
      unresolvedContradictions: [],
      blockedFindings: [],
      publishedBy: userId,
      publishedAt: new Date(),
    });
  }
});

function snapshot(claimId: string): EditorialStrategySnapshot {
  return {
    audience: { name: "Fondateurs SaaS B2B", summary: "Équipes qui veulent relier contenu, prospection et appels.", awareness: "solution_aware" },
    pillars: [
      { name: "Système", promise: "Montrer le pipeline complet.", proofTypes: ["capture produit"] },
      { name: "Preuves", promise: "Expliquer les décisions avec leurs sources.", proofTypes: ["journal d’audit"] },
      { name: "Terrain", promise: "Partager les apprentissages des conversations.", proofTypes: ["conversation anonymisée"] },
    ],
    voice: { traits: ["direct", "technique"], avoid: ["hooks interchangeables"] },
    formats: ["linkedin_text"],
    cadence: { postsPerWeek: 3, preferredDays: [2, 3, 5], timezone: "Europe/Paris" },
    callsToAction: ["Demander un retour terrain"],
    allowedClaimIds: [claimId],
    forbiddenTopics: ["chiffres non sourcés"],
  };
}

async function expectRejected(operation: () => Promise<unknown>, message: string) {
  let error: unknown;
  try { await operation(); } catch (caught) { error = caught; }
  expect(error).toBeDefined();
  expect(String(error)).toContain(message);
}
