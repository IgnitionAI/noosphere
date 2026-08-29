import { describe, expect, test } from "bun:test";
import type { ExternalEffectPolicy, McpEffectProposal } from "@outbound/application/mcp/mcp-governed-effects";
import {
  evaluateMcpEffectFinalGate,
  mcpEffectWorkerContext,
  PostgresMcpGovernedEffectWorker,
  parseMcpExternalEffectJobPayload,
} from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-worker";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const proposalId = "00000000-0000-4000-8000-000000000002";
const aggregateId = "00000000-0000-4000-8000-000000000003";
const intentionId = "00000000-0000-4000-8000-000000000004";
const jobId = "00000000-0000-4000-8000-000000000005";

const proposal = {
  proposalId,
  workspaceId,
  kind: "conversation_reply" as const,
  status: "queued" as const,
  approvalItemId: "00000000-0000-4000-8000-000000000006",
  correlationId: "00000000-0000-4000-8000-000000000007",
  version: 2,
  revision: 1,
  sourceVersion: 1,
  createdAt: "2026-08-29T12:00:00.000Z",
  updatedAt: "2026-08-29T12:00:00.000Z",
  aggregateId,
  intentSnapshot: { kind: "conversation_reply", aggregateId, body: "bounded" },
  sourceSnapshot: {
    kind: "conversation_reply", aggregateId, status: "open", sourceId: "conversation:test",
    sourceUpdatedAt: "2026-08-29T11:00:00.000Z", factsVersion: 1, revision: 1, sourceVersion: 1,
    suppressed: false, humanReplyAt: null,
  },
} satisfies McpEffectProposal & { aggregateId: string; intentSnapshot: Record<string, unknown>; sourceSnapshot: Record<string, unknown> };

describe("MCP governed-effect worker final gate", () => {
  test("parses a tenant-bound execution payload and rejects foreign workspace ids", () => {
    expect(parseMcpExternalEffectJobPayload({
      workspaceId, proposalId, intentionId, kind: "conversation_reply", aggregateId,
      correlationId: proposal.correlationId,
    }, workspaceId)).toEqual({
      workspaceId, proposalId, intentionId, kind: "conversation_reply", aggregateId,
      correlationId: proposal.correlationId,
    });
    expect(() => parseMcpExternalEffectJobPayload({
      workspaceId: "00000000-0000-4000-8000-000000000099", proposalId, intentionId,
      kind: "conversation_reply", aggregateId, correlationId: proposal.correlationId,
    }, workspaceId)).toThrow("MCP_EFFECT_JOB_WORKSPACE_CONFLICT");
    expect(() => parseMcpExternalEffectJobPayload({ workspaceId, proposalId, intentionId, kind: "provider_send", aggregateId, correlationId: proposal.correlationId }, workspaceId)).toThrow("MCP_EFFECT_JOB_PAYLOAD_INVALID");
  });

  test("runs only the provider-free final policy gate with an internal tenant context", async () => {
    const seen: unknown[] = [];
    const policy: ExternalEffectPolicy = {
      preview: async () => ({ decision: "allow", code: "OK", factsVersion: 1 }),
      final: async (input) => {
        seen.push(input);
        return { decision: "allow", code: "OK", factsVersion: 1 };
      },
    };

    const result = await evaluateMcpEffectFinalGate(policy, proposal, mcpEffectWorkerContext(workspaceId));

    expect(result).toEqual({ decision: "allow", code: "OK", factsVersion: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      phase: "final",
      context: {
        workspaceId,
        role: "owner",
        scopes: ["mcp:read", "mcp:write", "mcp:approve"],
      },
    });
  });

  test("preserves a stable denied final policy result without any provider surface", async () => {
    const policy: ExternalEffectPolicy = {
      preview: async () => ({ decision: "allow", code: "OK", factsVersion: 1 }),
      final: async () => ({ decision: "deny", code: "CONTACT_SUPPRESSED", factsVersion: 2 }),
    };
    await expect(evaluateMcpEffectFinalGate(policy, proposal, mcpEffectWorkerContext(workspaceId))).resolves.toEqual({
      decision: "deny", code: "CONTACT_SUPPRESSED", factsVersion: 2,
    });
  });

  test("fails closed for policy throws and malformed/non-finite final results", async () => {
    const throwingPolicy: Pick<ExternalEffectPolicy, "final"> = {
      final: async () => { throw new Error("provider must not be reached"); },
    };
    await expect(evaluateMcpEffectFinalGate(throwingPolicy, proposal, mcpEffectWorkerContext(workspaceId))).resolves.toEqual({
      decision: "deny", code: "ADAPTER_UNAVAILABLE", factsVersion: 0,
    });
    const malformedPolicy: Pick<ExternalEffectPolicy, "final"> = {
      final: async () => ({ decision: "allow", code: "OK", factsVersion: Number.NaN }),
    };
    await expect(evaluateMcpEffectFinalGate(malformedPolicy, proposal, mcpEffectWorkerContext(workspaceId))).resolves.toEqual({
      decision: "deny", code: "ADAPTER_UNAVAILABLE", factsVersion: 0,
    });
  });

  test("never acknowledges malformed or foreign lease envelopes", async () => {
    let acknowledgements = 0;
    const worker = new PostgresMcpGovernedEffectWorker({} as never, { final: async () => ({ decision: "allow", code: "OK", factsVersion: 1 }) }, {
      queue: { acknowledge: async () => { acknowledgements += 1; } },
    });
    const validLease = {
      id: "00000000-0000-4000-8000-000000000008", type: "mcp.external-effect.execute", status: "running",
      workspaceId, payload: { workspaceId: "foreign", proposalId, intentionId, kind: "conversation_reply", aggregateId, correlationId: proposal.correlationId },
      lockedUntil: new Date(Date.now() + 60_000), lockedBy: "worker-a",
    };
    await expect(worker.process(validLease)).rejects.toThrow("MCP_EFFECT_JOB_LEASE_INVALID");
    await expect(worker.process({} as never)).rejects.toThrow("MCP_EFFECT_JOB_LEASE_INVALID");
    expect(acknowledgements).toBe(0);
  });

  test("preserves each provider-free stale/policy outcome from fresh facts", async () => {
    const codes = [
      "CONTACT_SUPPRESSED", "HUMAN_REPLY_ARRIVED", "SOURCE_STALE", "CAMPAIGN_NOT_ACTIVE", "EFFECT_CANCELLED", "ADAPTER_UNAVAILABLE", "OK",
    ] as const;
    for (const code of codes) {
      const result = await evaluateMcpEffectFinalGate({ final: async () => ({ decision: code === "OK" ? "allow" : "deny", code, factsVersion: 2 }) }, proposal, mcpEffectWorkerContext(workspaceId));
      expect(result).toEqual({ decision: code === "OK" ? "allow" : "deny", code, factsVersion: 2 });
    }
  });
});
