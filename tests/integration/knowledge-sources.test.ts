import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  authUsers,
  jobs,
  knowledgeClaims,
  knowledgeSources,
  outboxEvents,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresKnowledgeService } from "@outbound/infrastructure/knowledge/postgres-knowledge-service";
import { PostgresKnowledgeRetriever } from "@outbound/infrastructure/knowledge/postgres-knowledge-retriever";
import { KnowledgeSourceExpirationProcessor } from "@outbound/infrastructure/knowledge/knowledge-source-expiration";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-050 knowledge sources", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const now = new Date("2026-08-09T12:00:00.000Z");
  const service = new PostgresKnowledgeService(database.db, { now: () => now }, { generate: () => crypto.randomUUID() });
  const retriever = new PostgresKnowledgeRetriever(database.db, { now: () => now });
  const queue = new PostgresJobQueue(database.client);

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `f050-${workspaceId}`, name: "F-050" },
      { id: otherWorkspaceId, slug: `f050-other-${otherWorkspaceId}`, name: "F-050 Other" },
    ]);
    await database.db.insert(authUsers).values({ id: ownerId, name: "F-050 Owner", email: `f050-${ownerId}@example.com` });
  });

  afterAll(async () => {
    await database.client.begin(async (sql) => {
      await sql`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from knowledge_claim_sources where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from knowledge_claims where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from knowledge_sources where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs disable trigger user`;
      await sql`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs enable trigger user`;
      await sql`delete from auth_users where id = ${ownerId}`;
      await sql`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  test("validates only sourced claims and retrieves them with PostgreSQL FTS", async () => {
    const source = await service.createSource({
      workspaceId,
      actorUserId: ownerId,
      type: "proof",
      title: "Déploiement privé vérifié",
      content: "IgnitionRAG se déploie dans une infrastructure privée contrôlée par le client.",
      authorName: "IgnitionAI",
      publishedAt: new Date("2026-08-01T00:00:00.000Z"),
      freshnessUntil: new Date("2026-09-01T00:00:00.000Z"),
      researchDocumentId: null,
    });
    const claim = await service.createClaim({ workspaceId, actorUserId: ownerId, claim: "Déploiement possible en infrastructure privée", offerClaimId: null, sourceIds: [source.id] });
    await expect(service.validateClaim({ workspaceId, actorUserId: ownerId, claimId: claim.id })).rejects.toThrow("KNOWLEDGE_CLAIM_SOURCE_INVALID");
    await service.validateSource({ workspaceId, actorUserId: ownerId, sourceId: source.id });
    await service.validateClaim({ workspaceId, actorUserId: ownerId, claimId: claim.id });

    const matches = await retriever.search({ workspaceId, query: "cabinet juridique infrastructure privée objection sécurité", limit: 10 });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ claimId: claim.id, claim: "Déploiement possible en infrastructure privée" });
    expect(matches[0]!.sources[0]).toMatchObject({ sourceId: source.id, title: "Déploiement privé vérifié" });
    expect(await retriever.search({ workspaceId: otherWorkspaceId, query: "cabinet juridique infrastructure privée objection sécurité", limit: 10 })).toEqual([]);
  });

  test("withdrawal immediately removes evidence and makes the claim need re-sourcing", async () => {
    const [source] = await database.db.select().from(knowledgeSources).where(eq(knowledgeSources.workspaceId, workspaceId)).limit(1);
    const [claim] = await database.db.select().from(knowledgeClaims).where(eq(knowledgeClaims.workspaceId, workspaceId)).limit(1);
    await service.withdrawSource({ workspaceId, actorUserId: ownerId, sourceId: source!.id, reason: "Preuve remplacée" });
    expect(await retriever.search({ workspaceId, query: "infrastructure privée", limit: 10 })).toEqual([]);
    expect((await service.listClaims({ workspaceId }))[0]).toMatchObject({ id: claim!.id, effectiveStatus: "needs_resourcing" });
    expect(await database.db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.action, "KnowledgeSourceWithdrawn")))).toHaveLength(1);
  });

  test("rejects prospect PII before persisting a source", async () => {
    await expect(service.createSource({
      workspaceId,
      actorUserId: ownerId,
      type: "customer_case",
      title: "Contact client",
      content: "Écrire à prospect@example.com",
      authorName: "IgnitionAI",
      publishedAt: now,
      freshnessUntil: new Date("2026-09-01T00:00:00.000Z"),
      researchDocumentId: null,
    })).rejects.toThrow("KNOWLEDGE_PROSPECT_PII_DETECTED");
    expect(await database.db.select().from(knowledgeSources).where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.title, "Contact client")))).toHaveLength(0);
  });

  test("expires a validated source once through its durable job", async () => {
    const source = await service.createSource({
      workspaceId,
      actorUserId: ownerId,
      type: "objection_response",
      title: "Réponse sécurité",
      content: "Le déploiement privé conserve les données dans le périmètre du client.",
      authorName: "IgnitionAI",
      publishedAt: now,
      freshnessUntil: new Date("2026-08-10T00:00:00.000Z"),
      researchDocumentId: null,
    });
    await service.validateSource({ workspaceId, actorUserId: ownerId, sourceId: source.id });
    const expirationTime = new Date("2026-08-10T00:00:01.000Z");
    const [job] = await queue.lease({ workerId: "f050-expiry", types: ["knowledge.source.expire"], limit: 1, leaseMs: 30_000, now: expirationTime });
    expect(job).toBeDefined();
    const expirationService = new PostgresKnowledgeService(database.db, { now: () => expirationTime }, { generate: () => crypto.randomUUID() });
    await new KnowledgeSourceExpirationProcessor(expirationService, queue, { now: () => expirationTime }).process(job!);
    expect(await expirationService.expireSource({ workspaceId, sourceId: source.id })).toBe(false);
    expect((await database.db.select().from(knowledgeSources).where(eq(knowledgeSources.id, source.id)))[0]).toMatchObject({ status: "expired" });
    expect(await database.db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.action, "KnowledgeSourceExpired"), eq(auditLogs.subjectId, source.id)))).toHaveLength(1);
  });
});
