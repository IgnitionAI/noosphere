import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, mcpOauthClients, workspaceMembers, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresMcpWriteLedger } from "@outbound/infrastructure/auth/postgres-mcp-write-ledger";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP write ledger PostgreSQL recovery", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const clientId = `mcp-test-${workspaceId}`;
  const workspaceSlug = `mcp-safe-writes-${workspaceId}`;
  const tool = "company_upsert" as const;
  const requestKey = crypto.randomUUID();
  const context = { workspaceId, userId, clientId, role: "owner" as const, scopes: ["mcp:write"] as const, audience: "/mcp" as const };
  const command = { operation: tool, requestKey, inputHash: "a".repeat(64), arguments: { requestKey, name: "Acme" } };

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: workspaceSlug, name: "MCP safe writes" });
    await database.db.insert(authUsers).values({ id: userId, name: "MCP Safe Writes User", email: `mcp-safe-writes-${userId}@example.test` });
    await database.db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner", status: "active" });
    await database.db.insert(mcpOauthClients).values({
      id: crypto.randomUUID(),
      clientId,
      clientName: "MCP Safe Writes Test Client",
      redirectUris: [],
      userId,
      workspaceId,
      workspaceSlug,
      allowedScopes: ["mcp:read", "mcp:write"],
    });
    await database.client`create table if not exists mcp_test_effects (request_key uuid primary key, effect_count integer not null)`;
  });

  afterAll(async () => {
    await database.client.begin(async (tx) => {
      await tx`delete from mcp_test_effects where request_key in (select request_key from mcp_write_operations where workspace_id = ${workspaceId})`;
      await tx`delete from mcp_write_operations where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_oauth_audit_events where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_oauth_clients where client_id = ${clientId}`;
      await tx`delete from workspace_members where workspace_id = ${workspaceId} and user_id = ${userId}`;
      await tx`delete from auth_users where id = ${userId}`;
      await tx`delete from workspaces where id = ${workspaceId}`;
      await tx`drop table if exists mcp_test_effects`;
    });
    await database.close();
  });

  test("replays persistently and rejects hash divergence", async () => {
    const ledger = new PostgresMcpWriteLedger(database.db);
    let effects = 0;
    const effect = async () => { effects += 1; return { id: crypto.randomUUID(), version: 1, state: "created", operation: tool, correlationId: crypto.randomUUID() }; };
    const first = await ledger.run(context, command, effect);
    const replay = await new PostgresMcpWriteLedger(database.db).run(context, command, effect);
    expect(replay.id).toBe(first.id);
    expect(effects).toBe(1);
    await expect(new PostgresMcpWriteLedger(database.db).run(context, { ...command, inputHash: "b".repeat(64) }, effect)).rejects.toThrow("MCP_WRITE_IDEMPOTENCY_CONFLICT");
  });

  test("atomic mutation rolls back on crash hook and retries exactly once", async () => {
    const key = crypto.randomUUID();
    const cmd = { ...command, requestKey: key, inputHash: "d".repeat(64) };
    let crash = true;
    const effect = async (tx: Parameters<Parameters<typeof database.db.transaction>[0]>[0]) => {
      await tx.execute(sql`insert into mcp_test_effects (request_key, effect_count) values (${key}, 1)`);
      if (crash) throw new Error("crash-hook");
      return { id: crypto.randomUUID(), version: 1, state: "created", operation: tool, correlationId: crypto.randomUUID() };
    };
    await expect(new PostgresMcpWriteLedger(database.db).runAtomic(context, cmd, effect)).rejects.toThrow("crash-hook");
    const afterCrash = await database.client`select effect_count from mcp_test_effects where request_key = ${key}`;
    expect(afterCrash.length).toBe(0);
    const pending = await database.client`select status from mcp_write_operations where request_key = ${key}`;
    expect(pending.length).toBe(0);
    crash = false;
    const completed = await new PostgresMcpWriteLedger(database.db).runAtomic(context, cmd, effect);
    expect(completed.state).toBe("created");
    const afterRetry = await database.client`select effect_count from mcp_test_effects where request_key = ${key}`;
    expect(afterRetry[0]?.effect_count).toBe(1);
  });

  test("atomic legacy non-completed rows require recovery and never replay the effect", async () => {
    const seeded = [
      { status: "running", lease: "active-process", expiry: "active" },
      { status: "running", lease: "expired-process", expiry: "expired" },
      { status: "failed", lease: null, expiry: null },
      { status: "failed", lease: "failed-process", expiry: "active" },
    ] as const;
    const keys = seeded.map(() => crypto.randomUUID());
    for (const [index, row] of seeded.entries()) {
      const key = keys[index]!;
      const leaseExpiresAt = row.expiry === "active" ? new Date(Date.now() + 60_000) : row.expiry === "expired" ? new Date(Date.now() - 60_000) : null;
      if (row.lease && leaseExpiresAt) {
        await database.client`insert into mcp_write_operations (workspace_id, client_id, user_id, tool, request_key, input_hash, status, correlation_id, lease_owner, lease_expires_at) values (${workspaceId}, ${clientId}, ${userId}, ${tool}, ${key}, ${"e".repeat(64)}, ${row.status}, ${crypto.randomUUID()}, ${row.lease}, ${leaseExpiresAt})`;
      } else {
        await database.client`insert into mcp_write_operations (workspace_id, client_id, user_id, tool, request_key, input_hash, status, correlation_id) values (${workspaceId}, ${clientId}, ${userId}, ${tool}, ${key}, ${"e".repeat(64)}, ${row.status}, ${crypto.randomUUID()})`;
      }
    }
    let effects = 0;
    for (const key of keys) {
      await expect(new PostgresMcpWriteLedger(database.db).runAtomic(context, { ...command, requestKey: key, inputHash: "e".repeat(64) }, async () => {
        effects += 1;
        return { id: crypto.randomUUID(), version: 1, state: "created", operation: tool, correlationId: crypto.randomUUID() };
      })).rejects.toThrow("MCP_WRITE_RECOVERY_REQUIRED");
    }
    expect(effects).toBe(0);
    const rows = await database.client`select request_key, status, lease_owner from mcp_write_operations where request_key = any(${keys}::uuid[])`;
    expect(keys.map((key) => rows.find((row) => row.request_key === key)).map((row) => ({ status: row?.status, lease: row?.lease_owner }))).toEqual([
      { status: "running", lease: "active-process" },
      { status: "running", lease: "expired-process" },
      { status: "failed", lease: null },
      { status: "failed", lease: "failed-process" },
    ]);
  });

  test("atomic crash observes an in-progress audit and never leaves it accepted", async () => {
    const key = crypto.randomUUID();
    const cmd = { ...command, requestKey: key, inputHash: "f".repeat(64) };
    let observedAuditOutcome: string | undefined;
    const effect = async (tx: Parameters<Parameters<typeof database.db.transaction>[0]>[0]) => {
      const audits = await database.client`select outcome from mcp_oauth_audit_events where workspace_id = ${workspaceId} and subject_id = ${tool} order by created_at desc limit 1`;
      observedAuditOutcome = audits[0]?.outcome;
      await tx.execute(sql`insert into mcp_test_effects (request_key, effect_count) values (${key}, 1)`);
      throw new Error("crash-hook-audit");
    };
    await expect(new PostgresMcpWriteLedger(database.db).runAtomic(context, cmd, effect)).rejects.toThrow("crash-hook-audit");
    expect(observedAuditOutcome).toBe("in_progress");
    const audits = await database.client`select outcome from mcp_oauth_audit_events where workspace_id = ${workspaceId} and subject_id = ${tool} order by created_at desc limit 1`;
    expect(audits[0]?.outcome).not.toBe("accepted");
  });

  test("active lease serializes concurrent callers", async () => {
    const key = crypto.randomUUID();
    const cmd = { ...command, requestKey: key };
    const ledger = new PostgresMcpWriteLedger(database.db);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = ledger.run(context, cmd, async () => {
      await held;
      return { id: crypto.randomUUID(), version: 1, state: "created", operation: tool, correlationId: crypto.randomUUID() };
    });
    for (let i = 0; i < 50; i += 1) {
      const rows = await database.client`select 1 from mcp_write_operations where request_key = ${key}`;
      if (rows.length) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await expect(new PostgresMcpWriteLedger(database.db).run(context, cmd, async () => {
      throw new Error("second effect must not execute");
    })).rejects.toThrow("MCP_WRITE_IN_PROGRESS");
    release();
    await first;
  });

  test("expired running lease requires reconciliation and never replays effect", async () => {
    const key = crypto.randomUUID();
    await database.client`insert into mcp_test_effects (request_key, effect_count) values (${key}, 1)`;
    await database.client`insert into mcp_write_operations (workspace_id, client_id, user_id, tool, request_key, input_hash, status, correlation_id, lease_owner, lease_expires_at) values (${workspaceId}, ${clientId}, ${userId}, ${tool}, ${key}, ${"c".repeat(64)}, 'running', ${crypto.randomUUID()}, 'crashed-process', now() - interval '1 minute')`;
    let effects = 0;
    await expect(new PostgresMcpWriteLedger(database.db).run(context, { ...command, requestKey: key, inputHash: "c".repeat(64) }, async () => {
      effects += 1;
      return { id: crypto.randomUUID(), version: 1, state: "created", operation: tool, correlationId: crypto.randomUUID() };
    })).rejects.toThrow("MCP_WRITE_RECOVERY_REQUIRED");
    expect(effects).toBe(0);
    const [effect] = await database.client`select effect_count from mcp_test_effects where request_key = ${key}`;
    expect(effect?.effect_count).toBe(1);
  });
});
