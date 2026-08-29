import { describe, expect, test } from "bun:test";
import {
  RECONCILIATION_MAX_JSON_BYTES,
  prepareMatchedEvidence,
  canonicalJson,
  isUniqueViolationForConstraint,
  mapAttachedProposalStatus,
  mapReconciliationProposalStatus,
  redactReconciliationJson,
} from "@outbound/infrastructure/mcp/postgres-mcp-effect-reconciliation-repository";

describe("MCP effect reconciliation repository contract", () => {
  test("redacts provider secrets and keeps snapshots bounded JSON objects", () => {
    const snapshot = redactReconciliationJson({
      providerPostId: "provider-secret",
      accessToken: "do-not-persist",
      response: { body: "do-not-persist" },
      candidateCount: 1,
    });
    expect(snapshot).toEqual({ candidateCount: 1 });
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBeLessThanOrEqual(RECONCILIATION_MAX_JSON_BYTES);
  });

  test("redacts normalized API/private key variants without dropping safe metadata", () => {
    expect(redactReconciliationJson({
      apiKey: "secret", api_key: "secret", "api-key": "secret", APIKEY: "secret",
      privateKey: "secret", private_key: "secret", "private-key": "secret", PRIVATEKEY: "secret",
      providerName: "safe-provider", providerId: "provider-1", providerType: "oauth", apiKeyLabel: "safe-label", privateKeyId: "key-1",
    })).toEqual({ providerName: "safe-provider", providerId: "provider-1", providerType: "oauth", apiKeyLabel: "safe-label", privateKeyId: "key-1" });
  });

  test("recursively preserves safe objects in arrays and drops emptied evidence", () => {
    expect(redactReconciliationJson({
      matches: [
        { provider: "secret", token: "secret", safeId: "effect-1" },
        { raw: "secret", secret: "secret" },
        { safeId: "effect-2", nested: [{ provider: "secret", observedAt: "2026-08-29" }] },
      ],
      empty: [{ provider: "secret" }],
    })).toEqual({
      matches: [
        { safeId: "effect-1" },
        { safeId: "effect-2", nested: [{ observedAt: "2026-08-29" }] },
      ],
    });
    expect(() => prepareMatchedEvidence({ authoritative: true, candidateCount: 1, result: { matches: [{ provider: "secret" }] } })).toThrow("MCP_RECONCILIATION_MATCH_EVIDENCE_REQUIRED");
  });

  test("maps every durable reconciliation status without implying delivery", () => {
    expect(mapReconciliationProposalStatus(null)).toBe("unknown");
    expect(mapReconciliationProposalStatus("pending")).toBe("reconciling");
    expect(mapReconciliationProposalStatus("searching")).toBe("reconciling");
    expect(mapReconciliationProposalStatus("matched")).toBe("delivered");
    expect(mapReconciliationProposalStatus("not_found")).toBe("failed");
    expect(mapReconciliationProposalStatus("ambiguous")).toBe("reconciling");
    expect(mapReconciliationProposalStatus("error")).toBe("reconciling");
  });

  test("rejects oversized and non-object snapshots", () => {
    expect(() => redactReconciliationJson([])).toThrow("MCP_RECONCILIATION_SNAPSHOT_INVALID");
    expect(() => redactReconciliationJson({ value: "x".repeat(RECONCILIATION_MAX_JSON_BYTES) })).toThrow("MCP_RECONCILIATION_SNAPSHOT_TOO_LARGE");
  });

  test("rejects non-finite numbers before redaction or canonicalization", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => redactReconciliationJson({ value })).toThrow("MCP_RECONCILIATION_SNAPSHOT_NON_FINITE_NUMBER");
      expect(() => canonicalJson({ value })).toThrow("MCP_RECONCILIATION_SNAPSHOT_NON_FINITE_NUMBER");
    }
  });

  test("matches only the targeted postgres.js constraint_name through Drizzle causes", () => {
    const constraint = "mcp_effect_traces_source_event_uq";
    expect(isUniqueViolationForConstraint({ code: "23505", constraint_name: constraint }, constraint)).toBe(true);
    expect(isUniqueViolationForConstraint({ cause: { code: "23505", constraint_name: constraint } }, constraint)).toBe(true);
    expect(isUniqueViolationForConstraint({ code: "23505", constraint_name: "mcp_effect_traces_idempotency_uq" }, constraint)).toBe(false);
    expect(isUniqueViolationForConstraint({ code: "23503", constraint_name: constraint }, constraint)).toBe(false);
  });

  test("requires authoritative unique match with non-empty proof", () => {
    expect(() => prepareMatchedEvidence({ authoritative: false, candidateCount: 1, result: { observedAt: "2026-08-29T12:00:00.000Z" } })).toThrow("MCP_RECONCILIATION_MATCH_NOT_AUTHORITATIVE");
    expect(() => prepareMatchedEvidence({ authoritative: true, candidateCount: 2, result: { observedAt: "2026-08-29T12:00:00.000Z" } })).toThrow("MCP_RECONCILIATION_MATCH_NOT_UNIQUE");
    expect(() => prepareMatchedEvidence({ authoritative: true, candidateCount: 1, result: {} })).toThrow("MCP_RECONCILIATION_MATCH_EVIDENCE_REQUIRED");
    expect(prepareMatchedEvidence({ authoritative: true, candidateCount: 1, result: { observedAt: "2026-08-29T12:00:00.000Z" } })).toEqual({ observedAt: "2026-08-29T12:00:00.000Z" });
  });

  test("normalizes aliases and canonicalizes nested evidence without reordering arrays", () => {
    expect(() => prepareMatchedEvidence({ authoritative: true, candidateCount: 1, candidatesCount: 2, result: { observedAt: "now" } })).toThrow("MCP_RECONCILIATION_CANDIDATE_COUNT_CONFLICT");
    const evidence = prepareMatchedEvidence({ authoritative: true, candidateCount: 1, result: { z: { b: 2, a: 1 }, a: [{ z: 2, a: 1 }, { a: 3 }] } });
    expect(canonicalJson(evidence)).toBe('{"a":[{"a":1,"z":2},{"a":3}],"z":{"a":1,"b":2}}');
  });

  test("attaching a reconciliation preserves terminal proposal states", () => {
    expect(mapAttachedProposalStatus("pending", "accepted")).toBe("reconciling");
    expect(mapAttachedProposalStatus("matched", "unknown")).toBe("delivered");
    expect(mapAttachedProposalStatus("not_found", "unknown")).toBe("failed");
    expect(mapAttachedProposalStatus("ambiguous", "unknown")).toBe("reconciling");
    expect(mapAttachedProposalStatus("error", "delivered")).toBe("delivered");
    expect(mapAttachedProposalStatus("not_found", "failed")).toBe("failed");
  });
});
