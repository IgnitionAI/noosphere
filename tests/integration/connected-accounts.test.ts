import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { createConnectedAccountHttpHandler } from "@outbound/interface/http/connected-account-handler";
import type { UnipileClient, UnipileAccountSnapshot } from "@outbound/infrastructure/integrations/unipile-client";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-035 connected accounts", () => {
  if (!databaseUrl) return;
  process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY ?? "test-connected-account-encryption-key";
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const providerAccountId = `unipile-${crypto.randomUUID()}`;
  const secret = "webhook-test-secret";
  const context = { userId, workspaceId, role: "admin" as "admin" | "operator" | "viewer" };
  const snapshot: UnipileAccountSnapshot = {
    providerAccountId,
    displayName: "Sales sender",
    status: "connected",
    capabilities: { linkedin: { messaging: false }, email: { sending: true } },
    quotas: { daily: 100 },
  };
  const client: UnipileClient = {
    async connect() { return snapshot; },
    async check() { return snapshot; },
  };
  const handle = createConnectedAccountHttpHandler({
    database: database.db,
    contextResolver: { async resolve() { return context; } },
    client,
    webhookSecret: secret,
  });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.client`insert into workspaces (id, slug, name) values (${workspaceId}, ${`f035-a-${workspaceId}`}, 'F-035 A'), (${otherWorkspaceId}, ${`f035-b-${otherWorkspaceId}`}, 'F-035 B')`;
    await database.client`insert into auth_users (id, name, email) values (${userId}, 'Connected Account Tester', ${`f035-${userId}@example.com`})`;
  });

  afterAll(async () => {
    await database.client.begin(async (sql) => {
      await sql`delete from connected_account_webhooks where connected_account_id in (select id from connected_accounts where workspace_id in (${workspaceId}, ${otherWorkspaceId}))`;
      await sql`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs disable trigger user`;
      await sql`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs enable trigger user`;
      await sql`delete from connected_accounts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from auth_users where id = ${userId}`;
      await sql`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  function send(method: string, path: string, body?: unknown) {
    return handle(new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  }

  test("connects without exposing token, isolates workspace and rejects operator mutation", async () => {
    const connected = await send("POST", "/api/v1/connected-accounts", { providerAccountId, accessToken: "top-secret-token" });
    expect(connected.status).toBe(201);
    const exposed = await connected.json() as Record<string, unknown>;
    expect(exposed).not.toHaveProperty("encryptedSecret");
    expect(JSON.stringify(exposed)).not.toContain("top-secret-token");
    const stored = await database.client<{ encrypted_secret: string }[]>`select encrypted_secret from connected_accounts where id = ${accountId}`;
    expect(stored).toHaveLength(0);
    const row = await database.client<{ id: string; encrypted_secret: string }[]>`select id, encrypted_secret from connected_accounts where workspace_id = ${workspaceId} and provider_account_id = ${providerAccountId}`;
    expect(row[0]?.encrypted_secret).not.toContain("top-secret-token");
    expect((await send("POST", "/api/v1/connected-accounts", { providerAccountId, accessToken: "another-token" })).status).toBe(409);

    context.role = "operator";
    expect((await send("DELETE", `/api/v1/connected-accounts/${(exposed as { id: string }).id}`)).status).toBe(403);
    expect((await send("POST", "/api/v1/connected-accounts", { providerAccountId: `other-${providerAccountId}`, accessToken: "x" })).status).toBe(403);
    context.role = "admin";
    context.workspaceId = otherWorkspaceId;
    expect((await send("GET", "/api/v1/connected-accounts")).status).toBe(200);
    expect(((await (await send("GET", "/api/v1/connected-accounts")).json()) as { data: unknown[] }).data).toHaveLength(0);
    context.workspaceId = workspaceId;
  });

  test("verifies and deduplicates signed webhook delivery", async () => {
    const body = JSON.stringify({ id: `evt-${crypto.randomUUID()}`, accountId: providerAccountId, status: "degraded", capabilities: { email: { sending: false } } });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const first = await handle(new Request("http://localhost/api/v1/webhooks/unipile", { method: "POST", headers: { "x-unipile-signature": `sha256=${signature}`, "content-type": "application/json" }, body }));
    expect(first.status).toBe(202);
    const replay = await handle(new Request("http://localhost/api/v1/webhooks/unipile", { method: "POST", headers: { "x-unipile-signature": `sha256=${signature}`, "content-type": "application/json" }, body }));
    expect(replay.status).toBe(202);
    expect(((await replay.json()) as { duplicate: boolean }).duplicate).toBe(true);
    const status = await database.client<{ status: string }[]>`select status from connected_accounts where workspace_id = ${workspaceId} and provider_account_id = ${providerAccountId}`;
    expect(status[0]?.status).toBe("degraded");
    const events = await database.client<{ count: number }[]>`select count(*)::int as count from outbox_events where workspace_id = ${workspaceId} and event_type = 'ConnectedAccountStatusChanged'`;
    expect(events[0]?.count).toBe(2);

    const invalid = await handle(new Request("http://localhost/api/v1/webhooks/unipile", { method: "POST", headers: { "x-unipile-signature": "00", "content-type": "application/json" }, body }));
    expect(invalid.status).toBe(401);
    const webhooks = await database.client<{ count: number }[]>`select count(*)::int as count from connected_account_webhooks where event_id = ${(JSON.parse(body) as { id: string }).id}`;
    expect(webhooks[0]?.count).toBe(1);

    const alertsResponse = await send("GET", "/api/v1/account-health-alerts");
    expect(alertsResponse.status).toBe(200);
    const alerts = await alertsResponse.json() as { data: { id: string; status: string }[] };
    expect(alerts.data).toHaveLength(1);
    expect(alerts.data[0]?.status).toBe("active");
    const acknowledged = await send("POST", `/api/v1/account-health-alerts/${alerts.data[0]?.id}/actions/acknowledge`);
    expect(acknowledged.status).toBe(200);
    expect((await acknowledged.json() as { status: string }).status).toBe("acknowledged");

    context.role = "viewer";
    expect((await send("POST", `/api/v1/account-health-alerts/${alerts.data[0]?.id}/actions/acknowledge`)).status).toBe(403);
    context.role = "admin";
  });

  test("resumes onboarding idempotently and exposes provider-confirmed quota channels only", async () => {
    const first = await send("POST", "/api/v1/connected-accounts/onboarding", { channel: "email" });
    expect(first.status).toBe(201);
    const onboarding = await first.json() as { id: string; status: string; channel: string; hostedUrl: string };
    expect(onboarding.status).toBe("awaiting_callback");
    expect(onboarding.channel).toBe("email");
    expect(onboarding.hostedUrl).not.toContain("token");

    const resumed = await send("POST", "/api/v1/connected-accounts/onboarding", { channel: "email" });
    expect(resumed.status).toBe(201);
    expect((await resumed.json() as { id: string }).id).toBe(onboarding.id);

    const completed = await send("POST", `/api/v1/connected-accounts/onboarding/${onboarding.id}/actions/complete`, {
      providerAccountId: `onboarded-${crypto.randomUUID()}`,
      accessToken: "onboarding-secret",
      displayName: "Onboarded sender",
    });
    expect(completed.status).toBe(201);
    const completion = await completed.json() as { onboarding: { status: string }; account: { id: string } };
    expect(completion.onboarding.status).toBe("completed");
    expect(completion.account.id).toBeString();
    expect(JSON.stringify(completion)).not.toContain("onboarding-secret");

    const quota = await send("GET", `/api/v1/connected-accounts/${completion.account.id}/quotas`);
    expect(quota.status).toBe(200);
    const quotaBody = await quota.json() as { timezone: string; channels: { channel: string; sentToday: number }[] };
    expect(quotaBody.timezone).toBe("UTC");
    expect(quotaBody.channels.map((channel) => channel.channel)).toEqual(["email"]);
    expect(quotaBody.channels[0]?.sentToday).toBe(0);

    context.role = "viewer";
    expect((await send("GET", `/api/v1/connected-accounts/${completion.account.id}/quotas`)).status).toBe(403);
    context.role = "admin";
  });
});
