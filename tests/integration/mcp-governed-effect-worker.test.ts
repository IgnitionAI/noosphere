import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  approvalItems, contacts, conversations, jobs, meetingProposals, mcpEffectIntentions, mcpEffectProposals, mcpEffectTraces,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresMcpGovernedEffectWorker } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-worker";
import type { ExternalEffectPolicy } from "@outbound/application/mcp/mcp-governed-effects";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP governed-effect worker final gate", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const now = new Date("2026-08-29T12:00:00.000Z");
  const leaseMs = 60_000;
  const proposalIds: string[] = [];
  const intentionIds: string[] = [];
  const jobIds: string[] = [];
  const approvalIds: string[] = [];

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `worker-${workspaceId}`, name: "Worker fixture" });
    await database.db.insert(contacts).values({
      id: contactId, workspaceId, firstName: "Worker", lastName: "Fixture", status: "active", source: "manual", createdAt: now, updatedAt: now,
    });
    await database.db.insert(conversations).values({
      id: conversationId, workspaceId, contactId, provider: "fixture", providerAccountId: "fixture-account",
      providerThreadId: `thread-${conversationId}`, channel: "linkedin", status: "open", lastMessageAt: now, createdAt: now, updatedAt: now,
    });
  });

  afterAll(async () => {
    await database.client`delete from mcp_effect_traces where workspace_id = ${workspaceId}`;
    await database.client`update mcp_effect_proposals set approval_item_id = null, job_id = null where workspace_id = ${workspaceId}`;
    await database.client`delete from approval_items where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_effect_intentions where workspace_id = ${workspaceId}`;
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_effect_proposals where workspace_id = ${workspaceId}`;
    await database.client`delete from meeting_proposals where workspace_id = ${workspaceId}`;
    await database.client`delete from conversations where workspace_id = ${workspaceId}`;
    await database.client`delete from contacts where workspace_id = ${workspaceId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.close();
  });

  async function fixture(
    policyResult: { readonly decision: "allow" | "deny"; readonly code: string; readonly factsVersion: number },
    options: { readonly kind?: "conversation_reply" | "meeting_proposal"; readonly aggregateId?: string } = {},
  ) {
    const kind = options.kind ?? "conversation_reply";
    const aggregateId = options.aggregateId ?? conversationId;
    const proposalId = crypto.randomUUID();
    const approvalId = crypto.randomUUID();
    const intentionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    proposalIds.push(proposalId);
    approvalIds.push(approvalId);
    intentionIds.push(intentionId);
    jobIds.push(jobId);
    await database.db.insert(mcpEffectProposals).values({
      id: proposalId, workspaceId, clientId: "worker-test", kind, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), aggregateId,
      intentSnapshot: { kind, aggregateId, body: "bounded" },
      sourceSnapshot: kind === "meeting_proposal"
        ? { kind, aggregateId, status: "offered", sourceId: "meeting:fixture", sourceUpdatedAt: now.toISOString(), factsVersion: 1, revision: 1, sourceVersion: 1, slotPosition: 1, slotStart: "2026-08-29T13:00:00.000Z", slotEnd: "2026-08-29T13:30:00.000Z", timeZone: "UTC", expiresAt: new Date(now.getTime() + leaseMs).toISOString() }
        : { kind, aggregateId, status: "open", sourceId: "conversation:fixture", sourceUpdatedAt: now.toISOString(), factsVersion: 1, revision: 1, sourceVersion: 1, suppressed: false, humanReplyAt: null },
      revision: 1, sourceVersion: 1, policyPreview: { decision: "allow", code: "OK", factsVersion: 1 },
      policyFinal: null, status: "queued", version: 2, approvalItemId: null, jobId: null,
      correlationId, createdAt: now, updatedAt: now,
    });
    await database.db.insert(approvalItems).values({
      id: approvalId, workspaceId, proposalId, itemType: "mcp_external_effect", channel: "mcp",
      contentOriginal: { kind, aggregateId, body: "bounded", revision: 1, sourceVersion: 1 },
      context: { proposalId, kind, aggregateId }, status: "approved", createdAt: now, updatedAt: now,
    });
    await database.db.insert(jobs).values({
      id: jobId, workspaceId, type: "mcp.external-effect.execute",
      payload: { workspaceId, proposalId, intentionId, kind, aggregateId, correlationId },
      idempotencyKey: `worker:${proposalId}`, correlationId, maxAttempts: 5, status: "running", attempts: 1,
      availableAt: now, lockedAt: now, lockedUntil: new Date(now.getTime() + leaseMs), lockedBy: "worker-a", createdAt: now, updatedAt: now,
    });
    await database.db.insert(mcpEffectIntentions).values({
      id: intentionId, workspaceId, proposalId, kind, aggregateId,
      state: "queued", idempotencyKey: `worker:${proposalId}`, jobId, correlationId, createdAt: now, updatedAt: now,
    });
    await database.db.update(mcpEffectProposals).set({ approvalItemId: approvalId, jobId }).where(and(
      eq(mcpEffectProposals.workspaceId, workspaceId), eq(mcpEffectProposals.id, proposalId),
    ));
    await database.db.insert(mcpEffectTraces).values({
      id: crypto.randomUUID(), workspaceId, proposalId, stage: "approval", sequence: 1, sourceEventId: crypto.randomUUID(),
      idempotencyKey: `fixture:${proposalId}`, eventType: "FixtureApproval", redactedPayload: { status: "approved" }, actor: null,
      correlationId, createdAt: now,
    });
    return { proposalId, approvalId, intentionId, jobId, correlationId, policyResult };
  }

  async function meetingFixture(expiresAt: Date, policyResult: { readonly decision: "allow" | "deny"; readonly code: string; readonly factsVersion: number }) {
    const meetingId = crypto.randomUUID();
    await database.db.insert(meetingProposals).values({
      id: meetingId, workspaceId, conversationId, contactId, status: "offered", timeZone: "UTC",
      slots: [{ start: "2026-08-29T13:00:00.000Z", end: "2026-08-29T13:30:00.000Z" }],
      idempotencyKey: `meeting-${meetingId}`, expiresAt, revision: 1, sourceVersion: 1, createdAt: now, updatedAt: now,
    });
    return { meetingId, ...(await fixture(policyResult, { kind: "meeting_proposal", aggregateId: meetingId })) };
  }

  test("claims one of two concurrent workers with a future lease and one redacted trace", async () => {
    const fixtureValue = await fixture({ decision: "allow", code: "OK", factsVersion: 2 });
    let policyCalls = 0;
    const policy: Pick<ExternalEffectPolicy, "final"> = {
      final: async () => {
        policyCalls += 1;
        return fixtureValue.policyResult;
      },
    };
    const clock = () => now;
    const first = new PostgresMcpGovernedEffectWorker(database.db, policy, { now: clock, leaseMs });
    const second = new PostgresMcpGovernedEffectWorker(database.db, policy, { now: clock, leaseMs });
    const job = (await database.db.select().from(jobs).where(eq(jobs.id, fixtureValue.jobId)).limit(1))[0]!;
    const leasedJob = { id: job.id, type: job.type, status: job.status, workspaceId: job.workspaceId, payload: job.payload, lockedUntil: job.lockedUntil!, lockedBy: job.lockedBy! };
    const [left, right] = await Promise.all([
      first.claim(leasedJob),
      second.claim(leasedJob),
    ]);
    expect([left.outcome, right.outcome].sort()).toEqual(["already_claimed", "claimed"]);
    expect(policyCalls).toBe(1);
    const [intention] = await database.db.select().from(mcpEffectIntentions).where(and(eq(mcpEffectIntentions.workspaceId, workspaceId), eq(mcpEffectIntentions.id, fixtureValue.intentionId)));
    expect(intention?.state).toBe("started");
    expect(intention?.leaseExpiresAt?.getTime()).toBeGreaterThan(now.getTime());
    const [proposal] = await database.db.select().from(mcpEffectProposals).where(eq(mcpEffectProposals.id, fixtureValue.proposalId));
    expect(proposal?.status).toBe("accepted");
    const traces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, fixtureValue.proposalId)));
    expect(traces.filter((trace) => trace.eventType === "McpEffectFinalPolicyEvaluated")).toHaveLength(1);
    expect(JSON.stringify(traces)).not.toContain("provider");
    const [aggregateBeforeReplay] = await database.db.select({ updatedAt: conversations.updatedAt }).from(conversations).where(eq(conversations.id, conversationId));
    const replay = await first.claim(leasedJob);
    expect(replay).toMatchObject({ outcome: "already_claimed", proposalId: fixtureValue.proposalId, intentionId: fixtureValue.intentionId });
    expect(policyCalls).toBe(1);
    const [aggregateAfterReplay] = await database.db.select({ updatedAt: conversations.updatedAt }).from(conversations).where(eq(conversations.id, conversationId));
    expect(aggregateAfterReplay?.updatedAt).toEqual(aggregateBeforeReplay?.updatedAt);
    const replayTraces = await database.db.select({ id: mcpEffectTraces.id }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, fixtureValue.proposalId), eq(mcpEffectTraces.eventType, "McpEffectFinalPolicyEvaluated")));
    expect(replayTraces).toHaveLength(1);
  });

  test("denied and thrown final gates close the intention without an attempt or provider call", async () => {
    const denied = await fixture({ decision: "deny", code: "CONTACT_SUPPRESSED", factsVersion: 2 });
    const deniedQueue = { acknowledgements: 0, acknowledge: async () => { deniedQueue.acknowledgements += 1; } };
    const deniedWorker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => denied.policyResult }, { now: () => now, queue: deniedQueue });
    const deniedJob = (await database.db.select().from(jobs).where(eq(jobs.id, denied.jobId)).limit(1))[0]!;
    const deniedResult = await deniedWorker.process({ id: deniedJob.id, type: deniedJob.type, status: deniedJob.status, workspaceId, payload: deniedJob.payload, lockedUntil: deniedJob.lockedUntil!, lockedBy: deniedJob.lockedBy! });
    expect(deniedResult.outcome).toBe("policy_denied");
    expect(deniedQueue.acknowledgements).toBe(1);
    const [deniedIntention] = await database.db.select().from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, denied.intentionId));
    expect(deniedIntention?.state).toBe("completed");
    const [deniedProposal] = await database.db.select().from(mcpEffectProposals).where(eq(mcpEffectProposals.id, denied.proposalId));
    expect(deniedProposal?.status).toBe("policy_denied");
    expect(deniedProposal?.version).toBe(3);
    const deniedReplay = await deniedWorker.process({ id: deniedJob.id, type: deniedJob.type, status: deniedJob.status, workspaceId, payload: deniedJob.payload, lockedUntil: deniedJob.lockedUntil!, lockedBy: deniedJob.lockedBy! });
    expect(deniedReplay).toMatchObject({ outcome: "already_completed", proposalId: denied.proposalId, intentionId: denied.intentionId });
    expect(deniedQueue.acknowledgements).toBe(2);
    const deniedTraces = await database.db.select({ id: mcpEffectTraces.id }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, denied.proposalId), eq(mcpEffectTraces.eventType, "McpEffectFinalPolicyEvaluated")));
    expect(deniedTraces).toHaveLength(1);

    const thrown = await fixture({ decision: "allow", code: "OK", factsVersion: 1 });
    const thrownWorker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => { throw new Error("provider must never be called"); } }, { now: () => now });
    const thrownJob = (await database.db.select().from(jobs).where(eq(jobs.id, thrown.jobId)).limit(1))[0]!;
    const thrownResult = await thrownWorker.claim({ id: thrownJob.id, type: thrownJob.type, status: thrownJob.status, workspaceId, payload: thrownJob.payload, lockedUntil: thrownJob.lockedUntil!, lockedBy: thrownJob.lockedBy! });
    expect(thrownResult).toMatchObject({ outcome: "invalidated", code: "ADAPTER_UNAVAILABLE" });
    const [thrownIntention] = await database.db.select().from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, thrown.intentionId));
    expect(thrownIntention?.state).toBe("completed");
  });

  test("foreign workspace payload is rejected before any database oracle", async () => {
    const value = await fixture({ decision: "allow", code: "OK", factsVersion: 1 });
    const job = (await database.db.select().from(jobs).where(eq(jobs.id, value.jobId)).limit(1))[0]!;
    const worker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => ({ decision: "allow", code: "OK", factsVersion: 1 }) }, { now: () => now });
    await expect(worker.claim({ id: job.id, type: job.type, status: job.status, workspaceId: crypto.randomUUID(), payload: job.payload, lockedUntil: job.lockedUntil!, lockedBy: job.lockedBy! })).rejects.toThrow("MCP_EFFECT_JOB_LEASE_INVALID");
  });

  test("rejects wrong type, worker, status, and lease boundary before policy or mutation", async () => {
    const value = await fixture({ decision: "allow", code: "OK", factsVersion: 1 });
    const job = (await database.db.select().from(jobs).where(eq(jobs.id, value.jobId)).limit(1))[0]!;
    const worker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => ({ decision: "allow", code: "OK", factsVersion: 1 }) }, { now: () => now });
    const base = { id: job.id, type: job.type, status: job.status, workspaceId, payload: job.payload, lockedUntil: job.lockedUntil!, lockedBy: job.lockedBy! };
    await expect(worker.claim({ ...base, type: "mcp.other.execute" })).rejects.toThrow("MCP_EFFECT_JOB_LEASE_INVALID");
    await expect(worker.claim({ ...base, status: "pending" })).rejects.toThrow("MCP_EFFECT_JOB_LEASE_INVALID");
    await expect(worker.claim({ ...base, lockedBy: "worker-other" })).rejects.toThrow("MCP_EFFECT_JOB_LEASE_INVALID");
    await expect(worker.claim({ ...base, lockedUntil: now })).rejects.toThrow("MCP_EFFECT_JOB_LEASE_INVALID");
    const queueSpy = { acknowledgements: 0, acknowledge: async () => { queueSpy.acknowledgements += 1; } };
    await database.db.update(jobs).set({ lockedBy: "worker-db-other" }).where(eq(jobs.id, value.jobId));
    const storedLeaseWorker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => ({ decision: "allow", code: "OK", factsVersion: 1 }) }, { now: () => now, queue: queueSpy });
    await expect(storedLeaseWorker.process(base)).rejects.toThrow("MCP_EFFECT_JOB_LEASE_INVALID");
    expect(queueSpy.acknowledgements).toBe(0);
    await database.db.update(jobs).set({ lockedBy: "worker-a" }).where(eq(jobs.id, value.jobId));
    await database.db.update(mcpEffectProposals).set({ status: "accepted" }).where(eq(mcpEffectProposals.id, value.proposalId));
    const nonQueued = await worker.claim(base);
    expect(nonQueued).toMatchObject({ outcome: "invalidated", code: "MCP_EFFECT_DECISION_CONFLICT" });
  });

  test("uses the strict meeting expiration boundary before policy", async () => {
    const future = await meetingFixture(new Date(now.getTime() + leaseMs), { decision: "allow", code: "OK", factsVersion: 2 });
    let futureCalls = 0;
    const futureWorker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => { futureCalls += 1; return { decision: "allow", code: "OK", factsVersion: 2 }; } }, { now: () => now, leaseMs });
    const futureJob = (await database.db.select().from(jobs).where(eq(jobs.id, future.jobId)).limit(1))[0]!;
    const futureResult = await futureWorker.claim({ id: futureJob.id, type: futureJob.type, status: futureJob.status, workspaceId, payload: futureJob.payload, lockedUntil: futureJob.lockedUntil!, lockedBy: futureJob.lockedBy! });
    expect(futureResult.outcome).toBe("claimed");
    expect(futureCalls).toBe(1);
    await database.db.update(meetingProposals).set({ status: "cancelled" }).where(eq(meetingProposals.id, future.meetingId));

    const stale = await meetingFixture(now, { decision: "allow", code: "OK", factsVersion: 2 });
    let staleCalls = 0;
    const staleWorker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => { staleCalls += 1; return { decision: "allow", code: "OK", factsVersion: 2 }; } }, { now: () => now, leaseMs });
    const staleJob = (await database.db.select().from(jobs).where(eq(jobs.id, stale.jobId)).limit(1))[0]!;
    const staleResult = await staleWorker.claim({ id: staleJob.id, type: staleJob.type, status: staleJob.status, workspaceId, payload: staleJob.payload, lockedUntil: staleJob.lockedUntil!, lockedBy: staleJob.lockedBy! });
    expect(staleResult).toMatchObject({ outcome: "invalidated", code: "SOURCE_STALE" });
    expect(staleCalls).toBe(0);
    const [staleProposal] = await database.db.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, stale.proposalId));
    expect(staleProposal?.status).toBe("invalidated");
  });
});
