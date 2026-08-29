import type { SqlClient } from "@outbound/infrastructure/database/client";
import {
  type OutboxEventRow,
  writeOutboxEventAudit,
} from "@outbound/infrastructure/outbox/postgres-outbox-dispatcher";

export const MCP_EXTERNAL_EFFECT_EXECUTION_REQUESTED = "McpExternalEffectExecutionRequested";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(["conversation_reply", "content_publication", "meeting_proposal", "campaign_activation"]);
const PAYLOAD_KEYS = ["aggregateId", "correlationId", "idempotencyKey", "intentionId", "jobId", "kind", "proposalId", "sourceEventId"];

export class McpExternalEffectOutboxError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "McpExternalEffectOutboxError";
  }
}

export interface McpExternalEffectOutboxPayload {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly intentionId: string;
  readonly jobId: string;
  readonly correlationId: string;
  readonly sourceEventId: string;
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly aggregateId: string;
}

/** Validate the governed envelope without looking up or creating another job. */
export function parseMcpExternalEffectOutboxEvent(event: OutboxEventRow): McpExternalEffectOutboxPayload | null {
  if (event.event_type !== MCP_EXTERNAL_EFFECT_EXECUTION_REQUESTED) return null;
  if (event.aggregate_type !== "mcp_effect_proposal" || !UUID.test(event.id) || !UUID.test(event.workspace_id) || !UUID.test(event.aggregate_id)) {
    throw new McpExternalEffectOutboxError("MCP_EFFECT_OUTBOX_PAYLOAD_INVALID");
  }
  if (!isRecord(event.payload)) throw new McpExternalEffectOutboxError("MCP_EFFECT_OUTBOX_PAYLOAD_INVALID");
  const keys = Object.keys(event.payload).sort();
  const hasWorkspaceId = keys.includes("workspaceId");
  if ((keys.length !== PAYLOAD_KEYS.length && keys.length !== PAYLOAD_KEYS.length + 1)
    || keys.filter((key) => key !== "workspaceId").some((key, index) => key !== PAYLOAD_KEYS[index])
    || (hasWorkspaceId && keys[keys.length - 1] !== "workspaceId")) {
    throw new McpExternalEffectOutboxError("MCP_EFFECT_OUTBOX_PAYLOAD_INVALID");
  }
  const payload = event.payload as Record<string, unknown>;
  const uuidKeys = ["proposalId", "intentionId", "jobId", "correlationId", "sourceEventId", "aggregateId"];
  if (uuidKeys.some((key) => typeof payload[key] !== "string" || !UUID.test(payload[key] as string))
    || (hasWorkspaceId && (typeof payload.workspaceId !== "string" || !UUID.test(payload.workspaceId as string)))
    || typeof payload.idempotencyKey !== "string" || payload.idempotencyKey.length < 1 || payload.idempotencyKey.length > 500
    || typeof payload.kind !== "string" || !KINDS.has(payload.kind)
    || (hasWorkspaceId && payload.workspaceId !== event.workspace_id)
    || payload.proposalId !== event.aggregate_id || payload.sourceEventId !== event.id) {
    throw new McpExternalEffectOutboxError(hasWorkspaceId && payload.workspaceId !== event.workspace_id ? "MCP_EFFECT_OUTBOX_WORKSPACE_CONFLICT" : "MCP_EFFECT_OUTBOX_PAYLOAD_INVALID");
  }
  return { ...payload, workspaceId: event.workspace_id } as unknown as McpExternalEffectOutboxPayload;
}

/** Handles all outbox events, adding a strict governed-event gate before audit. */
export class McpExternalEffectOutboxHandler {
  constructor(private readonly sql: SqlClient) {}

  async handle(event: OutboxEventRow): Promise<void> {
    const payload = parseMcpExternalEffectOutboxEvent(event);
    if (payload) await this.assertExistingTuple(payload);
    await writeOutboxEventAudit(this.sql, event);
  }

  /**
   * The outbox is a notification of durable work, not a work-creation API.
   * Require every reference to resolve to the same tenant-owned proposal,
   * intention, and existing job before acknowledging the envelope.
   */
  private async assertExistingTuple(payload: McpExternalEffectOutboxPayload): Promise<void> {
    const rows = await this.sql<{
      proposal_workspace_id: string;
      proposal_id: string;
      proposal_kind: string;
      proposal_aggregate_id: string;
      proposal_correlation_id: string;
      proposal_job_id: string | null;
      intention_workspace_id: string;
      intention_id: string;
      intention_proposal_id: string;
      intention_kind: string;
      intention_aggregate_id: string;
      intention_job_id: string;
      intention_idempotency_key: string;
      intention_correlation_id: string;
      job_workspace_id: string;
      job_id: string;
      job_type: string;
      job_idempotency_key: string;
      job_correlation_id: string;
    }[]>`
      select
        p.workspace_id as proposal_workspace_id,
        p.id as proposal_id,
        p.kind as proposal_kind,
        p.aggregate_id as proposal_aggregate_id,
        p.correlation_id as proposal_correlation_id,
        p.job_id as proposal_job_id,
        i.workspace_id as intention_workspace_id,
        i.id as intention_id,
        i.proposal_id as intention_proposal_id,
        i.kind as intention_kind,
        i.aggregate_id as intention_aggregate_id,
        i.job_id as intention_job_id,
        i.idempotency_key as intention_idempotency_key,
        i.correlation_id as intention_correlation_id,
        j.workspace_id as job_workspace_id,
        j.id as job_id,
        j.type as job_type,
        j.idempotency_key as job_idempotency_key,
        j.correlation_id as job_correlation_id
      from mcp_effect_proposals p
      join mcp_effect_intentions i
        on i.workspace_id = p.workspace_id and i.proposal_id = p.id
      join jobs j
        on j.workspace_id = i.workspace_id and j.id = i.job_id
      where p.workspace_id = ${payload.workspaceId}
        and p.id = ${payload.proposalId}
        and i.id = ${payload.intentionId}
        and j.id = ${payload.jobId}
      limit 1
    `;
    const tuple = rows[0];
    if (!tuple
      || tuple.proposal_workspace_id !== payload.workspaceId
      || tuple.proposal_id !== payload.proposalId
      || tuple.proposal_kind !== payload.kind
      || tuple.proposal_aggregate_id !== payload.aggregateId
      || tuple.proposal_correlation_id !== payload.correlationId
      || tuple.proposal_job_id !== payload.jobId
      || tuple.intention_workspace_id !== payload.workspaceId
      || tuple.intention_id !== payload.intentionId
      || tuple.intention_proposal_id !== payload.proposalId
      || tuple.intention_kind !== payload.kind
      || tuple.intention_aggregate_id !== payload.aggregateId
      || tuple.intention_job_id !== payload.jobId
      || tuple.intention_idempotency_key !== payload.idempotencyKey
      || tuple.intention_correlation_id !== payload.correlationId
      || tuple.job_workspace_id !== payload.workspaceId
      || tuple.job_id !== payload.jobId
      || tuple.job_type !== "mcp.external-effect.execute"
      || tuple.job_idempotency_key !== payload.idempotencyKey
      || tuple.job_correlation_id !== payload.correlationId) {
      throw new McpExternalEffectOutboxError("MCP_EFFECT_OUTBOX_TUPLE_INVALID");
    }
  }
}

/** Composed dispatcher entry point for the exact governed event type. */
export async function dispatchMcpExternalEffectExecutionRequested(
  sql: SqlClient,
  event: OutboxEventRow,
): Promise<void> {
  await new McpExternalEffectOutboxHandler(sql).handle(event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
