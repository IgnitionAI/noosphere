import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { approvalItems, mcpEffectProposals, mcpEffectTraces, workspaces } from "@outbound/infrastructure/database/schema";
import { deriveMcpEffectInputHash, PostgresMcpGovernedEffectRepository } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-repository";
import type { McpGovernedEffectKind } from "@outbound/application/mcp/mcp-governed-effects";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP governed effect proposal repository", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const repository = new PostgresMcpGovernedEffectRepository(database.db);
  const workspaceId = crypto.randomUUID();
  const foreignWorkspaceId = crypto.randomUUID();
  const now = new Date("2026-08-29T12:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `mcp-effect-${workspaceId}`, name: "MCP Effect Fixture" },
      { id: foreignWorkspaceId, slug: `mcp-effect-${foreignWorkspaceId}`, name: "MCP Foreign Fixture" },
    ]);
  });

  afterAll(async () => {
    await database.client`delete from mcp_effect_traces where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`update mcp_effect_proposals set approval_item_id = null where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from approval_items where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from mcp_effect_proposals where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.close();
  });

  const proposalInput = (requestKey = crypto.randomUUID()) => ({
    workspaceId,
    clientId: "client-fixture",
    kind: "conversation_reply" as McpGovernedEffectKind,
    requestKey,
    inputHash: "a".repeat(64),
    aggregateId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    revision: 3,
    sourceVersion: 7,
    factsVersion: 7,
    intentSnapshot: {
      kind: "conversation_reply",
      aggregateId: "aggregate-fixture",
      body: "bounded reviewer content",
      credential: "must-not-persist",
      providerResponse: { secret: "must-not-persist" },
    } as Record<string, unknown>,
    sourceSnapshot: {
      status: "open",
      sourceId: "local-conversation",
      suppressed: false,
      humanReplyAt: null,
      factsVersion: 7,
      sourceUpdatedAt: "2026-08-29T09:00:00Z",
      revision: 3,
      sourceVersion: 7,
      providerAccountId: "must-not-persist",
      source: "local aggregate",
    } as Record<string, unknown>,
    createdAt: now,
  });

  test("creates a tenant-scoped proposal and redacts forbidden snapshot fields", async () => {
    const input = proposalInput();
    input.inputHash = deriveMcpEffectInputHash(input);
    const created = await repository.createProposal(input);
    expect(created).toMatchObject({ workspaceId, kind: "conversation_reply", status: "approval_required", revision: 3, sourceVersion: 7 });
    const stored = await database.db.select({ intentSnapshot: mcpEffectProposals.intentSnapshot, sourceSnapshot: mcpEffectProposals.sourceSnapshot })
      .from(mcpEffectProposals).where(and(eq(mcpEffectProposals.workspaceId, workspaceId), eq(mcpEffectProposals.id, created.proposalId)));
    expect(JSON.stringify(stored[0])).not.toContain("must-not-persist");
    expect(JSON.stringify(stored[0])).not.toContain("providerResponse");
  });

  test("replays an identical canonical hash and rejects a divergent hash", async () => {
    const input = proposalInput();
    input.inputHash = deriveMcpEffectInputHash(input);
    const first = await repository.createProposal(input);
    const reordered = {
      ...input,
      intentSnapshot: {
        providerResponse: { secret: "must-not-persist" },
        body: "bounded reviewer content",
        aggregateId: "aggregate-fixture",
        kind: "conversation_reply",
        credential: "must-not-persist",
      },
      sourceSnapshot: { source: "local aggregate", suppressed: false, humanReplyAt: null, sourceId: "local-conversation", sourceUpdatedAt: "2026-08-29T09:00:00Z", factsVersion: 7, sourceVersion: 7, providerAccountId: "must-not-persist", revision: 3, status: "open" },
    };
    const replay = await repository.createProposal({ ...reordered, correlationId: crypto.randomUUID(), inputHash: deriveMcpEffectInputHash(reordered) });
    expect(replay.proposalId).toBe(first.proposalId);
    expect(replay.correlationId).toBe(first.correlationId);
    const changedFacts = { ...input, sourceSnapshot: { ...input.sourceSnapshot as Record<string, unknown>, sourceId: "local-source-v2" } };
    await expect(repository.createProposal({ ...changedFacts, inputHash: deriveMcpEffectInputHash(changedFacts) })).rejects.toThrow("MCP_EFFECT_IDEMPOTENCY_CONFLICT");
    await expect(repository.createProposal({ ...input, inputHash: "b".repeat(64) })).rejects.toThrow("MCP_EFFECT_INPUT_HASH_MISMATCH");
    await expect(repository.createProposal({ ...input, inputHash: "not-a-canonical-hash" })).rejects.toThrow("MCP_EFFECT_CANONICAL_HASH_INVALID");
  });

  test("serializes concurrent proposal creation to one durable row", async () => {
    const input = proposalInput();
    input.inputHash = deriveMcpEffectInputHash(input);
    const results = await Promise.all(Array.from({ length: 8 }, () => repository.createProposal(input)));
    expect(new Set(results.map((result) => result.proposalId)).size).toBe(1);
    const rows = await database.db.select({ id: mcpEffectProposals.id }).from(mcpEffectProposals).where(and(
      eq(mcpEffectProposals.workspaceId, workspaceId),
      eq(mcpEffectProposals.requestKey, input.requestKey),
    ));
    expect(rows).toHaveLength(1);
  });

  test("creates one approval item and proposal/approval traces atomically", async () => {
    const input = proposalInput();
    input.inputHash = deriveMcpEffectInputHash(input);
    const proposal = await repository.createProposal(input);
    expect(proposal.approvalItemId).toBeString();
    const initialTraces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, proposal.proposalId)));
    expect(initialTraces.map((trace) => trace.stage).sort()).toEqual(["approval", "proposal"]);
    const approval = await repository.createApproval({ workspaceId, proposalId: proposal.proposalId, actor: "mcp-client", createdAt: now });
    expect(approval.approvalItemId).toBeString();
    const item = (await database.db.select().from(approvalItems).where(and(eq(approvalItems.workspaceId, workspaceId), eq(approvalItems.id, approval.approvalItemId!))))[0]!;
    expect(item.proposalId).toBe(proposal.proposalId);
    expect(item.itemType).toBe("mcp_external_effect");
    expect(item.contentEdited).toBeNull();
    expect(JSON.stringify(item.context)).toContain(proposal.proposalId);
    const traces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, proposal.proposalId)));
    expect(traces.map((trace) => trace.stage).sort()).toEqual(["approval", "proposal"]);
    expect(new Set(traces.map((trace) => trace.correlationId)).size).toBe(1);
    expect(new Set(traces.map((trace) => trace.sequence)).size).toBe(2);
    const replay = await repository.createApproval({ workspaceId, proposalId: proposal.proposalId, actor: "other", createdAt: now });
    expect(replay.approvalItemId).toBe(approval.approvalItemId);
  });

  test("appends redacted traces with monotonic sequence and idempotent replay", async () => {
    const input = proposalInput();
    input.inputHash = deriveMcpEffectInputHash(input);
    const proposal = await repository.createProposal(input);
    const first = await repository.appendTrace({
      workspaceId, proposalId: proposal.proposalId, stage: "policy", sourceEventId: crypto.randomUUID(),
      idempotencyKey: "policy:preview:v1", eventType: "McpEffectPolicyPreviewed", actor: "reviewer", createdAt: now,
      redactedPayload: { decision: "allow", accessToken: "redact-me" },
    });
    const replay = await repository.appendTrace({
      workspaceId, proposalId: proposal.proposalId, stage: "policy", sourceEventId: first.sourceEventId,
      idempotencyKey: "policy:preview:v1", eventType: "McpEffectPolicyPreviewed", actor: "reviewer", createdAt: now,
      redactedPayload: { decision: "allow" },
    });
    expect(replay.id).toBe(first.id);
    expect(replay.sequence).toBe(first.sequence);
    const second = await repository.appendTrace({
      workspaceId, proposalId: proposal.proposalId, stage: "result", sourceEventId: crypto.randomUUID(),
      idempotencyKey: "result:v1", eventType: "McpEffectResultRecorded", createdAt: now,
      redactedPayload: { state: "unknown", providerResponse: "redact-me" },
    });
    expect(second.sequence).toBe(first.sequence + 1);
    expect(JSON.stringify(second.redactedPayload)).not.toContain("providerResponse");
  });

  test("does not reveal foreign proposal identifiers", async () => {
    const input = proposalInput();
    input.inputHash = deriveMcpEffectInputHash(input);
    const proposal = await repository.createProposal(input);
    expect(await repository.getProposal({ workspaceId: foreignWorkspaceId, proposalId: proposal.proposalId })).toBeNull();
    await expect(repository.createApproval({ workspaceId: foreignWorkspaceId, proposalId: proposal.proposalId })).rejects.toThrow("MCP_EFFECT_PROPOSAL_NOT_FOUND");
    await expect(repository.appendTrace({ workspaceId: foreignWorkspaceId, proposalId: proposal.proposalId, stage: "result", sourceEventId: crypto.randomUUID(), idempotencyKey: "foreign", eventType: "foreign" })).rejects.toThrow("MCP_EFFECT_PROPOSAL_NOT_FOUND");
  });

  test("projects only reviewer-safe fields for each kind and rejects non-object roots", async () => {
    const input = proposalInput();
    input.inputHash = deriveMcpEffectInputHash(input);
    const proposal = await repository.createProposal({
      ...input,
      intentSnapshot: {
        kind: "conversation_reply", aggregateId: input.aggregateId, body: "safe", subject: "safe subject",
        nested: { apiKey: "x", token: "x", privateKey: "x", cookie: "x", unknown: "x" },
      },
      sourceSnapshot: { status: "open", sourceId: "local-conversation", sourceUpdatedAt: "2026-08-29T09:00:00Z", factsVersion: 7, suppressed: false, humanReplyAt: null, revision: 3, sourceVersion: 7, nested: { apiKey: "x", unknown: "x" } },
      inputHash: deriveMcpEffectInputHash({ ...input, intentSnapshot: { kind: "conversation_reply", aggregateId: input.aggregateId, body: "safe", subject: "safe subject", nested: { apiKey: "x", token: "x", privateKey: "x", cookie: "x", unknown: "x" } }, sourceSnapshot: { status: "open", sourceId: "local-conversation", sourceUpdatedAt: "2026-08-29T09:00:00Z", factsVersion: 7, suppressed: false, humanReplyAt: null, revision: 3, sourceVersion: 7, nested: { apiKey: "x", unknown: "x" } } }),
    });
    expect(Object.keys(proposal.intentSnapshot).sort()).toEqual(["kind", "aggregateId", "body", "subject", "revision", "sourceVersion"].sort());
    expect(Object.keys(proposal.sourceSnapshot).sort()).toEqual(["kind", "aggregateId", "status", "sourceId", "sourceUpdatedAt", "factsVersion", "suppressed", "humanReplyAt", "revision", "sourceVersion"].sort());
    const item = (await database.db.select({ contentOriginal: approvalItems.contentOriginal }).from(approvalItems).where(eq(approvalItems.proposalId, proposal.proposalId)))[0]!;
    expect(item.contentOriginal).toEqual(proposal.intentSnapshot);
    await expect(repository.createProposal({ ...input, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), intentSnapshot: [] as unknown as Record<string, unknown> })).rejects.toThrow("MCP_EFFECT_INTENT_SNAPSHOT_OBJECT_REQUIRED");
  });

  test("uses UTF-8 byte bounds and rejects a caller-supplied spoofed hash", async () => {
    const input = proposalInput();
    input.inputHash = deriveMcpEffectInputHash(input);
    await expect(repository.createProposal({ ...input, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64) })).rejects.toThrow("MCP_EFFECT_INPUT_HASH_MISMATCH");
    const boundary = proposalInput();
    boundary.intentSnapshot = { ...boundary.intentSnapshot, body: "😀".repeat(8_159) };
    boundary.inputHash = deriveMcpEffectInputHash(boundary);
    await expect(repository.createProposal(boundary)).resolves.toBeDefined();
    const oversized = proposalInput();
    oversized.intentSnapshot = { ...oversized.intentSnapshot, body: "😀".repeat(8_160) };
    oversized.inputHash = deriveMcpEffectInputHash(oversized);
    await expect(repository.createProposal(oversized)).rejects.toThrow("MCP_EFFECT_INTENT_SNAPSHOT_TOO_LARGE");
  });

  test("serializes source-event identity across proposals", async () => {
    const firstInput = proposalInput();
    firstInput.inputHash = deriveMcpEffectInputHash(firstInput);
    const secondInput = proposalInput();
    secondInput.inputHash = deriveMcpEffectInputHash(secondInput);
    const [first, second] = await Promise.all([repository.createProposal(firstInput), repository.createProposal(secondInput)]);
    const sourceEventId = crypto.randomUUID();
    const outcomes = await Promise.allSettled([
      repository.appendTrace({ workspaceId, proposalId: first.proposalId, stage: "policy", sourceEventId, idempotencyKey: "same-source-1", eventType: "policy" }),
      repository.appendTrace({ workspaceId, proposalId: second.proposalId, stage: "policy", sourceEventId, idempotencyKey: "same-source-2", eventType: "policy" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")?.reason.message).toContain("MCP_EFFECT_TRACE_SOURCE_EVENT_CONFLICT");
  });

  test("keeps only stale-relevant authoritative source facts per kind", async () => {
    const cases: Array<{ kind: McpGovernedEffectKind; fields: Record<string, unknown>; expected: Record<string, unknown> }> = [
      { kind: "conversation_reply", fields: { status: "open", sourceId: "local-conversation", sourceUpdatedAt: "2026-08-29T09:00:00Z", factsVersion: 7, suppressed: true, humanReplyAt: "2026-08-29T11:00:00Z", apiKey: "x" }, expected: { status: "open", sourceId: "local-conversation", sourceUpdatedAt: "2026-08-29T09:00:00Z", suppressed: true, humanReplyAt: "2026-08-29T11:00:00Z" } },
      { kind: "content_publication", fields: { status: "ready", sourceId: "local-asset", sourceUpdatedAt: "2026-08-29T09:00:00Z", factsVersion: 7, assetVersionId: "v3", contentVersion: 1, policyVersion: "editorial-v1", assetId: "asset-fixture", publicationId: "publication-fixture", assetReady: true, assetStatus: "ready", strategyActive: true, strategyDeleted: false, strategyVersionId: "strategy-version-fixture", strategyVersion: 3, token: "x" }, expected: { status: "ready", sourceId: "local-asset", sourceUpdatedAt: "2026-08-29T09:00:00Z", assetVersionId: "v3", contentVersion: 1, policyVersion: "editorial-v1", assetId: "asset-fixture", publicationId: "publication-fixture", assetReady: true, assetStatus: "ready", strategyActive: true, strategyDeleted: false, strategyVersionId: "strategy-version-fixture", strategyVersion: 3 } },
      { kind: "meeting_proposal", fields: { status: "offered", sourceId: "local-meeting", sourceUpdatedAt: "2026-08-29T09:00:00Z", factsVersion: 7, slotPosition: 1, slotStart: "2026-09-01T10:00:00Z", slotEnd: "2026-09-01T10:30:00Z", timeZone: "UTC", expiresAt: "2026-09-02T00:00:00Z", privateKey: "x" }, expected: { status: "offered", sourceId: "local-meeting", sourceUpdatedAt: "2026-08-29T09:00:00Z", slotPosition: 1, slotStart: "2026-09-01T10:00:00Z", slotEnd: "2026-09-01T10:30:00Z", timeZone: "UTC", expiresAt: "2026-09-02T00:00:00Z" } },
      { kind: "campaign_activation", fields: { status: "active", sourceId: "local-campaign", sourceUpdatedAt: "2026-08-29T09:00:00Z", factsVersion: 7, policyVersion: "campaign-v1", automationStage: "ready", enrollmentFingerprint: "a".repeat(64), scheduleWindow: { start: "2026-09-01T09:00:00Z", end: "2026-09-01T17:00:00Z", timeZone: "UTC" }, accountHealth: { status: "healthy", checkedAt: "2026-08-29T09:00:00Z" }, cookie: "x" }, expected: { status: "active", sourceId: "local-campaign", sourceUpdatedAt: "2026-08-29T09:00:00Z", policyVersion: "campaign-v1", automationStage: "ready", enrollmentFingerprint: "a".repeat(64), scheduleWindow: { start: "2026-09-01T09:00:00Z", end: "2026-09-01T17:00:00Z", timeZone: "UTC" }, accountHealth: { status: "healthy", checkedAt: "2026-08-29T09:00:00Z" } } },
    ];
    for (const [index, entry] of cases.entries()) {
      const input = { ...proposalInput(), kind: entry.kind, requestKey: crypto.randomUUID(), sourceSnapshot: entry.fields };
      input.inputHash = deriveMcpEffectInputHash(input);
      const proposal = await repository.createProposal(input);
      expect(proposal.sourceSnapshot).toEqual({ kind: entry.kind, aggregateId: input.aggregateId, ...entry.expected, factsVersion: 7, revision: 3, sourceVersion: 7 });
    }
  });

  test("reprojects an unsafe partial proposal before creating a compatible approval", async () => {
    const proposalId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();
    await database.db.insert(mcpEffectProposals).values({
      id: proposalId, workspaceId, clientId: "legacy-client", kind: "conversation_reply", requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), aggregateId,
      intentSnapshot: { kind: "conversation_reply", aggregateId, body: "safe", nested: { apiKey: "never" }, privateKey: "never" },
      sourceSnapshot: { revision: 1, sourceVersion: 1 }, revision: 1, sourceVersion: 1, correlationId: crypto.randomUUID(),
    });
    const approval = await repository.createApproval({ workspaceId, proposalId });
    const item = (await database.db.select({ contentOriginal: approvalItems.contentOriginal }).from(approvalItems).where(eq(approvalItems.id, approval.approvalItemId)))[0]!;
    expect(item.contentOriginal).toEqual({ kind: "conversation_reply", aggregateId, body: "safe", revision: 1, sourceVersion: 1 });
    expect(JSON.stringify(item.contentOriginal)).not.toContain("never");
  });

  test("uses stable bounded errors for JSONB-sized nested Unicode payloads", async () => {
    const oversized = proposalInput();
    oversized.intentSnapshot = { body: "😀".repeat(8_200), nested: [{ number: 1, value: true }] };
    oversized.inputHash = "a".repeat(64);
    await expect(repository.createProposal(oversized)).rejects.toThrow("MCP_EFFECT_INTENT_SNAPSHOT_TOO_LARGE");
    const nonObject = proposalInput();
    nonObject.sourceSnapshot = ["not", "an", "object"] as unknown as Record<string, unknown>;
    nonObject.inputHash = "a".repeat(64);
    await expect(repository.createProposal(nonObject)).rejects.toThrow("MCP_EFFECT_SOURCE_SNAPSHOT_OBJECT_REQUIRED");
  });

  test("validates typed stale facts and structured schedule/account projections", async () => {
    const invalid = proposalInput();
    invalid.sourceSnapshot = { status: "open", sourceId: "local", sourceUpdatedAt: "2026-08-29T09:00:00Z", factsVersion: 7, suppressed: "false", revision: 3, sourceVersion: 7 };
    invalid.inputHash = "a".repeat(64);
    await expect(repository.createProposal(invalid)).rejects.toThrow("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    const missing = proposalInput();
    missing.sourceSnapshot = { status: "open", sourceId: "local", revision: 3, sourceVersion: 7 };
    missing.inputHash = "a".repeat(64);
    await expect(repository.createProposal(missing)).rejects.toThrow("MCP_EFFECT_SOURCE_FACT_REQUIRED");
    const structured = { ...proposalInput(), sourceSnapshot: {
      status: "open", sourceId: "local", sourceUpdatedAt: "2026-08-29T09:00:00Z", factsVersion: 7, suppressed: false, humanReplyAt: null,
      scheduleWindow: { start: "2026-09-01T09:00:00Z", end: "2026-09-01T17:00:00Z", timeZone: "UTC" },
      revision: 3, sourceVersion: 7,
    } };
    structured.inputHash = deriveMcpEffectInputHash(structured);
    await expect(repository.createProposal(structured)).resolves.toBeDefined();
  });

  test("rejects undefined required source facts for every effect kind before persistence", async () => {
    const cases: Array<{ kind: McpGovernedEffectKind; field: string; sourceSnapshot: Record<string, unknown> }> = [
      { kind: "conversation_reply", field: "status", sourceSnapshot: { status: undefined, sourceId: "local-conversation", suppressed: false } },
      { kind: "content_publication", field: "assetVersionId", sourceSnapshot: { status: "ready", sourceId: "local-asset", assetVersionId: undefined, policyVersion: "editorial-v1" } },
      { kind: "meeting_proposal", field: "slotStart", sourceSnapshot: { status: "offered", sourceId: "local-meeting", slotStart: undefined, slotEnd: "2026-09-01T10:30:00Z", timeZone: "UTC" } },
      { kind: "campaign_activation", field: "policyVersion", sourceSnapshot: { status: "active", sourceId: "local-campaign", policyVersion: undefined, automationStage: "ready" } },
    ];
    for (const entry of cases) {
      const input = { ...proposalInput(), kind: entry.kind, requestKey: crypto.randomUUID(), sourceSnapshot: entry.sourceSnapshot };
      await expect((async () => {
        input.inputHash = deriveMcpEffectInputHash(input);
        await repository.createProposal(input);
      })()).rejects.toThrow("MCP_EFFECT_SOURCE_FACT_REQUIRED");
      const rows = await database.db.select({ id: mcpEffectProposals.id }).from(mcpEffectProposals).where(and(
        eq(mcpEffectProposals.workspaceId, workspaceId), eq(mcpEffectProposals.requestKey, input.requestKey),
      ));
      expect(rows).toHaveLength(0);
    }
  });

  test("accepts only boolean humanReply and never exposes raw reply content", async () => {
    const unsafe = { ...proposalInput(), requestKey: crypto.randomUUID(), sourceSnapshot: {
      ...proposalInput().sourceSnapshot, humanReply: "raw reply content",
    } };
    await expect((async () => {
      unsafe.inputHash = deriveMcpEffectInputHash(unsafe);
      await repository.createProposal(unsafe);
    })()).rejects.toThrow("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    const rejected = await database.db.select({ id: mcpEffectProposals.id }).from(mcpEffectProposals).where(and(
      eq(mcpEffectProposals.workspaceId, workspaceId), eq(mcpEffectProposals.requestKey, unsafe.requestKey),
    ));
    expect(rejected).toHaveLength(0);

    const safe = { ...proposalInput(), requestKey: crypto.randomUUID(), sourceSnapshot: {
      ...proposalInput().sourceSnapshot, humanReply: true, humanReplyAt: "2026-08-29T11:00:00Z",
    } };
    safe.inputHash = deriveMcpEffectInputHash(safe);
    const proposal = await repository.createProposal(safe);
    const fetched = await repository.getProposal({ workspaceId, proposalId: proposal.proposalId });
    expect(fetched?.sourceSnapshot).toMatchObject({ humanReply: true, humanReplyAt: "2026-08-29T11:00:00Z" });
    expect(JSON.stringify(fetched?.sourceSnapshot)).not.toContain("raw reply content");
  });

  test("validates trace fields without coercing invalid primitives", async () => {
    const input = proposalInput();
    input.inputHash = deriveMcpEffectInputHash(input);
    const proposal = await repository.createProposal(input);
    await expect(repository.appendTrace({ workspaceId, proposalId: proposal.proposalId, stage: "policy", sourceEventId: crypto.randomUUID(), idempotencyKey: "bad-decision", eventType: "policy", redactedPayload: { decision: "maybe" } })).rejects.toThrow("MCP_EFFECT_TRACE_DECISION_INVALID");
    await expect(repository.appendTrace({ workspaceId, proposalId: proposal.proposalId, stage: "attempt", sourceEventId: crypto.randomUUID(), idempotencyKey: "bad-attempt", eventType: "attempt", redactedPayload: { attempt: Number.NaN } })).rejects.toThrow("MCP_EFFECT_TRACE_ATTEMPT_INVALID");
    await expect(repository.appendTrace({ workspaceId, proposalId: proposal.proposalId, stage: "result", sourceEventId: "not-an-id", idempotencyKey: "bad-id", eventType: "result" })).rejects.toThrow("MCP_EFFECT_TRACE_SOURCE_EVENT_INVALID");
  });

  test("rejects unsafe existing approval content and repairs a safe missing approval trace", async () => {
    const unsafeProposalId = crypto.randomUUID();
    const unsafeAggregateId = crypto.randomUUID();
    const unsafeApprovalId = crypto.randomUUID();
    await database.db.insert(mcpEffectProposals).values({ id: unsafeProposalId, workspaceId, clientId: "legacy-unsafe", kind: "conversation_reply", requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), aggregateId: unsafeAggregateId, intentSnapshot: { kind: "conversation_reply", aggregateId: unsafeAggregateId, body: "safe", revision: 1, sourceVersion: 1 }, sourceSnapshot: { revision: 1, sourceVersion: 1 }, revision: 1, sourceVersion: 1, correlationId: crypto.randomUUID() });
    await database.db.insert(approvalItems).values({ id: unsafeApprovalId, workspaceId, proposalId: unsafeProposalId, itemType: "mcp_external_effect", channel: "mcp", contentOriginal: { kind: "conversation_reply", aggregateId: unsafeAggregateId, body: "safe", privateKey: "never" }, contentEdited: { body: "edited" }, context: { proposalId: unsafeProposalId }, status: "approved" });
    await database.db.update(mcpEffectProposals).set({ approvalItemId: unsafeApprovalId }).where(eq(mcpEffectProposals.id, unsafeProposalId));
    await expect(repository.createApproval({ workspaceId, proposalId: unsafeProposalId })).rejects.toThrow("MCP_EFFECT_APPROVAL_CONTENT_INVALID");

    const safeProposalId = crypto.randomUUID();
    const safeAggregateId = crypto.randomUUID();
    const safeApprovalId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    await database.db.insert(mcpEffectProposals).values({ id: safeProposalId, workspaceId, clientId: "legacy-safe", kind: "conversation_reply", requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), aggregateId: safeAggregateId, intentSnapshot: { kind: "conversation_reply", aggregateId: safeAggregateId, body: "safe", revision: 1, sourceVersion: 1 }, sourceSnapshot: { revision: 1, sourceVersion: 1 }, revision: 1, sourceVersion: 1, correlationId });
    await database.db.insert(approvalItems).values({ id: safeApprovalId, workspaceId, proposalId: safeProposalId, itemType: "mcp_external_effect", channel: "mcp", contentOriginal: { kind: "conversation_reply", aggregateId: safeAggregateId, body: "safe", revision: 1, sourceVersion: 1 }, contentEdited: { body: "edited" }, context: { proposalId: safeProposalId }, status: "approved" });
    const replay = await repository.createApproval({ workspaceId, proposalId: safeProposalId });
    expect(replay.approvalItemId).toBe(safeApprovalId);
    const repaired = await database.db.select({ approvalItemId: mcpEffectProposals.approvalItemId }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, safeProposalId));
    expect(repaired[0]?.approvalItemId).toBe(safeApprovalId);
    const trace = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.proposalId, safeProposalId), eq(mcpEffectTraces.idempotencyKey, `approval:${safeApprovalId}:created:v1`)));
    expect(trace).toHaveLength(1);
    const preserved = await database.db.select({ contentEdited: approvalItems.contentEdited, status: approvalItems.status }).from(approvalItems).where(eq(approvalItems.id, safeApprovalId));
    expect(preserved[0]).toEqual({ contentEdited: { body: "edited" }, status: "approved" });
    expect(correlationId).toBeString();
  });
});
