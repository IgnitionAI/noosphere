import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { deriveMcpEffectInputHash, PostgresMcpGovernedEffectRepository } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-repository";
import {
  approvalItems, authUsers, conversations, contacts, jobs, mcpEffectIntentions, mcpEffectProposals, mcpEffectTraces,
  outboxEvents, workspaceMembers, workspaces,
} from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP governed effect decision transaction", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const repository = new PostgresMcpGovernedEffectRepository(database.db, () => now);
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const now = new Date("2026-08-29T12:00:00.000Z");
  const context = { userId, workspaceId, clientId: "decision-fixture", role: "reviewer" as const, scopes: ["mcp:read", "mcp:approve"], audience: "noosphere" };
  const policy = {
    preview: async () => ({ decision: "allow" as const, code: "OK", factsVersion: 1 }),
    final: async () => ({ decision: "allow" as const, code: "OK", factsVersion: 1 }),
  };

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `decision-${workspaceId}`, name: "Decision fixture" });
    await database.db.insert(authUsers).values({ id: userId, name: "Decision reviewer", email: `decision-${userId}@example.test` });
    await database.db.insert(workspaceMembers).values({ workspaceId, userId, role: "reviewer" });
    await database.db.insert(contacts).values({ id: contactId, workspaceId, firstName: "Fixture", lastName: "Contact" });
    await database.db.insert(conversations).values({
      id: conversationId, workspaceId, contactId, provider: "fixture", providerAccountId: "fixture-account",
      providerThreadId: `thread-${conversationId}`, channel: "linkedin", lastMessageAt: now,
    });
  });

  afterAll(async () => {
    await database.client`delete from mcp_effect_traces where workspace_id = ${workspaceId}`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`update mcp_effect_proposals set approval_item_id = null, operation_id = null, job_id = null, reconciliation_id = null where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_effect_intentions where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_effect_proposals where workspace_id = ${workspaceId}`;
    await database.client`delete from approval_items where workspace_id = ${workspaceId}`;
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.client`delete from conversations where workspace_id = ${workspaceId}`;
    await database.client`delete from contacts where workspace_id = ${workspaceId}`;
    await database.client`delete from workspace_members where workspace_id = ${workspaceId}`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.close();
  });

  function input(requestKey = crypto.randomUUID()) {
    const value = {
      workspaceId, clientId: context.clientId, kind: "conversation_reply" as const, requestKey,
      inputHash: "", aggregateId: conversationId, revision: 1, sourceVersion: 1, factsVersion: 1,
      intentSnapshot: { body: "bounded fixture" },
      sourceSnapshot: { status: "open", sourceId: `conversation:${conversationId}`, sourceUpdatedAt: now.toISOString(), factsVersion: 1, suppressed: false },
    };
    value.inputHash = deriveMcpEffectInputHash(value);
    return value;
  }

  test("fails closed without policy and atomically queues one execution", async () => {
    const proposal = await repository.createProposal(input());
    await expect(repository.decideAndQueue({ context, approvalItemId: proposal.approvalItemId!, decision: "approve" })).rejects.toThrow("MCP_EFFECT_POLICY_UNAVAILABLE");
    const none = await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.workspaceId, workspaceId));
    expect(none).toHaveLength(0);

    const approved = await repository.decideAndQueue({ context, approvalItemId: proposal.approvalItemId!, decision: "approve", expectedVersion: 1, policy });
    expect(approved.status).toBe("queued");
    expect(approved.intentionId).toBeString();
    expect(approved.sourceEventId).toBeString();
    const rows = await database.db.select({ intention: mcpEffectIntentions.id, job: jobs.id, event: outboxEvents.id }).from(mcpEffectIntentions)
      .innerJoin(jobs, and(eq(jobs.workspaceId, mcpEffectIntentions.workspaceId), eq(jobs.id, mcpEffectIntentions.jobId)))
      .innerJoin(outboxEvents, and(eq(outboxEvents.workspaceId, mcpEffectIntentions.workspaceId), eq(outboxEvents.id, approved.sourceEventId!)))
      .where(and(eq(mcpEffectIntentions.workspaceId, workspaceId), eq(mcpEffectIntentions.proposalId, proposal.proposalId)));
    expect(rows).toHaveLength(1);
  });

  test("replays the canonical intention under concurrent approvals", async () => {
    const proposal = await repository.createProposal(input());
    const decisions = await Promise.all([
      repository.decideAndQueue({ context, approvalItemId: proposal.approvalItemId!, decision: "approve", expectedVersion: 1, policy }),
      repository.decideAndQueue({ context, approvalItemId: proposal.approvalItemId!, decision: "approve", expectedVersion: 1, policy }),
    ]);
    expect(new Set(decisions.map((entry) => entry.intentionId)).size).toBe(1);
    expect(new Set(decisions.map((entry) => entry.sourceEventId)).size).toBe(1);
    const rows = await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(and(eq(mcpEffectIntentions.workspaceId, workspaceId), eq(mcpEffectIntentions.proposalId, proposal.proposalId)));
    expect(rows).toHaveLength(1);
  });

  test("rolls back when the job insertion conflicts", async () => {
    const proposal = await repository.createProposal(input());
    const idempotencyKey = `mcp-effect:${proposal.proposalId}:execute:v1`;
    const conflictingJobId = crypto.randomUUID();
    await database.db.insert(jobs).values({
      id: conflictingJobId, workspaceId, type: "mcp.external-effect.execute", payload: { fixture: "job-conflict" },
      idempotencyKey, correlationId: proposal.correlationId, maxAttempts: 5, availableAt: now, createdAt: now, updatedAt: now,
    });
    try {
      await expect(repository.decideAndQueue({ context, approvalItemId: proposal.approvalItemId!, decision: "approve", policy })).rejects.toBeDefined();
      const [current] = await database.db.select({ status: mcpEffectProposals.status, version: mcpEffectProposals.version }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, proposal.proposalId));
      const [approval] = await database.db.select({ status: approvalItems.status }).from(approvalItems).where(eq(approvalItems.id, proposal.approvalItemId!));
      expect(current).toEqual({ status: "approval_required", version: 1 });
      expect(approval?.status).toBe("pending");
      expect(await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.proposalId, proposal.proposalId))).toHaveLength(0);
      expect(await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.aggregateId, proposal.proposalId)))).toHaveLength(0);
    } finally {
      await database.db.delete(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, conflictingJobId)));
    }
  });

  test("rolls back when intention uniqueness conflicts", async () => {
    const proposal = await repository.createProposal(input());
    const existingJobId = crypto.randomUUID();
    const existingIntentionId = crypto.randomUUID();
    const idempotencyKey = `mcp-effect:${proposal.proposalId}:execute:v1`;
    await database.db.insert(jobs).values({
      id: existingJobId, workspaceId, type: "mcp.external-effect.fixture", payload: { fixture: "intention-conflict" },
      idempotencyKey: `fixture:${existingJobId}`, correlationId: proposal.correlationId, maxAttempts: 1, availableAt: now, createdAt: now, updatedAt: now,
    });
    await database.db.insert(mcpEffectIntentions).values({
      id: existingIntentionId, workspaceId, proposalId: proposal.proposalId, kind: proposal.kind, aggregateId: proposal.aggregateId,
      state: "queued", idempotencyKey, jobId: existingJobId, correlationId: proposal.correlationId, createdAt: now, updatedAt: now,
    });
    try {
      await expect(repository.decideAndQueue({ context, approvalItemId: proposal.approvalItemId!, decision: "approve", policy })).rejects.toBeDefined();
      const [current] = await database.db.select({ status: mcpEffectProposals.status, version: mcpEffectProposals.version }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, proposal.proposalId));
      expect(current).toEqual({ status: "approval_required", version: 1 });
      expect(await database.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.idempotencyKey, idempotencyKey)))).toHaveLength(0);
      expect(await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.aggregateId, proposal.proposalId)))).toHaveLength(0);
    } finally {
      await database.db.delete(mcpEffectIntentions).where(and(eq(mcpEffectIntentions.workspaceId, workspaceId), eq(mcpEffectIntentions.id, existingIntentionId)));
      await database.db.delete(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, existingJobId)));
    }
  });

  test("rolls back when the outbox envelope conflicts", async () => {
    const proposal = await repository.createProposal(input());
    const originalRandomUUID = crypto.randomUUID.bind(crypto);
    const randomUUIDDescriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
    const tracePreviewId = originalRandomUUID();
    const traceFinalId = originalRandomUUID();
    const generated = Array.from({ length: 5 }, originalRandomUUID);
    const intentionId = generated[2]!;
    const jobId = generated[3]!;
    const sourceEventId = generated[4]!;
    let randomUUIDCalls = 0;
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => {
        randomUUIDCalls += 1;
        return generated.shift() ?? originalRandomUUID();
      },
    });
    try {
      await database.db.insert(mcpEffectTraces).values([
        {
          id: tracePreviewId, workspaceId, proposalId: proposal.proposalId, stage: "attempt", sequence: 3,
          sourceEventId: originalRandomUUID(), idempotencyKey: `fixture:${proposal.proposalId}:trace-preview`, eventType: "FixtureTracePreview",
          redactedPayload: { fixture: "outbox-conflict" }, correlationId: proposal.correlationId, createdAt: now,
        },
        {
          id: traceFinalId, workspaceId, proposalId: proposal.proposalId, stage: "result", sequence: 4,
          sourceEventId: originalRandomUUID(), idempotencyKey: `fixture:${proposal.proposalId}:trace-final`, eventType: "FixtureTraceFinal",
          redactedPayload: { fixture: "outbox-conflict" }, correlationId: proposal.correlationId, createdAt: now,
        },
      ]);
      await database.db.insert(outboxEvents).values({
        id: sourceEventId, workspaceId, aggregateType: "fixture", aggregateId: proposal.proposalId,
        eventType: "fixture", payload: { fixture: "outbox-conflict" }, availableAt: now, createdAt: now,
      });
      await expect(repository.decideAndQueue({ context, approvalItemId: proposal.approvalItemId!, decision: "approve", policy })).rejects.toBeDefined();
      expect(randomUUIDCalls).toBe(5);
      const [current] = await database.db.select({ status: mcpEffectProposals.status, version: mcpEffectProposals.version }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, proposal.proposalId));
      expect(current).toEqual({ status: "approval_required", version: 1 });
      expect(await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.proposalId, proposal.proposalId))).toHaveLength(0);
      expect(await database.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId))).toHaveLength(0);
    } finally {
      if (randomUUIDDescriptor) Object.defineProperty(crypto, "randomUUID", randomUUIDDescriptor);
      else delete (crypto as unknown as { randomUUID?: () => string }).randomUUID;
      await database.db.delete(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, proposal.proposalId), eq(mcpEffectTraces.id, tracePreviewId)));
      await database.db.delete(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, proposal.proposalId), eq(mcpEffectTraces.id, traceFinalId)));
      await database.db.delete(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.id, sourceEventId)));
    }
  });

  test("rolls back when policy trace insertion conflicts", async () => {
    const proposal = await repository.createProposal(input());
    await database.db.insert(mcpEffectTraces).values({
      id: crypto.randomUUID(), workspaceId, proposalId: proposal.proposalId, stage: "policy", sequence: 3,
      sourceEventId: crypto.randomUUID(), idempotencyKey: `policy:${proposal.proposalId}:preview:v1`, eventType: "FixturePolicyPreview",
      redactedPayload: { decision: "allow", code: "OK" }, correlationId: proposal.correlationId, createdAt: now,
    });
    try {
      await expect(repository.decideAndQueue({ context, approvalItemId: proposal.approvalItemId!, decision: "approve", policy })).rejects.toBeDefined();
      const [current] = await database.db.select({ status: mcpEffectProposals.status, version: mcpEffectProposals.version, policyPreview: mcpEffectProposals.policyPreview }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, proposal.proposalId));
      expect(current).toEqual({ status: "approval_required", version: 1, policyPreview: null });
      expect(await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.proposalId, proposal.proposalId))).toHaveLength(0);
      expect(await database.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.idempotencyKey, `mcp-effect:${proposal.proposalId}:execute:v1`)))).toHaveLength(0);
    } finally {
      await database.db.delete(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, proposal.proposalId), eq(mcpEffectTraces.sequence, 3)));
    }
  });

  test("rejects every strict replay identity variant without duplicate references", async () => {
    const proposal = await repository.createProposal(input());
    const first = await repository.decideAndQueue({ context, approvalItemId: proposal.approvalItemId!, decision: "approve", expectedVersion: 1, policy });
    const variants = [
      { actor: "different-actor" },
      { context: { ...context, clientId: "different-client" } },
      { context: { ...context, scopes: ["mcp:read"] } },
      { expectedVersion: 2 },
    ];
    for (const variant of variants) {
      await expect(repository.decideAndQueue({
        context: variant.context ?? context,
        approvalItemId: proposal.approvalItemId!, decision: "approve", policy,
        ...(variant.actor ? { actor: variant.actor } : {}),
        ...(variant.expectedVersion !== undefined ? { expectedVersion: variant.expectedVersion } : { expectedVersion: 1 }),
      })).rejects.toThrow("MCP_EFFECT_DECISION_CONFLICT");
    }
    expect(await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.proposalId, proposal.proposalId))).toHaveLength(1);
    expect(await database.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.idempotencyKey, `mcp-effect:${proposal.proposalId}:execute:v1`)))).toHaveLength(1);
    expect(first.sourceEventId).toBeString();
  });

  test("keeps approve/reject and stale-version races deterministic", async () => {
    const raced = await repository.createProposal(input());
    const outcomes = await Promise.allSettled([
      repository.decideAndQueue({ context, approvalItemId: raced.approvalItemId!, decision: "approve", expectedVersion: 1, policy }),
      repository.decideAndQueue({ context, approvalItemId: raced.approvalItemId!, decision: "reject", expectedVersion: 1 }),
    ]);
    expect(outcomes.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === "rejected")[0]?.reason.code).toBe("MCP_EFFECT_DECISION_CONFLICT");

    const stale = await repository.createProposal(input());
    await expect(repository.decideAndQueue({ context, approvalItemId: stale.approvalItemId!, decision: "reject", expectedVersion: 2 })).rejects.toThrow("MCP_EFFECT_VERSION_CONFLICT");
    const staleRows = await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.proposalId, stale.proposalId));
    expect(staleRows).toHaveLength(0);
  });

  test("denied or failed policy leaves no execution artifacts and replays recheck auth", async () => {
    const denied = await repository.createProposal(input());
    const denyPolicy = { preview: async () => ({ decision: "deny" as const, code: "CONTACT_SUPPRESSED", factsVersion: 1 }), final: async () => ({ decision: "deny" as const, code: "CONTACT_SUPPRESSED", factsVersion: 1 }) };
    await expect(repository.decideAndQueue({ context, approvalItemId: denied.approvalItemId!, decision: "approve", policy: denyPolicy })).resolves.toMatchObject({ status: "policy_denied" });
    const failed = await repository.createProposal(input());
    const throwPolicy = { preview: async () => { throw new Error("reader unavailable"); }, final: policy.final };
    await expect(repository.decideAndQueue({ context, approvalItemId: failed.approvalItemId!, decision: "approve", policy: throwPolicy })).rejects.toThrow("MCP_EFFECT_POLICY_UNAVAILABLE");
    const deniedArtifacts = await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.proposalId, denied.proposalId));
    const failedArtifacts = await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.proposalId, failed.proposalId));
    expect(deniedArtifacts).toHaveLength(0);
    expect(failedArtifacts).toHaveLength(0);

    const approved = await repository.createProposal(input());
    const first = await repository.decideAndQueue({ context, approvalItemId: approved.approvalItemId!, decision: "approve", policy });
    await database.db.update(workspaceMembers).set({ role: "viewer" }).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    await expect(repository.decideAndQueue({ context, approvalItemId: approved.approvalItemId!, decision: "approve", policy })).rejects.toThrow("MCP_EFFECT_DECISION_FORBIDDEN");
    await database.db.update(workspaceMembers).set({ role: "reviewer" }).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    expect(first.sourceEventId).toBeString();
  });
});
