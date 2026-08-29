import { describe, expect, test } from "bun:test";
import { PostgresMcpExternalEffectAttemptRepository } from "@outbound/infrastructure/mcp/postgres-mcp-effect-attempt-repository";

const ids = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  proposalId: "00000000-0000-4000-8000-000000000002",
  intentionId: "00000000-0000-4000-8000-000000000003",
  aggregateId: "00000000-0000-4000-8000-000000000004",
  correlationId: "00000000-0000-4000-8000-000000000005",
  reconciliationId: "00000000-0000-4000-8000-000000000006",
};

describe("provider-neutral governed-effect attempt boundary", () => {
  test("fails closed when no read-only adapter is composed", async () => {
    const repository = new PostgresMcpExternalEffectAttemptRepository({} as never);
    await expect(repository.reconcileReadOnly({
      ...ids,
      kind: "conversation_reply",
      criteriaSnapshot: { aggregateId: ids.aggregateId, apiKey: "secret" },
    })).resolves.toEqual({ outcome: "error", code: "ADAPTER_UNAVAILABLE" });
  });

  test("only delegates bounded read-only observations and maps adapter throws", async () => {
    const seen: unknown[] = [];
    const repository = new PostgresMcpExternalEffectAttemptRepository({} as never, {
      reconcileReadOnly: async (input) => {
        seen.push(input);
        return { outcome: "matched", authoritative: true, candidateCount: 1, result: { providerId: "redacted-reference", apiKey: "secret" } };
      },
    });
    const result = await repository.reconcileReadOnly({
      ...ids,
      kind: "conversation_reply",
      criteriaSnapshot: { aggregateId: ids.aggregateId, privateKey: "secret" },
    });
    expect(result).toMatchObject({ outcome: "matched", authoritative: true, candidateCount: 1, result: { providerId: "redacted-reference" } });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain("secret");
    const throwing = new PostgresMcpExternalEffectAttemptRepository({} as never, {
      reconcileReadOnly: async () => { throw new Error("provider mutation must never happen"); },
    });
    await expect(throwing.reconcileReadOnly({
      ...ids,
      kind: "conversation_reply",
      criteriaSnapshot: {},
    })).resolves.toEqual({ outcome: "error", code: "ADAPTER_UNAVAILABLE" });
  });

  test("rejects malformed or non-finite read-only criteria before adapter access", async () => {
    let calls = 0;
    const repository = new PostgresMcpExternalEffectAttemptRepository({} as never, {
      reconcileReadOnly: async () => {
        calls += 1;
        return { outcome: "not_found", candidateCount: 0 };
      },
    });
    await expect(repository.reconcileReadOnly({
      ...ids,
      kind: "conversation_reply",
      criteriaSnapshot: { score: Number.NaN },
    })).rejects.toMatchObject({ code: "MCP_RECONCILIATION_SNAPSHOT_NON_FINITE_NUMBER" });
    expect(calls).toBe(0);
  });

  test("rejects a non-finite attempt body before opening a persistence transaction", async () => {
    const repository = new PostgresMcpExternalEffectAttemptRepository({
      transaction: () => { throw new Error("transaction must not be opened"); },
    } as never);
    await expect(repository.recordOutcome({
      ...ids,
      jobId: "00000000-0000-4000-8000-000000000007",
      kind: "conversation_reply",
      leaseToken: "00000000-0000-4000-8000-000000000008",
      leaseExpiresAt: new Date("2026-08-29T12:01:00.000Z"),
      outcome: "unknown",
      result: { candidate: Number.NaN },
    })).rejects.toMatchObject({ code: "MCP_RECONCILIATION_SNAPSHOT_NON_FINITE_NUMBER" });
  });
});
