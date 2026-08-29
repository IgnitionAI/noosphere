import { describe, expect, test } from "bun:test";
import {
  MCP_EFFECT_TERMINAL_STATUSES,
  mapMcpReconciliationToProposalStatus,
  transitionMcpGovernedEffect,
  type McpReconciliationStatus,
  type McpGovernedEffectStatus,
} from "@outbound/application/mcp/mcp-governed-effects";
import { canonicalJson } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-repository";

describe("MCP governed external-effect state machine", () => {
  test("defines exactly the terminal proposal states", () => {
    expect(MCP_EFFECT_TERMINAL_STATUSES).toEqual([
      "policy_denied",
      "delivered",
      "failed",
      "rejected",
      "invalidated",
    ]);
    expect(MCP_EFFECT_TERMINAL_STATUSES).not.toContain("accepted");
    expect(MCP_EFFECT_TERMINAL_STATUSES).not.toContain("unknown");
  });

  test("queues approved proposals but never adds a job while approval is required", () => {
    expect(transitionMcpGovernedEffect("approval_required", { type: "approve" })).toBe("queued");
    expect(transitionMcpGovernedEffect("approval_required", { type: "reject" })).toBe("rejected");
    expect(transitionMcpGovernedEffect("approval_required", { type: "policy_deny" })).toBe("policy_denied");
    expect(transitionMcpGovernedEffect("approval_required", { type: "accepted" })).toBeNull();
  });

  test("requires unknown before reconciliation and authoritative evidence before delivered", () => {
    expect(transitionMcpGovernedEffect("accepted", { type: "unknown" })).toBe("unknown");
    expect(transitionMcpGovernedEffect("queued", { type: "unknown" })).toBe("unknown");
    expect(transitionMcpGovernedEffect("unknown", { type: "reconcile", status: "pending" })).toBe("reconciling");
    expect(transitionMcpGovernedEffect("unknown", { type: "reconcile", status: "matched" })).toBe("delivered");
  });

  test("maps every reconciliation outcome unambiguously", () => {
    const expected: Record<string, McpGovernedEffectStatus> = {
      pending: "reconciling",
      searching: "reconciling",
      matched: "delivered",
      not_found: "failed",
      ambiguous: "reconciling",
      error: "reconciling",
    };
    for (const [status, proposalStatus] of Object.entries(expected)) {
      expect(mapMcpReconciliationToProposalStatus(status as McpReconciliationStatus)).toBe(proposalStatus);
    }
    expect(mapMcpReconciliationToProposalStatus(null)).toBe("unknown");
  });

  test("keeps terminal states terminal", () => {
    for (const status of MCP_EFFECT_TERMINAL_STATUSES) {
      expect(transitionMcpGovernedEffect(status, { type: "approve" })).toBeNull();
      expect(transitionMcpGovernedEffect(status, { type: "reconcile", status: "matched" })).toBeNull();
    }
  });

  test("canonicalizes nested objects while rejecting non-finite numbers", () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: { z: true, b: null } }))
      .toBe('{"a":{"b":null,"z":true},"z":[{"a":1,"b":2}]}');
    expect(() => canonicalJson({ nested: { value: Number.NaN } })).toThrow("MCP_EFFECT_JSON_NON_FINITE_NUMBER");
    expect(() => canonicalJson({ nested: [Number.POSITIVE_INFINITY] })).toThrow("MCP_EFFECT_JSON_NON_FINITE_NUMBER");
  });
});
