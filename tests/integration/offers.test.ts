import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, offers, workspaces } from "@outbound/infrastructure/database/schema";
import { createOfferHttpHandler } from "@outbound/interface/http/offer-handler";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-010 offers", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const context = { userId, workspaceId, role: "operator" as "viewer" | "operator" | "reviewer" | "admin" | "owner" };
  const handle = createOfferHttpHandler({ contextResolver: { async resolve() { return context; } }, database: database.db });
  let offerId: string;
  let versionId: string;

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `offer-a-${workspaceId}`, name: "Offers A" },
      { id: otherWorkspaceId, slug: `offer-b-${otherWorkspaceId}`, name: "Offers B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Offer Owner", email: `offer-${userId}@example.com` });
  });

  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table offer_claims disable trigger "offer_claims_immutable_trg"`;
    await database.client`alter table offer_versions disable trigger "offer_versions_immutable_trg"`;
    try {
      await database.client`delete from offer_claims where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from offer_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await database.client`delete from offers where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    } finally {
      await database.client`alter table offer_versions enable trigger "offer_versions_immutable_trg"`;
      await database.client`alter table offer_claims enable trigger "offer_claims_immutable_trg"`;
    }
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    await database.close();
  });

  const request = (path: string, method = "GET", body?: unknown) => {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    return handle(new Request(`http://localhost${path}`, init));
  };

  test("creates, validates, publishes and preserves immutable offer versions", async () => {
    const created = await request("/api/v1/offers", "POST", { name: "Revenue OS", category: "saas" });
    expect(created.status).toBe(201);
    offerId = ((await created.json()) as { id: string }).id;

    context.role = "admin";
    const incomplete = await request(`/api/v1/offers/${offerId}/actions/publish`, "POST", {});
    expect(incomplete.status).toBe(422);
    expect(((await incomplete.json()) as { missing: string[] }).missing).toEqual(expect.arrayContaining(["valueProposition", "claims"]));

    const patched = await request(`/api/v1/offers/${offerId}`, "PATCH", {
      valueProposition: "Automate revenue operations with verified workflows",
      targetAudience: "Revenue teams",
      claims: [
        { claim: "Reduces manual qualification work", validationStatus: "validated", evidenceUri: "https://example.com/proof" },
        { claim: "May improve conversion", validationStatus: "hypothesis" },
      ],
    });
    expect(patched.status).toBe(200);

    context.role = "operator";
    const forbidden = await request(`/api/v1/offers/${offerId}/actions/publish`, "POST", {});
    expect(forbidden.status).toBe(403);
    context.role = "admin";
    const published = await request(`/api/v1/offers/${offerId}/actions/publish`, "POST", {});
    expect(published.status).toBe(201);
    const version = (await published.json()) as { id: string; version: number; claims: unknown[] };
    versionId = version.id;
    expect(version.version).toBe(1);
    expect(version.claims).toHaveLength(2);

    const replay = await request(`/api/v1/offers/${offerId}/actions/publish`, "POST", {});
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as { id: string; version: number }).id).toBe(versionId);

    await request(`/api/v1/offers/${offerId}`, "PATCH", { valueProposition: "Automate all revenue operations" });
    const next = await request(`/api/v1/offers/${offerId}/actions/publish`, "POST", {});
    expect(((await next.json()) as { version: number }).version).toBe(2);
    const versions = await request(`/api/v1/offers/${offerId}/versions`);
    expect(((await versions.json()) as { data: unknown[] }).data).toHaveLength(2);

    await expectRejected(() => database.client`update offer_versions set category = 'service' where id = ${versionId}`, "OFFER_VERSION_IMMUTABLE");
    const retained = await database.client<{ value_proposition: string }[]>`select value_proposition from offer_versions where id = ${versionId}`;
    expect(retained[0]?.value_proposition).toContain("verified workflows");
  });

  test("isolates workspaces and rejects invalidated claims", async () => {
    context.role = "operator";
    context.workspaceId = otherWorkspaceId;
    const other = await request("/api/v1/offers", "POST", { name: "Revenue OS", category: "service" });
    expect(other.status).toBe(201);
    context.workspaceId = otherWorkspaceId;
    const listed = await request("/api/v1/offers");
    expect(((await listed.json()) as { data: Array<{ name: string }> }).data).toHaveLength(1);
    context.workspaceId = workspaceId;
    await request(`/api/v1/offers/${offerId}`, "PATCH", { claims: [{ claim: "No longer true", validationStatus: "invalidated" }] });
    context.role = "admin";
    const invalid = await request(`/api/v1/offers/${offerId}/actions/publish`, "POST", {});
    expect(invalid.status).toBe(422);
  });
});

async function expectRejected(operation: () => Promise<unknown>, message: string) {
  let error: unknown;
  try { await operation(); } catch (caught) { error = caught; }
  expect(error).toBeDefined();
  expect(String(error)).toContain(message);
}
