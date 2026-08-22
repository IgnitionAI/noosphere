import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, offerClaims, offerVersions, offers, workspaces } from "@outbound/infrastructure/database/schema";
import { createMessagingStrategyHttpHandler } from "@outbound/interface/http/messaging-strategy-handler";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-012 messaging strategy HTTP", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const context = { userId, workspaceId, role: "operator" as "viewer" | "operator" | "reviewer" | "admin" | "owner" };
  const handler = createMessagingStrategyHttpHandler({
    database: database.db,
    contextResolver: { async resolve() { return context; } },
  });
  let strategyId: string;
  let claimId: string;
  let validatedClaimId: string;
  let offerVersionId: string;

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `messaging-a-${workspaceId}`, name: "Messaging A" },
      { id: otherWorkspaceId, slug: `messaging-b-${otherWorkspaceId}`, name: "Messaging B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Messaging Owner", email: `messaging-${userId}@example.com` });
    const offerId = crypto.randomUUID();
    offerVersionId = crypto.randomUUID();
    claimId = crypto.randomUUID();
    validatedClaimId = crypto.randomUUID();
    await database.db.insert(offers).values({ id: offerId, workspaceId, name: "Messaging Offer", valueProposition: "Value", targetAudience: "Teams" });
    await database.db.insert(offerVersions).values({ id: offerVersionId, workspaceId, offerId, version: 1, name: "Messaging Offer", category: "autre", valueProposition: "Value", targetAudience: "Teams", publishedBy: userId, publishedAt: new Date() });
    await database.db.insert(offerClaims).values([
      { id: claimId, workspaceId, offerVersionId, claim: "Unverified claim", validationStatus: "hypothesis", evidenceUri: null },
      { id: validatedClaimId, workspaceId, offerVersionId, claim: "Verified claim", validationStatus: "validated", evidenceUri: null },
    ]);
  });

  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`alter table messaging_strategy_versions disable trigger "messaging_strategy_versions_immutable_trg"`;
    await database.client`alter table ai_policy_versions disable trigger "ai_policy_versions_immutable_trg"`;
    await database.client`alter table offer_claims disable trigger "offer_claims_immutable_trg"`;
    await database.client`alter table offer_versions disable trigger "offer_versions_immutable_trg"`;
    try {
      await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from messaging_strategy_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from ai_policy_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from messaging_strategies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from ai_policies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from offer_claims where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from offer_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from offers where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from auth_users where id = ${userId}`;
      await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    } finally {
      await database.client`alter table messaging_strategy_versions enable trigger "messaging_strategy_versions_immutable_trg"`;
      await database.client`alter table ai_policy_versions enable trigger "ai_policy_versions_immutable_trg"`;
      await database.client`alter table offer_claims enable trigger "offer_claims_immutable_trg"`;
      await database.client`alter table offer_versions enable trigger "offer_versions_immutable_trg"`;
      await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    }
    await database.close();
  });

  const request = (path: string, method = "GET", body?: unknown) => new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const validRules = () => ({
    tone: "direct",
    angle: "value",
    templates: [{ channel: "email", body: "Bonjour {{contact.first_name}}", cta: "Répondre", maxLength: 5_000 }],
    allowedClaimIds: [],
  });

  test("operator receives 403 and unknown variables are listed", async () => {
    const created = await handler(request("/api/v1/messaging-strategies", "POST", { name: "Strategy", rules: validRules() }));
    expect(created.status).toBe(201);
    strategyId = ((await created.json()) as { id: string }).id;
    const forbidden = await handler(request(`/api/v1/messaging-strategies/${strategyId}/actions/publish`, "POST", {}));
    expect(forbidden.status).toBe(403);

    await handler(request(`/api/v1/messaging-strategies/${strategyId}`, "PATCH", {
      rules: { ...validRules(), templates: [{ ...validRules().templates[0], body: "Bonjour {{contact.titre}}" }] },
    }));
    context.role = "admin";
    const invalid = await handler(request(`/api/v1/messaging-strategies/${strategyId}/actions/publish`, "POST", {}));
    expect(invalid.status).toBe(422);
    const invalidBody = (await invalid.json()) as { errors: Array<{ variables: string[] }> };
    expect(invalidBody.errors[0]?.variables).toEqual(["contact.titre"]);
  });

  test("blocks hypothesis claims, publishes once and isolates workspaces", async () => {
    await handler(request(`/api/v1/messaging-strategies/${strategyId}`, "PATCH", {
      rules: { ...validRules(), offerVersionId, allowedClaimIds: [claimId] },
    }));
    const blocked = await handler(request(`/api/v1/messaging-strategies/${strategyId}/actions/publish`, "POST", {}));
    expect(blocked.status).toBe(422);
    expect(((await blocked.json()) as { blockedClaimIds: string[] }).blockedClaimIds).toEqual([claimId]);

    await handler(request(`/api/v1/messaging-strategies/${strategyId}`, "PATCH", {
      rules: { ...validRules(), offerVersionId, allowedClaimIds: [validatedClaimId] },
    }));
    const published = await handler(request(`/api/v1/messaging-strategies/${strategyId}/actions/publish`, "POST", {}));
    expect(published.status).toBe(201);
    const firstVersion = (await published.json()) as { id: string; version: number };
    expect(firstVersion.version).toBe(1);
    const replay = await handler(request(`/api/v1/messaging-strategies/${strategyId}/actions/publish`, "POST", {}));
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as { id: string }).id).toBe(firstVersion.id);
    const events = await database.client<{ count: number }[]>`select count(*)::int as count from outbox_events where workspace_id = ${workspaceId} and event_type = 'MessagingStrategyVersionPublished'`;
    const audits = await database.client<{ count: number }[]>`select count(*)::int as count from audit_logs where workspace_id = ${workspaceId} and action = 'MessagingStrategyVersionPublished'`;
    expect(events[0]?.count).toBe(1);
    expect(audits[0]?.count).toBe(1);

    context.workspaceId = otherWorkspaceId;
    const isolated = await handler(request("/api/v1/messaging-strategies"));
    expect(isolated.status).toBe(200);
    expect(((await isolated.json()) as { data: unknown[] }).data).toHaveLength(0);
    context.workspaceId = workspaceId;
  });

  test("publishes a fully autonomous AI policy without an approval gate", async () => {
    context.role = "operator";
    const created = await handler(request("/api/v1/ai-policies", "POST", {
      name: "Autopilote autonome",
      rules: {
        firstContactRequiresHumanApproval: false,
        responsesRequireHumanApproval: false,
        followUpsMayBeAutomated: true,
      },
    }));
    expect(created.status).toBe(201);
    const policyId = ((await created.json()) as { id: string }).id;
    expect((await handler(request(`/api/v1/ai-policies/${policyId}/actions/publish`, "POST", {}))).status).toBe(403);
    context.role = "admin";
    const published = await handler(request(`/api/v1/ai-policies/${policyId}/actions/publish`, "POST", {}));
    expect(published.status).toBe(201);
    const replay = await handler(request(`/api/v1/ai-policies/${policyId}/actions/publish`, "POST", {}));
    expect(replay.status).toBe(201);
  });
});
