import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, jobs, mcpOauthClients, workspaceMembers, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresMcpOperationStore } from "@outbound/infrastructure/auth/postgres-mcp-operation-store";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";
import type { McpWriteCommand } from "@outbound/application/mcp/mcp-write-capabilities";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP durable operations PostgreSQL store", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const clientId = `mcp-operation-test-${workspaceId}`;
  const workspaceSlug = `mcp-operation-test-${workspaceId}`;
  const context: McpExecutionContext = {
    workspaceId, userId, clientId, role: "owner", scopes: ["mcp:write"], audience: "/mcp",
  };
  const requestKey = crypto.randomUUID();
  const command: McpWriteCommand = {
    operation: "content_draft_create",
    requestKey,
    inputHash: "a".repeat(64),
    arguments: { requestKey, ideaId: crypto.randomUUID(), body: "Draft" },
  };
  const now = new Date("2026-08-29T12:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: workspaceSlug, name: "MCP durable operations" });
    await database.db.insert(authUsers).values({ id: userId, name: "MCP Operations User", email: `mcp-operations-${userId}@example.test` });
    await database.db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner", status: "active" });
    await database.db.insert(mcpOauthClients).values({
      id: crypto.randomUUID(), clientId, clientName: "MCP Operations Test Client", redirectUris: [], userId,
      workspaceId, workspaceSlug, allowedScopes: ["mcp:read", "mcp:write"],
    });
  });

  afterAll(async () => {
    await database.client`delete from mcp_operations where workspace_id = ${workspaceId}`;
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_oauth_clients where client_id = ${clientId}`;
    await database.client`delete from workspace_members where workspace_id = ${workspaceId} and user_id = ${userId}`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.close();
  });

  test("persists queued operations and atomically deduplicates concurrent requests", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    const inputs = Array.from({ length: 12 }, () => ({
      context, command, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now,
    }));
    const results = await Promise.all(inputs.map((input) => store.createQueued(input)));
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(new Set(results.map((result) => result.record.operationId)).size).toBe(1);
    const rows = await database.client`select count(*)::int as count from mcp_operations where workspace_id = ${workspaceId}`;
    expect(rows[0]?.count).toBe(1);
  });

  test("replays the same hash and rejects a divergent hash", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    const first = await store.createQueued({ context, command: { ...command, requestKey: crypto.randomUUID() }, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now });
    const replay = await store.createQueued({ context, command: { ...command, requestKey: first.record.requestKey }, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now });
    expect(replay.inserted).toBe(false);
    expect(replay.record.operationId).toBe(first.record.operationId);
    await expect(store.createQueued({ context, command: { ...command, requestKey: first.record.requestKey, inputHash: "b".repeat(64) }, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now })).rejects.toThrow("MCP_OPERATION_IDEMPOTENCY_CONFLICT");
  });

  test("transitions are persisted and survive a fresh store instance", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    const queued = await store.createQueued({ context, command: { ...command, requestKey: crypto.randomUUID() }, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now });
    await store.markRunning({ workspaceId, operationId: queued.record.operationId, jobId: queued.record.jobId, now });
    await store.complete({ workspaceId, operationId: queued.record.operationId, jobId: queued.record.jobId, resultRefs: [{ type: "company", id: crypto.randomUUID() }], now });
    expect((await new PostgresMcpOperationStore(database.db).get({ workspaceId, operationId: queued.record.operationId }))?.status).toBe("completed");
  });

  test("foreign workspaces cannot read or transition operations", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    const queued = await store.createQueued({ context, command: { ...command, requestKey: crypto.randomUUID() }, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now });
    const foreignWorkspaceId = crypto.randomUUID();
    expect(await store.get({ workspaceId: foreignWorkspaceId, operationId: queued.record.operationId })).toBeNull();
    await expect(store.markRunning({ workspaceId: foreignWorkspaceId, operationId: queued.record.operationId, jobId: queued.record.jobId, now })).rejects.toThrow("MCP_OPERATION_NOT_FOUND");
  });

  test("stale leases and illegal transitions have stable errors", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    const queued = await store.createQueued({ context, command: { ...command, requestKey: crypto.randomUUID() }, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now });
    await expect(store.complete({ workspaceId, operationId: queued.record.operationId, jobId: queued.record.jobId, resultRefs: [], now })).rejects.toThrow("MCP_OPERATION_INVALID_STATE");
    await expect(store.markRunning({ workspaceId, operationId: queued.record.operationId, jobId: crypto.randomUUID(), now })).rejects.toThrow("MCP_OPERATION_LEASE_LOST");
    await store.markRunning({ workspaceId, operationId: queued.record.operationId, jobId: queued.record.jobId, now });
    await store.fail({ workspaceId, operationId: queued.record.operationId, jobId: queued.record.jobId, errorCode: "MCP_OPERATION_FAILED", now });
    await expect(store.complete({ workspaceId, operationId: queued.record.operationId, jobId: queued.record.jobId, resultRefs: [], now })).rejects.toThrow("MCP_OPERATION_INVALID_STATE");
    const cancellable = await store.createQueued({ context, command: { ...command, requestKey: crypto.randomUUID() }, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now });
    await store.cancel({ workspaceId, operationId: cancellable.record.operationId, jobId: cancellable.record.jobId, now });
    expect((await store.get({ workspaceId, operationId: cancellable.record.operationId }))?.status).toBe("cancelled");
    await expect(store.cancel({ workspaceId, operationId: cancellable.record.operationId, jobId: cancellable.record.jobId, now })).rejects.toThrow("MCP_OPERATION_INVALID_STATE");
  });

  test("bounds result references and persists only an error code", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    const makeQueued = () => store.createQueued({ context, command: { ...command, requestKey: crypto.randomUUID() }, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now });
    const tooMany = await makeQueued();
    await store.markRunning({ workspaceId, operationId: tooMany.record.operationId, jobId: tooMany.record.jobId, now });
    await expect(store.complete({ workspaceId, operationId: tooMany.record.operationId, jobId: tooMany.record.jobId, resultRefs: Array.from({ length: 21 }, (_, index) => ({ type: "company", id: String(index) })), now })).rejects.toThrow("MCP_OPERATION_RESULT_REFS_TOO_LARGE");
    const tooLong = await makeQueued();
    await store.markRunning({ workspaceId, operationId: tooLong.record.operationId, jobId: tooLong.record.jobId, now });
    await expect(store.complete({ workspaceId, operationId: tooLong.record.operationId, jobId: tooLong.record.jobId, resultRefs: [{ type: "x".repeat(121), id: "id" }], now })).rejects.toThrow("MCP_OPERATION_RESULT_REF_TOO_LARGE");
    const failed = await makeQueued();
    await store.markRunning({ workspaceId, operationId: failed.record.operationId, jobId: failed.record.jobId, now });
    await store.fail({ workspaceId, operationId: failed.record.operationId, jobId: failed.record.jobId, errorCode: "SAFE_CODE", now });
    const failedRows = await database.client`select error_code, result_refs from mcp_operations where operation_id = ${failed.record.operationId}`;
    expect(failedRows[0]?.error_code).toBe("SAFE_CODE");
    expect(JSON.stringify(failedRows[0]?.result_refs)).toBe("[]");
  });

  test("reconciles a completed domain job after a lifecycle store failure, with bounded refs", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    const operation = await createTrackedJob(store, "completed", {
      mcpResultRefs: Array.from({ length: 25 }, (_, index) => ({ type: "company", id: String(index) })),
    });
    await store.markRunning({ workspaceId, operationId: operation.record.operationId, jobId: operation.record.jobId, now });

    expect(await new PostgresMcpOperationStore(database.db).reconcileJobOutcomes()).toBe(1);
    const reconciled = await new PostgresMcpOperationStore(database.db).get({ workspaceId, operationId: operation.record.operationId });
    expect(reconciled?.status).toBe("completed");
    expect(reconciled?.resultRefs).toHaveLength(20);
    expect(await new PostgresMcpOperationStore(database.db).reconcileJobOutcomes()).toBe(0);
  });

  test("reconciles dead-lettered jobs as failed with a safe code", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    const operation = await createTrackedJob(store, "dead_lettered", undefined, "provider unavailable: leaked details");
    await store.markRunning({ workspaceId, operationId: operation.record.operationId, jobId: operation.record.jobId, now });

    expect(await store.reconcileJobOutcomes()).toBe(1);
    const reconciled = await new PostgresMcpOperationStore(database.db).get({ workspaceId, operationId: operation.record.operationId });
    expect(reconciled).toMatchObject({ status: "failed", resultRefs: [], errorCode: "MCP_OPERATION_FAILED" });
  });

  test("does not reconcile non-terminal or untracked jobs and honors the batch bound", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    const nonTerminal = await Promise.all(["pending", "retry", "running"].map((status) => createTrackedJob(store, status as "pending" | "retry" | "running")));
    for (const operation of nonTerminal) {
      await store.markRunning({ workspaceId, operationId: operation.record.operationId, jobId: operation.record.jobId, now });
    }
    const firstCompleted = await createTrackedJob(store, "completed");
    const secondCompleted = await createTrackedJob(store, "completed");
    const untrackedJobId = crypto.randomUUID();
    await database.db.insert(jobs).values({
      id: untrackedJobId, workspaceId, type: "untracked.fixture", payload: {}, idempotencyKey: untrackedJobId,
      correlationId: untrackedJobId, status: "completed", attempts: 1, maxAttempts: 1, availableAt: now,
      completedAt: now, createdAt: now, updatedAt: now,
    });

    expect(await store.reconcileJobOutcomes(1)).toBe(1);
    const batchStatuses = [
      (await store.get({ workspaceId, operationId: firstCompleted.record.operationId }))?.status,
      (await store.get({ workspaceId, operationId: secondCompleted.record.operationId }))?.status,
    ];
    expect(batchStatuses.filter((status) => status === "completed")).toHaveLength(1);
    expect(batchStatuses.filter((status) => status === "queued")).toHaveLength(1);
    expect(await store.reconcileJobOutcomes()).toBe(1);
    expect((await store.get({ workspaceId, operationId: secondCompleted.record.operationId }))?.status).toBe("completed");
    for (const operation of nonTerminal) {
      expect((await store.get({ workspaceId, operationId: operation.record.operationId }))?.status).toBe("running");
    }
    const [untracked] = await database.db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, untrackedJobId));
    expect(untracked?.status).toBe("completed");
  });

  test("enforces workspace, OAuth client, and user foreign keys", async () => {
    const store = new PostgresMcpOperationStore(database.db);
    await expect(store.createQueued({
      context: { ...context, clientId: `missing-${crypto.randomUUID()}` }, command,
      operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now,
    })).rejects.toThrow();
    await expect(store.createQueued({
      context: { ...context, workspaceId: crypto.randomUUID() }, command,
      operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now,
    })).rejects.toThrow();
    await expect(store.createQueued({
      context: { ...context, userId: crypto.randomUUID() }, command: { ...command, requestKey: crypto.randomUUID() },
      operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now,
    })).rejects.toThrow();
  });

  async function createTrackedJob(
    store: PostgresMcpOperationStore,
    status: "pending" | "retry" | "running" | "completed" | "dead_lettered",
    payload: Record<string, unknown> = {},
    lastErrorCode: string | undefined = undefined,
  ) {
    const jobId = crypto.randomUUID();
    const operation = await store.createQueued({
      context,
      command: { ...command, requestKey: crypto.randomUUID() },
      operationId: crypto.randomUUID(),
      jobId,
      correlationId: crypto.randomUUID(),
      now,
    });
    await database.db.insert(jobs).values({
      id: jobId,
      workspaceId,
      type: "content.asset.generate",
      payload,
      idempotencyKey: `mcp-reconcile:${jobId}`,
      correlationId: operation.record.correlationId,
      status,
      attempts: status === "pending" ? 0 : 1,
      maxAttempts: 5,
      availableAt: now,
      ...(status === "completed" || status === "dead_lettered" ? { completedAt: now } : {}),
      ...(lastErrorCode ? { lastErrorCode } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return operation;
  }
});
