import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { mcpEffectProposals, mcpEffectTraces, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresMcpEffectReconciliationRepository } from "@outbound/infrastructure/mcp/postgres-mcp-effect-reconciliation-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP effect reconciliation repository PostgreSQL contract", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const foreignWorkspaceId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const matchedProposalId = crypto.randomUUID();
  const exhaustedReleaseProposalId = crypto.randomUUID();
  const exhaustedRecoveryProposalId = crypto.randomUUID();
  const foreignProposalId = crypto.randomUUID();
  const now = new Date("2026-08-29T12:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `mcp-recon-${workspaceId}`, name: "MCP reconciliation" },
      { id: foreignWorkspaceId, slug: `mcp-recon-${foreignWorkspaceId}`, name: "MCP foreign reconciliation" },
    ]);
    for (const [workspace, proposal] of [[workspaceId, proposalId], [workspaceId, matchedProposalId], [workspaceId, exhaustedReleaseProposalId], [workspaceId, exhaustedRecoveryProposalId], [foreignWorkspaceId, foreignProposalId]] as const) {
      await database.db.insert(mcpEffectProposals).values({
        id: proposal, workspaceId: workspace, clientId: "fixture", kind: "conversation_reply", requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), aggregateId: crypto.randomUUID(),
        intentSnapshot: { body: "redacted" }, sourceSnapshot: { sourceId: "fixture" }, correlationId: crypto.randomUUID(),
      });
    }
  });

  afterAll(async () => {
    await database.client.begin(async (transaction) => {
      await transaction`update mcp_effect_proposals set reconciliation_id = null where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
      await transaction`delete from mcp_effect_traces where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
      await transaction`delete from mcp_effect_reconciliations where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
      await transaction`delete from mcp_effect_proposals where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
      await transaction`delete from workspaces where id in (${workspaceId}, ${foreignWorkspaceId})`;
    });
    await database.close();
  });

  test("creates one row per workspace/proposal and claims it with a lease", async () => {
    const repository = new PostgresMcpEffectReconciliationRepository(database.db);
    const first = await repository.createOrGet({ workspaceId, proposalId, criteriaSnapshot: { accountId: "account-fixture", accessToken: "secret" }, now });
    const replay = await repository.createOrGet({ workspaceId, proposalId, criteriaSnapshot: { accountId: "different" }, now });
    expect(replay.reconciliationId).toBe(first.reconciliationId);
    expect(first.proposalStatus).toBe("reconciling");
    expect(first.criteriaSnapshot).toEqual({ accountId: "account-fixture" });

    const claimed = await repository.claim({ workspaceId, reconciliationId: first.reconciliationId, now, leaseMs: 60_000 });
    expect(claimed).toMatchObject({ status: "searching", attempts: 1, attempt: 1 });
    expect(await repository.claim({ workspaceId, reconciliationId: first.reconciliationId, now, leaseMs: 60_000 })).toBeNull();
    const staleLeaseToken = crypto.randomUUID();
    expect(await repository.heartbeat({ workspaceId, reconciliationId: first.reconciliationId, leaseToken: staleLeaseToken, now, leaseMs: 60_000 })).toBe(false);
    expect(await repository.heartbeat({ workspaceId, reconciliationId: first.reconciliationId, leaseToken: claimed!.leaseToken, now: new Date(now.getTime() + 60_000), leaseMs: 60_000 })).toBe(false);
    await expect(repository.markAmbiguous({ workspaceId, reconciliationId: first.reconciliationId, leaseToken: staleLeaseToken, candidateCount: 2, now })).rejects.toThrow("MCP_RECONCILIATION_LEASE_LOST");
    await repository.markNotFound({ workspaceId, reconciliationId: first.reconciliationId, leaseToken: claimed!.leaseToken, now, terminal: true });
    expect((await repository.get({ workspaceId, reconciliationId: first.reconciliationId }))?.proposalStatus).toBe("failed");
  });

  test("does not expose a reconciliation row across workspaces", async () => {
    const repository = new PostgresMcpEffectReconciliationRepository(database.db);
    expect(await repository.getByProposal({ workspaceId: foreignWorkspaceId, proposalId })).toBeNull();
  });

  test("closes exhausted release and recovery leases with a stable safe code", async () => {
    const repository = new PostgresMcpEffectReconciliationRepository(database.db);
    const releaseRow = await repository.createOrGet({ workspaceId, proposalId: exhaustedReleaseProposalId, maxAttempts: 1, now });
    const releaseLease = await repository.claim({ workspaceId, reconciliationId: releaseRow.reconciliationId, now, leaseMs: 60_000 });
    expect(await repository.release({ workspaceId, reconciliationId: releaseRow.reconciliationId, leaseToken: releaseLease!.leaseToken, now })).toBe(true);
    expect(await repository.get({ workspaceId, reconciliationId: releaseRow.reconciliationId })).toMatchObject({ status: "error", errorCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED", completedAt: now });
    expect((await repository.get({ workspaceId, reconciliationId: releaseRow.reconciliationId }))?.proposalStatus).toBe("reconciling");

    const recoveryRow = await repository.createOrGet({ workspaceId, proposalId: exhaustedRecoveryProposalId, maxAttempts: 1, now });
    const recoveryLease = await repository.claim({ workspaceId, reconciliationId: recoveryRow.reconciliationId, now, leaseMs: 1 });
    expect(recoveryLease).not.toBeNull();
    expect(await repository.recoverExpired({ workspaceId, now: new Date(now.getTime() + 2), limit: 10 })).toBe(1);
    expect(await repository.get({ workspaceId, reconciliationId: recoveryRow.reconciliationId })).toMatchObject({ status: "error", errorCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED" });
  });

  test("requires evidence and atomically records the result trace before delivery", async () => {
    const repository = new PostgresMcpEffectReconciliationRepository(database.db);
    const reconciliation = await repository.createOrGet({ workspaceId, proposalId: matchedProposalId, now });
    const claimed = await repository.claim({ workspaceId, reconciliationId: reconciliation.reconciliationId, now, leaseMs: 60_000 });
    expect(claimed).not.toBeNull();
    await expect(repository.markMatched({ workspaceId, reconciliationId: reconciliation.reconciliationId, leaseToken: claimed!.leaseToken, now, authoritative: true, candidateCount: 1 })).rejects.toThrow("MCP_RECONCILIATION_MATCH_EVIDENCE_REQUIRED");
    expect((await repository.get({ workspaceId, reconciliationId: reconciliation.reconciliationId }))?.status).toBe("searching");
    const sourceEventId = crypto.randomUUID();
    await repository.markMatched({ workspaceId, reconciliationId: reconciliation.reconciliationId, leaseToken: claimed!.leaseToken, now, authoritative: true, candidateCount: 1, result: { observedAt: now.toISOString(), details: { z: 2, a: 1 }, accessToken: "secret", api_key: "secret", privateKey: "secret" }, sourceEventId, idempotencyKey: `matched:${reconciliation.reconciliationId}` });
    const completed = await repository.get({ workspaceId, reconciliationId: reconciliation.reconciliationId });
    expect(completed).toMatchObject({ status: "matched", proposalStatus: "delivered", resultSnapshot: { observedAt: now.toISOString() } });
    expect(completed?.resultSnapshot).not.toHaveProperty("accessToken");
    expect(completed?.resultSnapshot).not.toHaveProperty("api_key");
    expect(completed?.resultSnapshot).not.toHaveProperty("privateKey");
    const traces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, matchedProposalId)));
    expect(traces.filter((trace) => trace.stage === "result")).toHaveLength(1);
    expect(traces.find((trace) => trace.stage === "result")?.sourceEventId).toBe(sourceEventId);
    expect(traces.find((trace) => trace.stage === "result")?.redactedPayload).not.toHaveProperty("api_key");
    expect(traces.find((trace) => trace.stage === "result")?.redactedPayload).not.toHaveProperty("privateKey");

    await repository.markMatched({ workspaceId, reconciliationId: reconciliation.reconciliationId, leaseToken: claimed!.leaseToken, now, authoritative: true, candidateCount: 1, result: { details: { a: 1, z: 2 }, accessToken: "secret", observedAt: now.toISOString() }, sourceEventId, idempotencyKey: `matched:${reconciliation.reconciliationId}` });
    const replayTraces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, matchedProposalId)));
    expect(replayTraces.filter((trace) => trace.stage === "result")).toHaveLength(1);
    await expect(repository.markMatched({ workspaceId, reconciliationId: reconciliation.reconciliationId, leaseToken: claimed!.leaseToken, now, authoritative: true, candidateCount: 1, result: { details: { a: 1, z: 2 }, observedAt: now.toISOString() }, sourceEventId: crypto.randomUUID(), idempotencyKey: `matched:other:${reconciliation.reconciliationId}` })).rejects.toThrow("MCP_RECONCILIATION_TRACE_IDEMPOTENCY_CONFLICT");
    await expect(repository.markMatched({ workspaceId, reconciliationId: reconciliation.reconciliationId, leaseToken: claimed!.leaseToken, now, authoritative: true, candidateCount: 1, result: { observedAt: "different" }, sourceEventId, idempotencyKey: `matched:${reconciliation.reconciliationId}` })).rejects.toThrow("MCP_RECONCILIATION_TRACE_IDEMPOTENCY_CONFLICT");
  });

  test("recovers concurrent expired workers without duplicate recovery", async () => {
    const proposalIds = [crypto.randomUUID(), crypto.randomUUID()];
    const reconciliationIds: string[] = [];
    await database.db.insert(mcpEffectProposals).values(proposalIds.map((id) => ({
      id, workspaceId, clientId: "fixture", kind: "conversation_reply" as const, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), aggregateId: crypto.randomUUID(),
      intentSnapshot: { body: "redacted" }, sourceSnapshot: { sourceId: "fixture" }, correlationId: crypto.randomUUID(),
    })));
    try {
      const repository = new PostgresMcpEffectReconciliationRepository(database.db);
      for (const proposalId of proposalIds) {
        const row = await repository.createOrGet({ workspaceId, proposalId, now });
        reconciliationIds.push(row.reconciliationId);
        expect(await repository.claim({ workspaceId, reconciliationId: row.reconciliationId, now, leaseMs: 1 })).not.toBeNull();
      }
      const recovered = await Promise.all([
        repository.recoverExpired({ workspaceId, now: new Date(now.getTime() + 2), limit: 1 }),
        repository.recoverExpired({ workspaceId, now: new Date(now.getTime() + 2), limit: 1 }),
      ]);
      expect(recovered.sort()).toEqual([1, 1]);
      expect((await Promise.all(reconciliationIds.map((reconciliationId) => repository.get({ workspaceId, reconciliationId })))).every((row) => row?.status === "pending")).toBe(true);
    } finally {
      await database.client.begin(async (transaction) => {
        await transaction`update mcp_effect_proposals set reconciliation_id = null where id = any(${proposalIds})`;
        await transaction`delete from mcp_effect_reconciliations where id = any(${reconciliationIds})`;
        await transaction`delete from mcp_effect_proposals where id = any(${proposalIds})`;
      });
    }
  });

  test("maps a concurrent source event race to the stable source conflict", async () => {
    const proposalIds = [crypto.randomUUID(), crypto.randomUUID()];
    const reconciliationIds: string[] = [];
    await database.db.insert(mcpEffectProposals).values(proposalIds.map((id) => ({
      id, workspaceId, clientId: "fixture", kind: "conversation_reply" as const, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), aggregateId: crypto.randomUUID(),
      intentSnapshot: { body: "redacted" }, sourceSnapshot: { sourceId: "fixture" }, correlationId: crypto.randomUUID(),
    })));
    try {
      const repository = new PostgresMcpEffectReconciliationRepository(database.db);
      const leases: Array<{ readonly leaseToken: string }> = [];
      for (const proposalId of proposalIds) {
        const row = await repository.createOrGet({ workspaceId, proposalId, now });
        reconciliationIds.push(row.reconciliationId);
        const lease = await repository.claim({ workspaceId, reconciliationId: row.reconciliationId, now, leaseMs: 60_000 });
        expect(lease).not.toBeNull();
        if (!lease) throw new Error("fixture lease missing");
        leases.push(lease);
      }
      const sourceEventId = crypto.randomUUID();
      const outcomes = await Promise.allSettled(proposalIds.map((_, index) => repository.markMatched({
        workspaceId, reconciliationId: reconciliationIds[index]!, leaseToken: leases[index]!.leaseToken, now,
        authoritative: true, candidateCount: 1, result: { observedAt: now.toISOString() }, sourceEventId, idempotencyKey: `race:${index}`,
      })));
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "MCP_RECONCILIATION_TRACE_SOURCE_EVENT_CONFLICT" });
    } finally {
      await database.client.begin(async (transaction) => {
        await transaction`update mcp_effect_proposals set reconciliation_id = null where id = any(${proposalIds})`;
        await transaction`delete from mcp_effect_reconciliations where id = any(${reconciliationIds})`;
        await transaction`delete from mcp_effect_proposals where id = any(${proposalIds})`;
      });
    }
  });

  test("rejects malformed identifiers before touching the database", async () => {
    const repository = new PostgresMcpEffectReconciliationRepository(database.db);
    await expect(repository.get({ workspaceId: "not-a-uuid", reconciliationId: crypto.randomUUID() })).rejects.toThrow("MCP_RECONCILIATION_WORKSPACE_ID_INVALID");
    await expect(repository.get({ workspaceId, reconciliationId: "not-a-uuid" })).rejects.toThrow("MCP_RECONCILIATION_ID_INVALID");
    await expect(repository.recoverExpired({ workspaceId, now, limit: -1 })).rejects.toThrow("MCP_RECONCILIATION_LIMIT_INVALID");
  });
});
