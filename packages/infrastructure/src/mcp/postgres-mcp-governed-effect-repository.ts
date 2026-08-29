import { and, eq, max, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type {
  McpEffectProposal,
  McpEffectTraceStage,
  McpGovernedEffectKind,
} from "@outbound/application/mcp/mcp-governed-effects";
import type { Database, DatabaseExecutor } from "@outbound/infrastructure/database/client";
import {
  approvalItems,
  mcpEffectProposals,
  mcpEffectTraces,
} from "@outbound/infrastructure/database/schema";

const TRACE_STAGES = new Set<McpEffectTraceStage>([
  "proposal",
  "approval",
  "policy",
  "outbox",
  "attempt",
  "result",
]);

const MAX_SNAPSHOT_BYTES = 32_768;
const REVIEWER_FIELDS: Readonly<Record<McpGovernedEffectKind, readonly string[]>> = {
  conversation_reply: ["body", "subject"],
  content_publication: ["body", "subject", "assetId", "publicationId"],
  meeting_proposal: ["slotStart", "slotEnd", "timeZone"],
  campaign_activation: ["body", "subject"],
};
const SOURCE_FIELDS: Readonly<Record<McpGovernedEffectKind, readonly string[]>> = {
  conversation_reply: ["status", "sourceId", "sourceUpdatedAt", "factsVersion", "suppressed", "suppressionStatus", "humanReply", "humanReplyAt"],
  content_publication: ["status", "sourceId", "sourceUpdatedAt", "factsVersion", "assetVersionId", "contentVersion", "policyVersion", "scheduledFor", "assetId", "publicationId", "assetReady", "assetStatus", "strategyActive", "strategyDeleted", "strategyVersionId", "strategyVersion"],
  meeting_proposal: ["status", "sourceId", "sourceUpdatedAt", "factsVersion", "slotPosition", "slotStart", "slotEnd", "timeZone", "expiresAt"],
  campaign_activation: ["status", "sourceId", "sourceUpdatedAt", "factsVersion", "policyVersion", "automationStage", "scheduleWindow", "accountHealth", "enrollmentFingerprint"],
};
const REQUIRED_SOURCE_FIELDS: Readonly<Record<McpGovernedEffectKind, readonly string[]>> = {
  conversation_reply: ["status", "sourceId", "sourceUpdatedAt", "factsVersion", "suppressed"],
  content_publication: ["status", "sourceId", "sourceUpdatedAt", "factsVersion", "assetId", "publicationId", "assetVersionId", "contentVersion", "policyVersion", "assetReady", "assetStatus", "strategyActive", "strategyDeleted", "strategyVersion"],
  meeting_proposal: ["status", "sourceId", "sourceUpdatedAt", "factsVersion", "slotPosition", "slotStart", "slotEnd", "timeZone", "expiresAt"],
  campaign_activation: ["status", "sourceId", "sourceUpdatedAt", "factsVersion", "policyVersion", "automationStage", "scheduleWindow", "accountHealth", "enrollmentFingerprint"],
};
const TRACE_FIELDS = new Set([
  "kind", "aggregateId", "revision", "sourceVersion", "approvalItemId", "decision", "code", "status", "state",
  "operationId", "jobId", "intentionId", "reconciliationId", "attempt", "resultCode",
]);

export class McpGovernedEffectRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "McpGovernedEffectRepositoryError";
  }
}

export interface McpEffectProposalRecord extends McpEffectProposal {
  readonly clientId: string;
  readonly requestKey: string;
  readonly inputHash: string;
  readonly aggregateId: string;
  readonly intentSnapshot: Record<string, unknown>;
  readonly sourceSnapshot: Record<string, unknown>;
}

export interface McpEffectApprovalRecord {
  readonly proposalId: string;
  readonly workspaceId: string;
  readonly approvalItemId: string;
  readonly correlationId: string;
}

