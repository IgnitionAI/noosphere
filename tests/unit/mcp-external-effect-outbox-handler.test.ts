import { describe, expect, test } from "bun:test";
import {
  MCP_EXTERNAL_EFFECT_EXECUTION_REQUESTED,
  McpExternalEffectOutboxError,
  parseMcpExternalEffectOutboxEvent,
} from "@outbound/infrastructure/outbox/mcp-external-effect-outbox-handler";
import type { OutboxEventRow } from "@outbound/infrastructure/outbox/postgres-outbox-dispatcher";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const proposalId = "00000000-0000-4000-8000-000000000002";
const intentionId = "00000000-0000-4000-8000-000000000003";
const jobId = "00000000-0000-4000-8000-000000000004";
const correlationId = "00000000-0000-4000-8000-000000000005";
const sourceEventId = "00000000-0000-4000-8000-000000000006";
const aggregateId = "00000000-0000-4000-8000-000000000007";

function governedEvent(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: sourceEventId,
    workspace_id: workspaceId,
    aggregate_type: "mcp_effect_proposal",
    aggregate_id: proposalId,
    event_type: MCP_EXTERNAL_EFFECT_EXECUTION_REQUESTED,
    payload: {
      workspaceId,
      proposalId,
      intentionId,
      jobId,
      correlationId,
      sourceEventId,
      idempotencyKey: "mcp-effect:proposal:execute:v1",
      kind: "conversation_reply",
      aggregateId,
    },
    ...overrides,
  };
}

describe("MCP governed outbox envelope", () => {
  test("accepts the bounded tenant tuple and requires envelope id=sourceEventId", () => {
    expect(parseMcpExternalEffectOutboxEvent(governedEvent())).toMatchObject({
      workspaceId,
      proposalId,
      intentionId,
      jobId,
      sourceEventId,
      aggregateId,
    });
    expect(() => parseMcpExternalEffectOutboxEvent(governedEvent({
      id: "00000000-0000-4000-8000-000000000008",
    }))).toThrow("MCP_EFFECT_OUTBOX_PAYLOAD_INVALID");
    const withoutWorkspace = Object.fromEntries(Object.entries(governedEvent().payload as Record<string, unknown>).filter(([key]) => key !== "workspaceId"));
    expect(parseMcpExternalEffectOutboxEvent(governedEvent({ payload: withoutWorkspace }))).toMatchObject({ workspaceId });
  });

  test("rejects foreign tenant and payload expansion before dispatch", () => {
    expect(() => parseMcpExternalEffectOutboxEvent(governedEvent({
      workspace_id: "00000000-0000-4000-8000-000000000009",
    }))).toThrow("MCP_EFFECT_OUTBOX_WORKSPACE_CONFLICT");
    expect(() => parseMcpExternalEffectOutboxEvent(governedEvent({
      payload: { ...(governedEvent().payload as object), provider: "must-not-cross-boundary" },
    }))).toThrow("MCP_EFFECT_OUTBOX_PAYLOAD_INVALID");
  });

  test("ignores non-governed events so the generic audit path remains compatible", () => {
    expect(parseMcpExternalEffectOutboxEvent(governedEvent({ event_type: "ICPVersionPublished" }))).toBeNull();
  });

  test("exposes a stable error code for malformed governed envelopes", () => {
    try {
      parseMcpExternalEffectOutboxEvent(governedEvent({ payload: null }));
      throw new Error("expected parser failure");
    } catch (error) {
      expect(error).toBeInstanceOf(McpExternalEffectOutboxError);
      expect((error as McpExternalEffectOutboxError).code).toBe("MCP_EFFECT_OUTBOX_PAYLOAD_INVALID");
    }
  });
});
