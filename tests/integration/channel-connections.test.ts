import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { PostgresUnipileChannelConnections } from "@outbound/infrastructure/channels/postgres-unipile-channel-connections";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, connectedAccounts, workspaces } from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("workspace Unipile channel connections", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const manager = new PostgresUnipileChannelConnections(database.db, {
    dsn: "https://unipile.fixture",
    apiKey: "fixture-secret",
    fetchImpl: (async () => Response.json({
      items: [
        { id: "wa-healthy", type: "WHATSAPP", name: "33749628470", sources: [{ status: "OK" }] },
        { id: "wa-broken", type: "WHATSAPP", name: "33768483054", sources: [{ status: "CREDENTIALS" }] },
        { id: "li-healthy", type: "LINKEDIN", name: "Owner", sources: [{ status: "OK" }] },
      ],
    })) as unknown as typeof fetch,
  });

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `channels-a-${workspaceId}`, name: "Channels A" },
      { id: otherWorkspaceId, slug: `channels-b-${otherWorkspaceId}`, name: "Channels B" },
    ]);
    await database.db.insert(authUsers).values({
      id: userId,
      name: "Channel owner",
      email: `channels-${userId}@example.com`,
    });
  });

  afterAll(async () => {
    await database.client`delete from workspace_channel_accounts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from connected_accounts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.close();
  });

  test("validates provider health and isolates the selection per workspace", async () => {
    const accounts = await manager.list(workspaceId, "whatsapp");
    expect(accounts).toEqual([
      { id: "wa-healthy", name: "+33749628470", channel: "whatsapp", healthy: true, selected: false },
      { id: "wa-broken", name: "+33768483054", channel: "whatsapp", healthy: false, selected: false },
    ]);

    await manager.select({
      workspaceId,
      channel: "whatsapp",
      providerAccountId: "wa-healthy",
      selectedBy: userId,
      now: new Date("2026-08-04T12:00:00.000Z"),
    });
    expect(await manager.selectedAccountId(workspaceId, "whatsapp")).toBe("wa-healthy");
    expect(await manager.resolveHealthyAccount(workspaceId, "whatsapp")).toBe("wa-healthy");
    expect(await manager.selectedAccountId(otherWorkspaceId, "whatsapp")).toBeNull();
    await expect(manager.resolveHealthyAccount(otherWorkspaceId, "whatsapp"))
      .rejects.toMatchObject({ code: "UNIPILE_ACCOUNT_NOT_SELECTED", status: 409 });

    await expect(manager.select({
      workspaceId,
      channel: "whatsapp",
      providerAccountId: "wa-broken",
      selectedBy: userId,
      now: new Date(),
    })).rejects.toMatchObject({ code: "UNIPILE_ACCOUNT_UNHEALTHY", status: 409 });
  });

  test("automatically selects the only healthy connected account for a channel", async () => {
    await database.db.insert(connectedAccounts).values({
      workspaceId,
      provider: "unipile",
      providerAccountId: "li-healthy",
      displayName: "Owner",
      status: "connected",
      capabilities: { linkedin: { sending: true } },
      encryptedSecret: "fixture",
      createdBy: userId,
    });

    expect(await manager.selectedAccountId(workspaceId, "linkedin")).toBeNull();
    expect(await manager.resolveHealthyAccount(workspaceId, "linkedin")).toBe("li-healthy");
    expect(await manager.selectedAccountId(workspaceId, "linkedin")).toBe("li-healthy");
  });
});