export interface McpEffectTraceRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly stage: McpEffectTraceStage;
  readonly sequence: number;
  readonly sourceEventId: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly redactedPayload: Record<string, unknown>;
  readonly actor: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export type CreateProposalInput = ({
  readonly workspaceId: string;
  readonly clientId: string;
  readonly context?: never;
} | {
  readonly context: { readonly workspaceId: string; readonly clientId: string };
  readonly workspaceId?: never;
  readonly clientId?: never;
}) & {
  readonly kind: McpGovernedEffectKind;
  readonly requestKey: string;
  readonly inputHash: string;
  readonly aggregateId: string;
  readonly intentSnapshot: unknown;
  readonly sourceSnapshot: unknown;
  readonly revision?: number;
  readonly sourceVersion?: number;
  readonly factsVersion?: number;
  readonly correlationId?: string;
  readonly createdAt?: Date;
}

export interface CreateApprovalInput {
  readonly workspaceId?: string;
  readonly context?: { readonly workspaceId: string };
  readonly proposalId: string;
  readonly actor?: string;
  readonly createdAt?: Date;
}

export interface AppendTraceInput {
  readonly workspaceId?: string;
  readonly context?: { readonly workspaceId: string };
  readonly proposalId: string;
  readonly stage: McpEffectTraceStage;
  readonly sourceEventId: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly redactedPayload?: unknown;
  readonly actor?: string;
  readonly correlationId?: string;
  readonly createdAt?: Date;
}

/**
 * Persistence-only boundary for governed external-effect proposals.
 * It deliberately has no provider, job, outbox, or execution dependencies.
 */
export class PostgresMcpGovernedEffectRepository {
  constructor(private readonly database: Database, private readonly now: () => Date = () => new Date()) {}

