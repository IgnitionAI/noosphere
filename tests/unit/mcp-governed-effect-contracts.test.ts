import { describe, expect, test } from "bun:test";
import {
  MCP_GOVERNED_EFFECT_KINDS,
  MCP_GOVERNED_EFFECT_TOOL_NAMES,
  mcpGovernedEffectToolArgumentsSchema,
  parseMcpGovernedEffectArguments,
} from "@outbound/interface/mcp/mcp-governed-effect-contracts";
import { MCP_GOVERNED_EFFECT_KINDS as APPLICATION_MCP_GOVERNED_EFFECT_KINDS } from "@outbound/application/mcp/mcp-governed-effects";

const requestKey = crypto.randomUUID();

describe("MCP governed external-effect contracts", () => {
  test("publishes only the four prepare, two status, and one decision tools", () => {
    expect(MCP_GOVERNED_EFFECT_TOOL_NAMES).toEqual([
      "conversation_prepare_reply",
      "content_prepare_publication",
      "meeting_prepare_proposal",
      "campaign_prepare_activation",
      "approval_list",
      "approval_get",
      "approval_decide",
    ]);
    expect(MCP_GOVERNED_EFFECT_TOOL_NAMES).not.toContain("send");
    expect(MCP_GOVERNED_EFFECT_TOOL_NAMES).not.toContain("publish");
    expect(MCP_GOVERNED_EFFECT_TOOL_NAMES).not.toContain("book");
    expect(MCP_GOVERNED_EFFECT_TOOL_NAMES).not.toContain("cancel");
  });

  test("requires UUID request keys and bounded strict intent arguments", () => {
    const conversationId = crypto.randomUUID();
    expect(parseMcpGovernedEffectArguments("conversation_prepare_reply", {
      requestKey,
      conversationId,
      body: "A bounded reply",
    })).toMatchObject({ requestKey, conversationId });
    expect(() => parseMcpGovernedEffectArguments("conversation_prepare_reply", {
      requestKey: "not-a-uuid",
      conversationId,
      body: "reply",
    })).toThrow();
    expect(() => parseMcpGovernedEffectArguments("conversation_prepare_reply", {
      requestKey,
      conversationId,
      body: "x".repeat(10_001),
    })).toThrow();
    expect(() => parseMcpGovernedEffectArguments("content_prepare_publication", {
      requestKey,
      assetId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
    })).toThrow();
  });

  test("keeps meeting selection local and rejects provider selectors", () => {
    const meetingProposalId = crypto.randomUUID();
    expect(parseMcpGovernedEffectArguments("meeting_prepare_proposal", {
      requestKey,
      meetingProposalId,
      slotPosition: 1,
    })).toMatchObject({ meetingProposalId, slotPosition: 1 });
    expect(() => parseMcpGovernedEffectArguments("meeting_prepare_proposal", {
      requestKey,
      meetingProposalId,
      slotPosition: 1,
      slotStart: "2026-09-01T10:00:00Z",
    })).toThrow();
    expect(() => parseMcpGovernedEffectArguments("meeting_prepare_proposal", {
      requestKey,
      meetingProposalId,
      slotPosition: 1,
      providerName: "cal.com",
    })).toThrow();
  });

  test("bounds review list, decision justification, and rejects unknown keys", () => {
    expect(parseMcpGovernedEffectArguments("approval_list", { limit: 25 })).toMatchObject({ limit: 25 });
    expect(() => parseMcpGovernedEffectArguments("approval_list", { limit: 101 })).toThrow();
    expect(parseMcpGovernedEffectArguments("approval_decide", {
      approvalItemId: crypto.randomUUID(),
      decision: "reject",
      justification: "A bounded reason",
    })).toMatchObject({ decision: "reject" });
    expect(() => parseMcpGovernedEffectArguments("approval_decide", {
      approvalItemId: crypto.randomUUID(),
      decision: "reject",
    })).toThrow();
    expect(parseMcpGovernedEffectArguments("approval_decide", {
      approvalItemId: crypto.randomUUID(),
      decision: "approve",
    })).toMatchObject({ decision: "approve" });
    expect(() => parseMcpGovernedEffectArguments("approval_decide", {
      approvalItemId: crypto.randomUUID(),
      decision: "reject",
      justification: "x".repeat(2_001),
    })).toThrow();
    expect(() => parseMcpGovernedEffectArguments("approval_decide", {
      approvalItemId: crypto.randomUUID(),
      decision: "approve",
      token: "secret",
    })).toThrow();
  });

  test("requires exactly one approval_get identifier", () => {
    const proposalId = crypto.randomUUID();
    const approvalItemId = crypto.randomUUID();
    expect(parseMcpGovernedEffectArguments("approval_get", { proposalId })).toMatchObject({ proposalId });
    expect(parseMcpGovernedEffectArguments("approval_get", { approvalItemId })).toMatchObject({ approvalItemId });
    expect(() => parseMcpGovernedEffectArguments("approval_get", {})).toThrow();
    expect(() => parseMcpGovernedEffectArguments("approval_get", { proposalId, approvalItemId })).toThrow();
  });

  test("accepts only the closed kind set", () => {
    expect(MCP_GOVERNED_EFFECT_KINDS).toBe(APPLICATION_MCP_GOVERNED_EFFECT_KINDS);
    expect(Object.keys(mcpGovernedEffectToolArgumentsSchema)).toEqual([...MCP_GOVERNED_EFFECT_TOOL_NAMES]);
    expect(() => parseMcpGovernedEffectArguments("conversation_send" as never, {})).toThrow();
  });
});
