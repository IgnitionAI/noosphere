import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { approvalItems, auditLogs, authUsers, contacts, conversations, jobs, mcpEffectIntentions, mcpEffectProposals, mcpEffectTraces, outboxEvents, workspaceMembers, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresMcpGovernedEffectRepository } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-repository";
import { PostgresMcpGovernedEffectCapabilities } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-capabilities";
import { PostgresMcpGovernedEffectWorker, type McpExternalEffectLeasedJob } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-worker";
import { PostgresMcpExternalEffectAttemptRepository } from "@outbound/infrastructure/mcp/postgres-mcp-effect-attempt-repository";
import { McpExternalEffectOutboxHandler } from "@outbound/infrastructure/outbox/mcp-external-effect-outbox-handler";
import type { ExternalEffectFacts } from "@outbound/application/mcp/external-effect-policy";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP governed effects canary", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const now = new Date("2026-08-30T12:00:00.000Z");
  const workspaceId = crypto.randomUUID();
  const foreignWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const foreignUserId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const foreignContactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const foreignConversationId = crypto.randomUUID();
  const context: McpExecutionContext = {
    userId,
    workspaceId,
    clientId: "mcp-canary",
    role: "reviewer" as const,
    scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    audience: "noosphere",
  };
  const foreignContext: McpExecutionContext = { ...context, userId: foreignUserId, workspaceId: foreignWorkspaceId };
  const facts = (aggregateId: string): ExternalEffectFacts => ({
    kind: "conversation_reply",
    aggregateId,
    revision: 1,
    sourceVersion: 1,
    factsVersion: 1,
    sourceId: `conversation:${aggregateId}`,
    sourceUpdatedAt: now.toISOString(),
    status: "open",
    conversationStatus: "open",
    contactPresent: true,
    suppressed: false,
    hasHumanReply: false,
    accountHealthy: true,
    adapterAvailable: true,
    quotaAvailable: true,
  });
  const factsReader = {
    readPrepare: async (input: { readonly context: { readonly workspaceId: string }; readonly aggregateId: string }) =>
      facts(input.aggregateId),
  };
  const policy = {
    preview: async () => ({ decision: "allow" as const, code: "OK" as const, factsVersion: 1 }),
    final: async () => ({ decision: "allow" as const, code: "OK" as const, factsVersion: 1 }),
  };
  let proposalIds: string[] = [];

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `canary-${workspaceId}`, name: "MCP canary" },
      { id: foreignWorkspaceId, slug: `canary-${foreignWorkspaceId}`, name: "MCP foreign canary" },
    ]);
    await database.db.insert(authUsers).values([
      { id: userId, name: "Canary reviewer", email: `canary-${userId}@example.test` },
      { id: foreignUserId, name: "Foreign reviewer", email: `canary-${foreignUserId}@example.test` },
    ]);
    await database.db.insert(workspaceMembers).values([
      { workspaceId, userId, role: "reviewer" },
      { workspaceId: foreignWorkspaceId, userId: foreignUserId, role: "reviewer" },
    ]);
    await database.db.insert(contacts).values([
      { id: contactId, workspaceId, firstName: "Canary", lastName: "Contact" },
      { id: foreignContactId, workspaceId: foreignWorkspaceId, firstName: "Foreign", lastName: "Contact" },
    ]);
    await database.db.insert(conversations).values([
      { id: conversationId, workspaceId, contactId, provider: "fixture", providerAccountId: "fixture-account", providerThreadId: `thread-${conversationId}`, channel: "linkedin", lastMessageAt: now },
      { id: foreignConversationId, workspaceId: foreignWorkspaceId, contactId: foreignContactId, provider: "fixture", providerAccountId: "fixture-account", providerThreadId: `thread-${foreignConversationId}`, channel: "linkedin", lastMessageAt: now },
    ]);
  });

  afterAll(async () => {
    const tenants = [workspaceId, foreignWorkspaceId];
    // Audit rows are immutable by design; temporarily disable only the
    // trigger while deleting this test's exact tenant-owned rows, then always
    // restore it before closing the connection.
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    try {
      await database.db.delete(auditLogs).where(inArray(auditLogs.workspaceId, tenants));
      await database.db.delete(mcpEffectTraces).where(inArray(mcpEffectTraces.workspaceId, tenants));
      await database.db.delete(outboxEvents).where(inArray(outboxEvents.workspaceId, tenants));
      await database.db.update(mcpEffectProposals).set({ approvalItemId: null, operationId: null, jobId: null, reconciliationId: null }).where(inArray(mcpEffectProposals.workspaceId, tenants));
      await database.db.delete(mcpEffectIntentions).where(inArray(mcpEffectIntentions.workspaceId, tenants));
      await database.db.delete(mcpEffectProposals).where(inArray(mcpEffectProposals.workspaceId, tenants));
      await database.db.delete(approvalItems).where(inArray(approvalItems.workspaceId, tenants));
      await database.db.delete(jobs).where(inArray(jobs.workspaceId, tenants));
      await database.db.delete(conversations).where(inArray(conversations.workspaceId, tenants));
      await database.db.delete(contacts).where(inArray(contacts.workspaceId, tenants));
      await database.db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, tenants));
      await database.db.delete(authUsers).where(inArray(authUsers.id, [userId, foreignUserId]));
      await database.db.delete(workspaces).where(inArray(workspaces.id, tenants));
    } finally {
      await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
      await database.close();
    }
  });

  async function lease(jobId: string): Promise<McpExternalEffectLeasedJob> {
    const lockedUntil = new Date(now.getTime() + 60_000);
    await database.client`update jobs set status = 'running', attempts = attempts + 1, locked_by = 'canary-worker', locked_at = ${now}, locked_until = ${lockedUntil}, updated_at = ${now} where workspace_id = ${workspaceId} and id = ${jobId} and status = 'pending'`;
    const rows = await database.client<({ id: string; workspace_id: string; type: string; status: string; payload: unknown; locked_until: Date; locked_by: string })[]>`select id, workspace_id, type, status, payload, locked_until, locked_by from jobs where workspace_id = ${workspaceId} and id = ${jobId}`;
    const row = rows[0];
    if (!row) throw new Error("canary job missing");
    return { id: row.id, workspaceId: row.workspace_id, type: row.type, status: row.status, payload: row.payload, lockedUntil: row.locked_until, lockedBy: row.locked_by };
  }

  async function replayLease(jobId: string): Promise<McpExternalEffectLeasedJob> {
    const lockedUntil = new Date(now.getTime() + 60_000);
    await database.client`update jobs set status = 'running', attempts = attempts + 1, locked_by = 'canary-restart', locked_at = ${now}, locked_until = ${lockedUntil}, updated_at = ${now} where workspace_id = ${workspaceId} and id = ${jobId}`;
    const rows = await database.client<({ id: string; workspace_id: string; type: string; status: string; payload: unknown; locked_until: Date; locked_by: string })[]>`select id, workspace_id, type, status, payload, locked_until, locked_by from jobs where workspace_id = ${workspaceId} and id = ${jobId}`;
    const row = rows[0];
    if (!row) throw new Error("canary replay job missing");
    return { id: row.id, workspaceId: row.workspace_id, type: row.type, status: row.status, payload: row.payload, lockedUntil: row.locked_until, lockedBy: row.locked_by };
  }

  test("persists one governed execution and crosses the provider boundary only after worker claim", async () => {
    const repository = new PostgresMcpGovernedEffectRepository(database.db, () => now);
    const capabilities = new PostgresMcpGovernedEffectCapabilities(repository, factsReader, policy, () => now);
    const proposal = await capabilities.prepare(context, { kind: "conversation_reply", conversationId, body: "Canary reply", requestKey: crypto.randomUUID(), inputHash: "" });
    proposalIds.push(proposal.proposalId);
    const before = await database.db.select({ id: mcpEffectTraces.id }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, proposal.proposalId), eq(mcpEffectTraces.stage, "attempt")));
    expect(before).toHaveLength(0);
    const decision = await capabilities.decide(context, { approvalItemId: proposal.approvalItemId!, decision: "approve", expectedVersion: 1 });
    expect(decision.status).toBe("queued");
    expect(decision.jobId).toBeString();
    const rows = await database.client<{ id: string; payload: Record<string, unknown>; event_type: string }[]>`select id, payload, event_type from outbox_events where workspace_id = ${workspaceId} and aggregate_id = ${proposal.proposalId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe("McpExternalEffectExecutionRequested");
    expect(rows[0]!.payload.sourceEventId).toBe(rows[0]!.id);
    expect(rows[0]!.payload.correlationId).toBe(proposal.correlationId);
    const handler = new McpExternalEffectOutboxHandler(database.client);
    await handler.handle({ id: rows[0]!.id, workspace_id: workspaceId, aggregate_type: "mcp_effect_proposal", aggregate_id: proposal.proposalId, event_type: rows[0]!.event_type, payload: rows[0]!.payload });
    const audit = await database.client<{ count: number }[]>`select count(*)::int as count from audit_logs where workspace_id = ${workspaceId} and source_event_id = ${rows[0]!.id}`;
    expect(audit[0]!.count).toBe(1);

    let providerCalls = 0;
    let markerSeen = false;
    const attempt = new PostgresMcpExternalEffectAttemptRepository(database.db);
    const job = await lease(decision.jobId!);
    const worker = new PostgresMcpGovernedEffectWorker(database.db, policy, {
      now: () => now,
      leaseMs: 60_000,
      attemptPort: attempt,
      queue: { acknowledge: async () => undefined },
      executor: async ({ marker }) => {
        const attemptTrace = await database.db.select({ sourceEventId: mcpEffectTraces.sourceEventId }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, proposal.proposalId), eq(mcpEffectTraces.stage, "attempt")));
        markerSeen = attemptTrace.some((entry) => entry.sourceEventId === marker.sourceEventId);
        providerCalls += 1;
        return { outcome: "delivered", authoritative: true, code: "DELIVERED", result: { providerRequestId: "fake-canary-request" } };
      },
    });
    expect(providerCalls).toBe(0);
    const claimed = await worker.process(job);
    expect(claimed.code).toBe("DELIVERED");
    expect(providerCalls).toBe(1);
    expect(markerSeen).toBe(true);
    const traces = await database.db.select({ stage: mcpEffectTraces.stage, correlationId: mcpEffectTraces.correlationId, redactedPayload: mcpEffectTraces.redactedPayload }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, proposal.proposalId)));
    expect(new Set(traces.map((trace) => trace.correlationId))).toEqual(new Set([proposal.correlationId]));
    expect(new Set(traces.map((trace) => trace.stage))).toEqual(new Set(["proposal", "approval", "policy", "outbox", "attempt", "result"]));
    // Provider identifiers may be retained as bounded reconciliation refs;
    // provider bodies/secrets must never cross the redacted trace boundary.
    expect(JSON.stringify(traces)).not.toContain("Canary reply");
  });

  test("turns an ambiguous fake into one durable unknown and never retries the mutation on replay", async () => {
    const repository = new PostgresMcpGovernedEffectRepository(database.db, () => now);
    const capabilities = new PostgresMcpGovernedEffectCapabilities(repository, factsReader, policy, () => now);
    const proposal = await capabilities.prepare(context, { kind: "conversation_reply", conversationId, body: "Ambiguous canary", requestKey: crypto.randomUUID(), inputHash: "" });
    proposalIds.push(proposal.proposalId);
    const decision = await capabilities.decide(context, { approvalItemId: proposal.approvalItemId!, decision: "approve", expectedVersion: 1 });
    const job = await lease(decision.jobId!);
    let providerCalls = 0;
    let acknowledgements = 0;
    const worker = new PostgresMcpGovernedEffectWorker(database.db, policy, {
      now: () => now,
      leaseMs: 60_000,
      attemptPort: new PostgresMcpExternalEffectAttemptRepository(database.db),
      queue: { acknowledge: async () => { acknowledgements += 1; } },
      executor: async () => {
        providerCalls += 1;
        throw new Error("ambiguous fake timeout");
      },
    });
    const first = await worker.process(job);
    expect(first.code).toBe("EFFECT_EXECUTOR_AMBIGUOUS");
    expect(providerCalls).toBe(1);
    expect(acknowledgements).toBe(1);
    const reconciliation = await database.client<{ count: number }[]>`select count(*)::int as count from mcp_effect_reconciliations where workspace_id = ${workspaceId} and proposal_id = ${proposal.proposalId}`;
    expect(reconciliation[0]!.count).toBe(1);
    const replay = await worker.process(await replayLease(decision.jobId!));
    expect(replay.outcome).toBe("already_claimed");
    expect(providerCalls).toBe(1);
    expect(acknowledgements).toBe(2);
  });

  test("keeps tenant isolation and campaign adapters fail closed without queue artifacts", async () => {
    const repository = new PostgresMcpGovernedEffectRepository(database.db, () => now);
    const capabilities = new PostgresMcpGovernedEffectCapabilities(repository, factsReader, policy, () => now);
    const foreignProposal = await capabilities.prepare(foreignContext, { kind: "conversation_reply", conversationId: foreignConversationId, body: "foreign", requestKey: crypto.randomUUID(), inputHash: "" });
    await expect(capabilities.status(context, { proposalId: foreignProposal.proposalId })).resolves.toBeNull();
    const campaignId = crypto.randomUUID();
    const campaignReader = { readPrepare: async () => ({ kind: "campaign_activation", aggregateId: campaignId, revision: 1, sourceVersion: 1, factsVersion: 1, sourceId: "campaign", sourceUpdatedAt: now.toISOString(), status: "active", accountHealthy: true, adapterAvailable: false, quotaAvailable: true, automationStage: "active", enrollmentFingerprint: "fixture" }) };
    const campaign = new PostgresMcpGovernedEffectCapabilities(repository, campaignReader, policy, () => now);
    await expect(campaign.prepare(context, { kind: "campaign_activation", campaignId, requestKey: crypto.randomUUID(), inputHash: "" })).rejects.toThrow("MCP_EFFECT_ADAPTER_UNAVAILABLE");
  });
});