  async createProposal(input: CreateProposalInput): Promise<McpEffectProposalRecord> {
    const workspaceId = input.workspaceId ?? input.context.workspaceId;
    const clientId = input.clientId ?? input.context.clientId;
    const revision = input.revision ?? 1;
    const sourceVersion = input.sourceVersion ?? 1;
    const factsVersion = input.factsVersion ?? 1;
    assertPositiveVersion(factsVersion, "MCP_EFFECT_FACTS_VERSION_INVALID");
    const intentSnapshot = redactedSnapshot(projectReviewerIntent(input.kind, input.aggregateId, input.intentSnapshot, revision, sourceVersion), "MCP_EFFECT_INTENT_SNAPSHOT");
    const sourceSnapshot = projectSourceSnapshot(input.kind, input.aggregateId, input.sourceSnapshot, revision, sourceVersion, factsVersion);
    assertCanonicalHash(input.inputHash);
    if (input.inputHash !== deriveMcpEffectInputHash({ ...input, revision, sourceVersion, factsVersion })) {
      throw new McpGovernedEffectRepositoryError("MCP_EFFECT_INPUT_HASH_MISMATCH");
    }
    const createdAt = input.createdAt ?? this.now();
    const correlationId = input.correlationId ?? crypto.randomUUID();

    return this.database.transaction(async (tx) => {
      await advisoryLock(tx, `${workspaceId}:proposal:${clientId}:${input.kind}:${input.requestKey}`);
      await assertPgJsonbByteBound(tx, intentSnapshot, "MCP_EFFECT_INTENT_SNAPSHOT");
      await assertPgJsonbByteBound(tx, sourceSnapshot, "MCP_EFFECT_SOURCE_SNAPSHOT");
      const replay = await tx.select().from(mcpEffectProposals).where(and(
        eq(mcpEffectProposals.workspaceId, workspaceId),
        eq(mcpEffectProposals.clientId, clientId),
        eq(mcpEffectProposals.kind, input.kind),
        eq(mcpEffectProposals.requestKey, input.requestKey),
      )).limit(1);
      if (replay[0]) {
        if (replay[0].inputHash !== input.inputHash) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_IDEMPOTENCY_CONFLICT");
        return toProposalRecord(replay[0]);
      }

      const proposalId = crypto.randomUUID();
      const [row] = await tx.insert(mcpEffectProposals).values({
        id: proposalId,
        workspaceId,
        clientId,
        kind: input.kind,
        requestKey: input.requestKey,
        inputHash: input.inputHash,
        aggregateId: input.aggregateId,
        intentSnapshot,
        sourceSnapshot,
        revision,
        sourceVersion,
        status: "approval_required",
        version: 1,
        correlationId,
        createdAt,
        updatedAt: createdAt,
      }).returning();
      const approvalItemId = crypto.randomUUID();
      const approvalContext = {
        proposalId,
        kind: input.kind,
        aggregateId: input.aggregateId,
        correlationId,
        revision,
        sourceVersion,
      };
      await tx.insert(approvalItems).values({
        id: approvalItemId,
        workspaceId,
        proposalId,
        itemType: "mcp_external_effect",
        channel: "mcp",
        contentOriginal: intentSnapshot,
        contentEdited: null,
        context: approvalContext,
        sourceUpdatedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
      await tx.update(mcpEffectProposals).set({ approvalItemId, updatedAt: createdAt }).where(and(
        eq(mcpEffectProposals.workspaceId, workspaceId),
        eq(mcpEffectProposals.id, proposalId),
      ));
      await insertTrace(tx, {
        workspaceId,
        proposalId,
        stage: "proposal",
        sequence: 1,
        sourceEventId: crypto.randomUUID(),
        idempotencyKey: `proposal:${proposalId}:created:v1`,
        eventType: "McpEffectProposalCreated",
        redactedPayload: { kind: input.kind, aggregateId: input.aggregateId, revision, sourceVersion },
        actor: clientId,
        correlationId,
        createdAt,
      });
      await insertTrace(tx, {
        workspaceId,
        proposalId,
        stage: "approval",
        sequence: 2,
        sourceEventId: crypto.randomUUID(),
        idempotencyKey: `approval:${approvalItemId}:created:v1`,
        eventType: "McpEffectApprovalCreated",
        redactedPayload: { approvalItemId, status: "pending" },
        actor: clientId,
        correlationId,
        createdAt,
      });
      return toProposalRecord({ ...row!, approvalItemId });
    });
  }

  async getProposal(input: { readonly workspaceId: string; readonly proposalId: string }): Promise<McpEffectProposalRecord | null> {
    const rows = await this.database.select().from(mcpEffectProposals).where(and(
      eq(mcpEffectProposals.workspaceId, input.workspaceId),
      eq(mcpEffectProposals.id, input.proposalId),
    )).limit(1);
    return rows[0] ? toProposalRecord(rows[0]) : null;
  }

  async createApproval(input: CreateApprovalInput): Promise<McpEffectApprovalRecord> {
    const createdAt = input.createdAt ?? this.now();
    const workspaceId = input.workspaceId ?? input.context?.workspaceId;
    if (!workspaceId) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_WORKSPACE_REQUIRED");
    return this.database.transaction(async (tx) => {
      const proposal = await lockedProposal(tx, workspaceId, input.proposalId);
      if (!proposal) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_PROPOSAL_NOT_FOUND");
      const existing = await tx.select({ id: approvalItems.id }).from(approvalItems).where(and(
        eq(approvalItems.workspaceId, workspaceId),
        eq(approvalItems.proposalId, proposal.id),
      )).limit(1);
      if (existing[0]) {
        const projectedIntent = redactedSnapshot(projectReviewerIntent(
          proposal.kind as McpGovernedEffectKind,
          proposal.aggregateId,
          proposal.intentSnapshot,
          proposal.revision,
          proposal.sourceVersion,
        ), "MCP_EFFECT_INTENT_SNAPSHOT");
        const existingApproval = (await tx.select().from(approvalItems).where(and(
          eq(approvalItems.workspaceId, workspaceId),
          eq(approvalItems.id, existing[0].id),
        )).limit(1))[0]!;
        if (canonicalJson(existingApproval.contentOriginal) !== canonicalJson(projectedIntent)) {
          throw new McpGovernedEffectRepositoryError("MCP_EFFECT_APPROVAL_CONTENT_INVALID");
        }
        await assertPgJsonbByteBound(tx, projectedIntent, "MCP_EFFECT_INTENT_SNAPSHOT");
        if (proposal.approvalItemId !== existing[0].id) {
          await tx.update(mcpEffectProposals).set({ approvalItemId: existing[0].id, updatedAt: createdAt }).where(and(
            eq(mcpEffectProposals.workspaceId, workspaceId),
            eq(mcpEffectProposals.id, proposal.id),
          ));
        }
        await ensureApprovalTrace(tx, proposal, existing[0].id, createdAt, input.actor);
        return {
          proposalId: proposal.id,
          workspaceId: proposal.workspaceId,
          approvalItemId: existing[0].id,
          correlationId: proposal.correlationId,
        };
      }

      const approvalItemId = crypto.randomUUID();
      const context = {
        proposalId: proposal.id,
        kind: proposal.kind,
        aggregateId: proposal.aggregateId,
        correlationId: proposal.correlationId,
        revision: proposal.revision,
        sourceVersion: proposal.sourceVersion,
      };
      const projectedIntent = redactedSnapshot(projectReviewerIntent(
        proposal.kind as McpGovernedEffectKind,
        proposal.aggregateId,
        proposal.intentSnapshot,
        proposal.revision,
        proposal.sourceVersion,
      ), "MCP_EFFECT_INTENT_SNAPSHOT");
      await assertPgJsonbByteBound(tx, projectedIntent, "MCP_EFFECT_INTENT_SNAPSHOT");
      await tx.insert(approvalItems).values({
        id: approvalItemId,
        workspaceId,
        proposalId: proposal.id,
        itemType: "mcp_external_effect",
        channel: "mcp",
        contentOriginal: projectedIntent,
        contentEdited: null,
        context,
        sourceUpdatedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
      await tx.update(mcpEffectProposals).set({ approvalItemId, updatedAt: createdAt }).where(and(
        eq(mcpEffectProposals.workspaceId, workspaceId),
        eq(mcpEffectProposals.id, proposal.id),
        sql`${mcpEffectProposals.approvalItemId} is null`,
      ));
      await insertTrace(tx, {
        workspaceId,
        proposalId: proposal.id,
        stage: "approval",
        sequence: await nextSequence(tx, workspaceId, proposal.id),
        sourceEventId: crypto.randomUUID(),
        idempotencyKey: `approval:${approvalItemId}:created:v1`,
        eventType: "McpEffectApprovalCreated",
        redactedPayload: { approvalItemId, status: "pending" },
        ...(input.actor ? { actor: input.actor } : {}),
        correlationId: proposal.correlationId,
        createdAt,
      });
      return { proposalId: proposal.id, workspaceId: proposal.workspaceId, approvalItemId, correlationId: proposal.correlationId };
    });
  }

  async appendTrace(input: AppendTraceInput): Promise<McpEffectTraceRecord> {
    if (!TRACE_STAGES.has(input.stage)) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_STAGE_INVALID");
    assertUuid(input.sourceEventId, "MCP_EFFECT_TRACE_SOURCE_EVENT_INVALID");
    if (!input.idempotencyKey || input.idempotencyKey.length > 500) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_IDEMPOTENCY_INVALID");
    if (input.eventType.length < 1 || input.eventType.length > 160) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_EVENT_TYPE_INVALID");
    if (input.actor !== undefined && (input.actor.length < 1 || input.actor.length > 120)) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_ACTOR_INVALID");
    const redactedPayload = redactedSnapshot(projectTracePayload(input.redactedPayload ?? {}), "MCP_EFFECT_TRACE_PAYLOAD");
    const createdAt = input.createdAt ?? this.now();
    const workspaceId = input.workspaceId ?? input.context?.workspaceId;
    if (!workspaceId) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_WORKSPACE_REQUIRED");
    return this.database.transaction(async (tx) => {
      await advisoryLock(tx, `${workspaceId}:trace-source:${input.sourceEventId}`);
      const proposal = await lockedProposal(tx, workspaceId, input.proposalId);
      if (!proposal) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_PROPOSAL_NOT_FOUND");
      if (input.correlationId && input.correlationId !== proposal.correlationId) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_CORRELATION_CONFLICT");
      const replay = await tx.select().from(mcpEffectTraces).where(and(
        eq(mcpEffectTraces.workspaceId, workspaceId),
        eq(mcpEffectTraces.proposalId, input.proposalId),
        eq(mcpEffectTraces.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (replay[0]) {
        if (replay[0].stage !== input.stage || replay[0].eventType !== input.eventType || replay[0].sourceEventId !== input.sourceEventId) {
          throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_IDEMPOTENCY_CONFLICT");
        }
        if (canonicalJson(replay[0].redactedPayload) !== canonicalJson(redactedPayload)) {
          throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_IDEMPOTENCY_CONFLICT");
        }
        return toTraceRecord(replay[0]);
      }
      const sourceEvent = await tx.select({ id: mcpEffectTraces.id }).from(mcpEffectTraces).where(and(
        eq(mcpEffectTraces.workspaceId, workspaceId),
        eq(mcpEffectTraces.sourceEventId, input.sourceEventId),
      )).limit(1);
      if (sourceEvent[0]) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_SOURCE_EVENT_CONFLICT");
      await assertPgJsonbByteBound(tx, redactedPayload, "MCP_EFFECT_TRACE_PAYLOAD");
      let row;
      try {
        row = await insertTrace(tx, {
          workspaceId,
          proposalId: input.proposalId,
          stage: input.stage,
          sequence: await nextSequence(tx, workspaceId, input.proposalId),
          sourceEventId: input.sourceEventId,
          idempotencyKey: input.idempotencyKey,
          eventType: input.eventType,
          redactedPayload,
          ...(input.actor ? { actor: input.actor } : {}),
          correlationId: proposal.correlationId,
          createdAt,
        });
      } catch (error) {
        if (isSourceEventUniqueViolation(error)) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_SOURCE_EVENT_CONFLICT");
        throw error;
      }
      return toTraceRecord(row);
    });
  }
}

async function lockedProposal(executor: DatabaseExecutor, workspaceId: string, proposalId: string) {
  await advisoryLock(executor, `${workspaceId}:proposal:${proposalId}`);
  const rows = await executor.select().from(mcpEffectProposals).where(and(
    eq(mcpEffectProposals.workspaceId, workspaceId),
    eq(mcpEffectProposals.id, proposalId),
  )).limit(1);
  return rows[0] ?? null;
}

async function nextSequence(executor: DatabaseExecutor, workspaceId: string, proposalId: string): Promise<number> {
  const rows = await executor.select({ sequence: max(mcpEffectTraces.sequence) }).from(mcpEffectTraces).where(and(
    eq(mcpEffectTraces.workspaceId, workspaceId),
    eq(mcpEffectTraces.proposalId, proposalId),
  ));
  return Number(rows[0]?.sequence ?? 0) + 1;
}

async function insertTrace(executor: DatabaseExecutor, input: {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly stage: McpEffectTraceStage;
  readonly sequence: number;
  readonly sourceEventId: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly redactedPayload: Record<string, unknown>;
  readonly actor?: string;
  readonly correlationId: string;
  readonly createdAt: Date;
}) {
  const [row] = await executor.insert(mcpEffectTraces).values({
    workspaceId: input.workspaceId,
    proposalId: input.proposalId,
    stage: input.stage,
    sequence: input.sequence,
    sourceEventId: input.sourceEventId,
    idempotencyKey: input.idempotencyKey,
    eventType: input.eventType,
    redactedPayload: input.redactedPayload,
    actor: input.actor ?? null,
    correlationId: input.correlationId,
    createdAt: input.createdAt,
  }).returning();
  return row!;
}

async function ensureApprovalTrace(
  executor: DatabaseExecutor,
  proposal: typeof mcpEffectProposals.$inferSelect,
  approvalItemId: string,
  createdAt: Date,
  actor?: string,
): Promise<void> {
  const idempotencyKey = `approval:${approvalItemId}:created:v1`;
  const existing = await executor.select().from(mcpEffectTraces).where(and(
    eq(mcpEffectTraces.workspaceId, proposal.workspaceId),
    eq(mcpEffectTraces.proposalId, proposal.id),
    eq(mcpEffectTraces.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (existing[0]) {
    if (existing[0].stage !== "approval" || existing[0].eventType !== "McpEffectApprovalCreated" || existing[0].correlationId !== proposal.correlationId) {
      throw new McpGovernedEffectRepositoryError("MCP_EFFECT_APPROVAL_TRACE_INVALID");
    }
    return;
  }
  const redactedPayload = { approvalItemId, status: "pending" };
  await assertPgJsonbByteBound(executor, redactedPayload, "MCP_EFFECT_TRACE_PAYLOAD");
  await insertTrace(executor, {
    workspaceId: proposal.workspaceId,
    proposalId: proposal.id,
    stage: "approval",
    sequence: await nextSequence(executor, proposal.workspaceId, proposal.id),
    sourceEventId: crypto.randomUUID(),
    idempotencyKey,
    eventType: "McpEffectApprovalCreated",
    redactedPayload,
    ...(actor ? { actor } : {}),
    correlationId: proposal.correlationId,
    createdAt,
  });
}

async function advisoryLock(executor: DatabaseExecutor, key: string): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export function deriveMcpEffectInputHash(input: {
  readonly kind: McpGovernedEffectKind;
  readonly aggregateId: string;
  readonly intentSnapshot: unknown;
  readonly sourceSnapshot: unknown;
  readonly revision?: number;
  readonly sourceVersion?: number;
  readonly factsVersion?: number;
}): string {
  const revision = input.revision ?? 1;
  const sourceVersion = input.sourceVersion ?? 1;
  const factsVersion = input.factsVersion ?? 1;
  const normalized = {
    kind: input.kind,
    aggregateId: input.aggregateId,
    intentSnapshot: redactedSnapshot(projectReviewerIntent(input.kind, input.aggregateId, input.intentSnapshot, revision, sourceVersion), "MCP_EFFECT_INTENT_SNAPSHOT"),
    sourceSnapshot: projectSourceSnapshot(input.kind, input.aggregateId, input.sourceSnapshot, revision, sourceVersion, factsVersion),
  };
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

function assertCanonicalHash(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_CANONICAL_HASH_INVALID");
}

function projectReviewerIntent(kind: McpGovernedEffectKind, aggregateId: string, value: unknown, revision: number, sourceVersion: number): Record<string, unknown> {
  const source = objectRoot(value, "MCP_EFFECT_INTENT_SNAPSHOT_OBJECT_REQUIRED");
  const projection: Record<string, unknown> = { kind, aggregateId };
  for (const field of REVIEWER_FIELDS[kind]) {
    const candidate = source[field];
    if (typeof candidate === "string") projection[field] = candidate;
  }
  projection.revision = revision;
  projection.sourceVersion = sourceVersion;
  return projection;
}

function projectSourceSnapshot(kind: McpGovernedEffectKind, aggregateId: string, value: unknown, revision: number, sourceVersion: number, factsVersion: number): Record<string, unknown> {
  const source = objectRoot(value, "MCP_EFFECT_SOURCE_SNAPSHOT_OBJECT_REQUIRED");
  assertPositiveVersion(revision, "MCP_EFFECT_REVISION_INVALID");
  assertPositiveVersion(sourceVersion, "MCP_EFFECT_SOURCE_VERSION_INVALID");
  assertPositiveVersion(factsVersion, "MCP_EFFECT_FACTS_VERSION_INVALID");
  for (const field of REQUIRED_SOURCE_FIELDS[kind]) {
    if (!Object.prototype.hasOwnProperty.call(source, field) || source[field] === undefined) {
      throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_REQUIRED");
    }
  }
  const projection: Record<string, unknown> = { kind, aggregateId };
  for (const field of SOURCE_FIELDS[kind]) {
    const candidate = source[field];
    if (candidate === undefined && Object.prototype.hasOwnProperty.call(source, field)) {
      throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    }
    if (candidate !== undefined) projection[field] = validateSourceFact(field, candidate);
  }
  projection.factsVersion = factsVersion;
  projection.revision = revision;
  projection.sourceVersion = sourceVersion;
  return projection;
}

function objectRoot(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new McpGovernedEffectRepositoryError(code);
  return value as Record<string, unknown>;
}

function validateSourceFact(field: string, value: unknown): unknown {
  if (["status", "sourceId", "sourceUpdatedAt", "assetVersionId", "policyVersion", "automationStage", "assetId", "publicationId", "assetStatus", "enrollmentFingerprint"].includes(field)) {
    if (typeof value !== "string" || value.length < 1 || value.length > 200 || (field === "sourceUpdatedAt" && !isIsoDate(value))) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    if (field === "enrollmentFingerprint" && !/^[a-f0-9]{64}$/.test(value)) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    return value;
  }
  if (["humanReplyAt", "slotStart", "slotEnd", "expiresAt", "scheduledFor"].includes(field)) {
    if (value !== null && (typeof value !== "string" || !isIsoDate(value))) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    return value;
  }
  if (["assetReady", "strategyActive", "strategyDeleted", "suppressed"].includes(field)) {
    if (typeof value !== "boolean") throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    return value;
  }
  if (field === "strategyVersion") {
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000_000) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    return value;
  }
  if (field === "humanReply") {
    if (typeof value !== "boolean") throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    return value;
  }
  if (field === "suppressionStatus") {
    if (typeof value !== "string" || !["suppressed", "opted_out"].includes(value)) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    return value;
  }
  if (["factsVersion", "contentVersion"].includes(field)) {
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000_000) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    return value;
  }
  if (field === "timeZone") {
    if (typeof value !== "string" || !isStrictTimeZone(value)) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    return value;
  }
  if (field === "slotPosition") {
    if (!Number.isFinite(value as number) || !Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    return value;
  }
  if (["scheduleWindow", "accountHealth"].includes(field)) return validateStructuredFact(field, value);
  return value;
}

function validateStructuredFact(field: string, value: unknown): Record<string, unknown> {
  const source = objectRoot(value, "MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
  const allowed = field === "scheduleWindow" ? ["start", "end", "timeZone"] : ["status", "checkedAt"];
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    const nested = source[key];
    if (key === "start" || key === "end" || key === "checkedAt") {
      if (typeof nested !== "string" || !isIsoDate(nested)) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    } else if (key === "timeZone" && (typeof nested !== "string" || !isStrictTimeZone(nested))) {
      throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    } else if (typeof nested !== "string" || nested.length < 1 || nested.length > 100 || (field === "accountHealth" && !["healthy", "degraded", "unhealthy"].includes(nested))) {
      throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_TYPE_INVALID");
    }
    result[key] = nested;
  }
  if (field === "scheduleWindow" && !["start", "end", "timeZone"].every((key) => Object.prototype.hasOwnProperty.call(result, key))) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_REQUIRED");
  if (field === "accountHealth" && !["status", "checkedAt"].every((key) => Object.prototype.hasOwnProperty.call(result, key))) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_SOURCE_FACT_REQUIRED");
  return result;
}

function validateTraceFact(field: string, value: unknown): unknown {
  if (["aggregateId", "approvalItemId", "operationId", "jobId", "intentionId", "reconciliationId"].includes(field)) {
    assertUuid(value, "MCP_EFFECT_TRACE_ID_INVALID");
    return value;
  }
  if (["revision", "sourceVersion", "attempt"].includes(field)) {
    if (!Number.isFinite(value as number) || !Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000_000) throw new McpGovernedEffectRepositoryError(`MCP_EFFECT_TRACE_${field.toUpperCase()}_INVALID`);
    return value;
  }
  if (field === "decision") {
    if (value !== "allow" && value !== "deny" && value !== "approve" && value !== "reject") throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_DECISION_INVALID");
    return value;
  }
  if (field === "kind" && (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(SOURCE_FIELDS, value))) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_KIND_INVALID");
  if (["status", "state", "code", "resultCode"].includes(field)) {
    if (typeof value !== "string" || value.length < 1 || value.length > 160) throw new McpGovernedEffectRepositoryError("MCP_EFFECT_TRACE_FIELD_INVALID");
    return value;
  }
  return value;
}

function assertPositiveVersion(value: number, code: string): void {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000) throw new McpGovernedEffectRepositoryError(code);
}

function assertUuid(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new McpGovernedEffectRepositoryError(code);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isStrictTimeZone(value: string): boolean {
  if (value === "UTC" || /^[+-]\d{2}:\d{2}$/.test(value)) return value === "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/");
  } catch {
    return false;
  }
}

async function assertPgJsonbByteBound(executor: DatabaseExecutor, value: Record<string, unknown>, label: string): Promise<void> {
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new McpGovernedEffectRepositoryError(`${label}_INVALID`); }
  try {
    const rows = await executor.execute(sql`select octet_length(${encoded}::jsonb::text) as bytes`) as unknown as Array<{ readonly bytes: number | string }>;
    if (Number(rows[0]?.bytes ?? 0) > MAX_SNAPSHOT_BYTES) throw new McpGovernedEffectRepositoryError(`${label}_TOO_LARGE`);
  } catch (error) {
    if (error instanceof McpGovernedEffectRepositoryError) throw error;
    throw new McpGovernedEffectRepositoryError(`${label}_INVALID`);
  }
}

function isSourceEventUniqueViolation(error: unknown): boolean {
  const candidate = error as { readonly code?: string; readonly cause?: { readonly code?: string; readonly constraint_name?: string } };
  const direct = candidate as { readonly code?: string; readonly constraint_name?: string };
  return (candidate.cause?.code ?? direct.code) === "23505"
    && (candidate.cause?.constraint_name ?? direct.constraint_name) === "mcp_effect_traces_source_event_uq";
}

function redactedSnapshot(value: unknown, label: string): Record<string, unknown> {
  const root = objectRoot(value, `${label}_OBJECT_REQUIRED`);
  let encoded: string;
  try { encoded = JSON.stringify(root); } catch { throw new McpGovernedEffectRepositoryError(`${label}_INVALID`); }
  if (new TextEncoder().encode(encoded).byteLength > MAX_SNAPSHOT_BYTES) throw new McpGovernedEffectRepositoryError(`${label}_TOO_LARGE`);
  return root;
}

function projectTracePayload(value: unknown): Record<string, unknown> {
  const source = objectRoot(value, "MCP_EFFECT_TRACE_PAYLOAD_OBJECT_REQUIRED");
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(source)) {
    if (!TRACE_FIELDS.has(key)) continue;
    result[key] = validateTraceFact(key, nested);
  }
  return result;
}

function toProposalRecord(row: typeof mcpEffectProposals.$inferSelect): McpEffectProposalRecord {
  return {
    proposalId: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind as McpGovernedEffectKind,
    status: row.status as McpEffectProposal["status"],
    approvalItemId: row.approvalItemId,
    correlationId: row.correlationId,
    version: row.version,
    revision: row.revision,
    sourceVersion: row.sourceVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientId: row.clientId,
    requestKey: row.requestKey,
    inputHash: row.inputHash,
    aggregateId: row.aggregateId,
    intentSnapshot: row.intentSnapshot as Record<string, unknown>,
    sourceSnapshot: row.sourceSnapshot as Record<string, unknown>,
  };
}

function toTraceRecord(row: typeof mcpEffectTraces.$inferSelect): McpEffectTraceRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    proposalId: row.proposalId,
    stage: row.stage as McpEffectTraceStage,
    sequence: row.sequence,
    sourceEventId: row.sourceEventId,
    idempotencyKey: row.idempotencyKey,
    eventType: row.eventType,
    redactedPayload: row.redactedPayload as Record<string, unknown>,
    actor: row.actor,
    correlationId: row.correlationId,
    createdAt: row.createdAt.toISOString(),
  };
}
