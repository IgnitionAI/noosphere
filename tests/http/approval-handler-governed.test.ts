import { describe, expect, test } from "bun:test";
import type { McpEffectStatusView, McpGovernedEffectCapabilities } from "@outbound/application/mcp/mcp-governed-effects";
import type { Database } from "@outbound/infrastructure/database/client";
import { createApprovalHttpHandler } from "@outbound/interface/http/approval-handler";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const governedItemId = "00000000-0000-4000-8000-000000000003";
const legacyItemId = "00000000-0000-4000-8000-000000000004";
const governedProposalId = "00000000-0000-4000-8000-000000000005";
const missingVersionItemId = "00000000-0000-4000-8000-000000000008";
const caseCollisionItemIdLower = "00000000-0000-4000-8000-00000000000c";
const caseCollisionItemIdUpper = "00000000-0000-4000-8000-00000000000C";

function governedStatus(approvalItemId = governedItemId): McpEffectStatusView {
  return {
    proposalId: governedProposalId,
    workspaceId,
    kind: "conversation_reply",
    status: "queued",
    approvalItemId,
    correlationId: "00000000-0000-4000-8000-000000000006",
    version: 2,
    revision: 1,
    sourceVersion: 1,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    policyCode: "OK",
    operationId: null,
    jobId: "00000000-0000-4000-8000-000000000007",
    reconciliationId: null,
    approvalDecision: "approve",
    intent: null,
    redacted: false,
  };
}

function item(id: string, proposalId: string | null, proposalVersion: number | null = null) {
  return {
    id,
    proposalId,
    proposalVersion,
    campaignId: null,
    contactId: null,
    enrollmentId: null,
    itemType: proposalId ? "mcp_external_effect" : "first_contact",
    channel: proposalId ? "mcp" : "email",
    stepPosition: null,
    contentOriginal: { body: "bounded" },
    contentEdited: null,
    context: proposalId ? { proposalId } : {},
    sourceUpdatedAt: null,
    status: "pending",
    decisionBy: null,
    decidedAt: null,
    rejectionJustification: null,
    invalidationReason: null,
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
  };
}

function harness(options: { readonly governed?: McpGovernedEffectCapabilities | null; readonly governedDecisionError?: Error } = {}) {
  const calls = {
    legacyGet: [] as unknown[],
    legacyDecide: [] as unknown[],
    legacyBulk: [] as unknown[],
    governedDecide: [] as unknown[],
  };
  const items = new Map([
    [governedItemId, item(governedItemId, governedProposalId, 2)],
    [missingVersionItemId, item(missingVersionItemId, governedProposalId, null)],
    [legacyItemId, item(legacyItemId, null)],
    [caseCollisionItemIdLower, item(caseCollisionItemIdLower, null)],
  ]);
  const legacyRepository = {
    async list() { return []; },
    async get(input: { readonly itemId: string }) { calls.legacyGet.push(input); return items.get(input.itemId) ?? null; },
    async update() { throw new Error("not used"); },
    async decide(input: unknown) { calls.legacyDecide.push(input); return item(legacyItemId, null); },
    async bulkDecide(input: unknown) {
      calls.legacyBulk.push(input);
      const decisions = (input as { readonly decisions?: readonly { readonly itemId: string }[] }).decisions ?? [];
      return { approved: decisions.map((decision) => decision.itemId), rejected: [], invalidated: [], conflicts: [] };
    },
  };
  const governed = Object.prototype.hasOwnProperty.call(options, "governed")
    ? options.governed ?? undefined
    : {
      async prepare() { throw new Error("not used"); },
      async list() { return []; },
      async status() { return governedStatus(); },
      async decide(_context: unknown, input: unknown) {
        calls.governedDecide.push(input);
        if (options.governedDecisionError) throw options.governedDecisionError;
        return governedStatus();
      },
    } satisfies McpGovernedEffectCapabilities;
  const handle = createApprovalHttpHandler({
    database: {} as Database,
    repository: legacyRepository,
    ...(governed ? { governedEffects: governed } : {}),
    contextResolver: { async resolve() { return { userId, workspaceId, role: "admin" as const }; } },
  });
  return { handle, calls };
}

