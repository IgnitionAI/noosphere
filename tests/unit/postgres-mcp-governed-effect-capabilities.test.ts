import { describe, expect, test } from "bun:test";
import type { ExternalEffectFacts } from "@outbound/application/mcp/external-effect-policy";
import type { ExternalEffectPolicy, McpExecutionContext, McpPrepareCommand } from "@outbound/application/mcp/mcp-governed-effects";
import {
  PostgresMcpGovernedEffectCapabilities,
} from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-capabilities";

const context: McpExecutionContext = {
  userId: "user-1",
  workspaceId: "workspace-1",
  clientId: "client-1",
  role: "reviewer",
  scopes: ["mcp:read", "mcp:write", "mcp:approve"],
  audience: "https://example.test/mcp",
};

const policy: ExternalEffectPolicy = {
  preview: async () => ({ decision: "allow", code: "OK", factsVersion: 1 }),
  final: async () => ({ decision: "allow", code: "OK", factsVersion: 1 }),
};

function facts(kind: ExternalEffectFacts["kind"], aggregateId: string, extra: Record<string, unknown> = {}): ExternalEffectFacts {
  const common = {
    kind,
    aggregateId,
    revision: 3,
    sourceVersion: 7,
    factsVersion: 7,
    sourceId: `${kind}:${aggregateId}`,
    sourceUpdatedAt: "2026-08-29T09:00:00.000Z",
    status: kind === "meeting_proposal" ? "offered" : "ready",
    adapterAvailable: true,
    accountHealthy: true,
    quotaAvailable: true,
    evaluatedAt: "2026-08-29T12:00:00.000Z",
    ...extra,
  };
  return common as ExternalEffectFacts;
}

function command(kind: McpPrepareCommand["kind"]): McpPrepareCommand {
  switch (kind) {
    case "conversation_reply": return { kind, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), conversationId: "conversation-1", body: "Reply" };
    case "content_publication": return { kind, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), assetId: "asset-1", assetVersionId: "asset-version-1", scheduledFor: "2026-09-01T10:00:00.000Z" };
    case "meeting_proposal": return { kind, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), meetingProposalId: "meeting-1", slotPosition: 2 };
    case "campaign_activation": return { kind, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), campaignId: "campaign-1" };
  }
}

function proposal(workspaceId = context.workspaceId) {
  return {
    proposalId: crypto.randomUUID(), workspaceId, kind: "conversation_reply" as const, status: "approval_required" as const,
    approvalItemId: crypto.randomUUID(), correlationId: crypto.randomUUID(), version: 1, revision: 3, sourceVersion: 7,
    createdAt: "2026-08-29T12:00:00.000Z", updatedAt: "2026-08-29T12:00:00.000Z",
  };
}

function harness(readPrepare: (input: { readonly context: McpExecutionContext; readonly kind: string; readonly aggregateId: string; readonly intentSnapshot: unknown }) => Promise<ExternalEffectFacts | null>) {
  const created: unknown[] = [];
  const decisions: unknown[] = [];
  const repository = {
    createProposal: async (input: unknown) => { created.push(input); return proposal(); },
    listStatus: async () => [],
    getStatus: async () => null,
    decideAndQueue: async (input: unknown) => { decisions.push(input); return { ...proposal(), status: "queued" as const, policyCode: "OK", operationId: null, jobId: null, reconciliationId: null, approvalDecision: "approve" as const, intent: null, redacted: true }; },
  } as never;
  const reader = { readPrepare } as never;
  const capabilities = new PostgresMcpGovernedEffectCapabilities(repository, reader, policy);
  return { capabilities, created, decisions };
}

describe("Postgres governed-effect capabilities", () => {
  test("prepares authoritative conversation/content/meeting snapshots without execution artifacts", async () => {
    const seen: Array<{ readonly workspaceId: string; readonly kind: string; readonly aggregateId: string }> = [];
    const { capabilities, created } = harness(async (input) => {
      seen.push({ workspaceId: input.context.workspaceId, kind: input.kind, aggregateId: input.aggregateId });
      if (input.kind === "content_publication") return facts("content_publication", "asset-1", { publicationId: "publication-1", assetId: "asset-1", assetVersionId: "asset-version-1", contentVersion: 1, policyVersion: "editorial-v1", assetReady: true, assetStatus: "ready", strategyActive: true, strategyDeleted: false, strategyVersion: 1 });
      if (input.kind === "meeting_proposal") return facts("meeting_proposal", "meeting-1", { slotPosition: 2, slotStart: "2026-09-01T10:00:00.000Z", slotEnd: "2026-09-01T10:30:00.000Z", timeZone: "UTC", expiresAt: "2026-09-02T00:00:00.000Z" });
      return facts(input.kind as "conversation_reply", input.aggregateId, { suppressed: false, humanReplyAt: null });
    });

    for (const kind of ["conversation_reply", "content_publication", "meeting_proposal"] as const) {
      await capabilities.prepare(context, command(kind));
    }

    expect(seen).toEqual([
      { workspaceId: "workspace-1", kind: "conversation_reply", aggregateId: "conversation-1" },
      { workspaceId: "workspace-1", kind: "content_publication", aggregateId: "asset-1" },
      { workspaceId: "workspace-1", kind: "meeting_proposal", aggregateId: "meeting-1" },
    ]);
    expect(created).toHaveLength(3);
    expect(created.every((entry) => !(entry as Record<string, unknown>).jobId && !(entry as Record<string, unknown>).outbox)).toBe(true);
    expect((created[1] as Record<string, unknown>).aggregateId).toBe("publication-1");
    expect((created[2] as Record<string, unknown>).sourceSnapshot).toMatchObject({ slotPosition: 2, slotStart: "2026-09-01T10:00:00.000Z", slotEnd: "2026-09-01T10:30:00.000Z", timeZone: "UTC" });
  });

  test("freezes campaign preparation and missing/expired meetings before proposal persistence", async () => {
    const { capabilities, created } = harness(async (input) => input.kind === "campaign_activation"
      ? facts("campaign_activation", "campaign-1", { adapterAvailable: false, automationStage: "ready", policyVersion: "campaign-v1", enrollmentFingerprint: "a".repeat(64), scheduleWindow: { start: "2026-09-01T09:00:00.000Z", end: "2026-09-01T17:00:00.000Z", timeZone: "UTC" }, accountHealth: { status: "healthy", checkedAt: "2026-08-29T12:00:00.000Z" } })
      : null);

    await expect(capabilities.prepare(context, command("campaign_activation"))).rejects.toThrow("MCP_EFFECT_ADAPTER_UNAVAILABLE");
    await expect(capabilities.prepare(context, command("meeting_proposal"))).rejects.toThrow("MCP_EFFECT_ADAPTER_UNAVAILABLE");
    expect(created).toHaveLength(0);
  });

  test("keeps list/status workspace scoped and delegates decide once with the fresh policy", async () => {
    const { capabilities, decisions } = harness(async () => null);
    const listed = await capabilities.list(context, { limit: 10 });
    const status = await capabilities.status(context, { approvalItemId: crypto.randomUUID() });
    expect(listed).toEqual([]);
    expect(status).toBeNull();

    await capabilities.decide(context, { approvalItemId: crypto.randomUUID(), decision: "approve" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ context, decision: "approve", policy });
  });
});