function post(handle: ReturnType<typeof createApprovalHttpHandler>, path: string, body: unknown) {
  return handle(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("governed HTTP approval routing", () => {
  test("routes a governed single decision exclusively through the capability", async () => {
    const { handle, calls } = harness();
    const response = await post(handle, `/api/v1/approval-items/${governedItemId}/actions/approve`, {});

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ proposalId: governedProposalId, status: "queued" });
    expect(calls.legacyDecide).toHaveLength(0);
    expect(calls.governedDecide).toEqual([expect.objectContaining({ approvalItemId: governedItemId, decision: "approve", expectedVersion: 2 })]);
  });

  test("returns a stable approval-required error when governed capability is absent", async () => {
    const { handle, calls } = harness({ governed: null });
    const response = await post(handle, `/api/v1/approval-items/${governedItemId}/actions/approve`, {});

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MCP_EFFECT_APPROVAL_REQUIRED" });
    expect(calls.legacyDecide).toHaveLength(0);
  });

  test("partitions mixed bulk decisions and preserves per-item order", async () => {
    const { handle, calls } = harness();
    const response = await post(handle, "/api/v1/approval-items/actions/bulk-decide", {
      decisions: [
        { itemId: governedItemId, decision: "approve" },
        { itemId: legacyItemId, decision: "approve" },
      ],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: [
        { itemId: governedItemId, status: "queued" },
        { itemId: legacyItemId, status: "approved" },
      ],
    });
    expect(calls.legacyBulk).toEqual([expect.objectContaining({ decisions: [{ itemId: legacyItemId, decision: "approve" }] })]);
    expect(calls.governedDecide).toHaveLength(1);
  });

  test("routes governed rejection with its justification and expected version", async () => {
    const { handle, calls } = harness();
    const response = await post(handle, `/api/v1/approval-items/${governedItemId}/actions/reject`, { justification: "No longer needed" });

    expect(response.status).toBe(200);
    expect(calls.legacyDecide).toHaveLength(0);
    expect(calls.governedDecide).toEqual([expect.objectContaining({
      approvalItemId: governedItemId,
      decision: "reject",
      justification: "No longer needed",
      expectedVersion: 2,
    })]);
  });

  test("maps governed policy and authorization failures without exposing internals", async () => {
    const forbidden = harness({ governedDecisionError: new Error("MCP_EFFECT_DECISION_FORBIDDEN: secret workspace details") });
    const forbiddenResponse = await post(forbidden.handle, `/api/v1/approval-items/${governedItemId}/actions/approve`, {});
    expect(forbiddenResponse.status).toBe(403);
    expect(await forbiddenResponse.json()).toEqual(expect.objectContaining({ code: "MCP_EFFECT_FORBIDDEN", detail: "The approval decision is not permitted" }));

    const stale = harness({ governedDecisionError: new Error("MCP_EFFECT_VERSION_CONFLICT: internal proposal id") });
    const staleResponse = await post(stale.handle, `/api/v1/approval-items/${governedItemId}/actions/approve`, {});
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toEqual(expect.objectContaining({ code: "MCP_EFFECT_STALE_CONFLICT", detail: "The approval decision is stale" }));
  });

  test("does not invoke legacy bulk decision for governed-only batches when capability is absent", async () => {
    const { handle, calls } = harness({ governed: null });
    const response = await post(handle, "/api/v1/approval-items/actions/bulk-decide", {
      itemIds: [governedItemId],
      decision: "approve",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      conflicts: [{ itemId: governedItemId, code: "MCP_EFFECT_APPROVAL_REQUIRED" }],
      results: [{ itemId: governedItemId, code: "MCP_EFFECT_APPROVAL_REQUIRED" }],
    });
    expect(calls.legacyBulk).toHaveLength(0);
    expect(calls.legacyDecide).toHaveLength(0);
  });

  test("rejects duplicate bulk item ids before loading or mutating any item", async () => {
    const { handle, calls } = harness();
    const response = await post(handle, "/api/v1/approval-items/actions/bulk-decide", {
      decisions: [
        { itemId: governedItemId, decision: "approve" },
        { itemId: governedItemId, decision: "reject", justification: "duplicate" },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(calls.legacyGet).toHaveLength(0);
    expect(calls.legacyBulk).toHaveLength(0);
    expect(calls.legacyDecide).toHaveLength(0);
    expect(calls.governedDecide).toHaveLength(0);

    const repeatedIds = harness();
    const repeatedResponse = await post(repeatedIds.handle, "/api/v1/approval-items/actions/bulk-decide", {
      itemIds: [legacyItemId, legacyItemId],
      decision: "approve",
    });
    expect(repeatedResponse.status).toBe(400);
    expect(await repeatedResponse.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(repeatedIds.calls.legacyGet).toHaveLength(0);
    expect(repeatedIds.calls.legacyBulk).toHaveLength(0);
  });

  test("refuses a governed item without an authoritative proposal version", async () => {
    const { handle, calls } = harness();
    const response = await post(handle, `/api/v1/approval-items/${missingVersionItemId}/actions/approve`, {});

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MCP_EFFECT_STALE_CONFLICT" });
    expect(calls.governedDecide).toHaveLength(0);
  });

  test("rejects UUID case collisions before loading either bulk form", async () => {
    const decisionsForm = harness();
    const decisionsResponse = await post(decisionsForm.handle, "/api/v1/approval-items/actions/bulk-decide", {
      decisions: [
        { itemId: caseCollisionItemIdLower, decision: "approve" },
        { itemId: caseCollisionItemIdUpper, decision: "reject", justification: "duplicate" },
      ],
    });
    expect(decisionsResponse.status).toBe(400);
    expect(await decisionsResponse.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(decisionsForm.calls.legacyGet).toHaveLength(0);
    expect(decisionsForm.calls.legacyBulk).toHaveLength(0);
    expect(decisionsForm.calls.governedDecide).toHaveLength(0);

    const itemIdsForm = harness();
    const itemIdsResponse = await post(itemIdsForm.handle, "/api/v1/approval-items/actions/bulk-decide", {
      itemIds: [caseCollisionItemIdLower, caseCollisionItemIdUpper],
      decision: "approve",
    });
    expect(itemIdsResponse.status).toBe(400);
    expect(await itemIdsResponse.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(itemIdsForm.calls.legacyGet).toHaveLength(0);
    expect(itemIdsForm.calls.legacyBulk).toHaveLength(0);
    expect(itemIdsForm.calls.governedDecide).toHaveLength(0);
  });

  test("uses lowercase UUIDs for non-duplicate bulk lookup, dispatch, and attribution", async () => {
    const { handle, calls } = harness();
    const response = await post(handle, "/api/v1/approval-items/actions/bulk-decide", {
      itemIds: [caseCollisionItemIdUpper],
      decision: "approve",
    });

    expect(response.status).toBe(200);
    expect(calls.legacyGet).toEqual([expect.objectContaining({ itemId: caseCollisionItemIdLower })]);
    expect(calls.legacyBulk).toEqual([expect.objectContaining({ decisions: [{ itemId: caseCollisionItemIdLower, decision: "approve" }] })]);
    expect(await response.json()).toMatchObject({
      approved: [caseCollisionItemIdLower],
    });
  });
});
