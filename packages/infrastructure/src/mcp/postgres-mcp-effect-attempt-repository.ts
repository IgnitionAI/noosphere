import { and, asc, eq, lte, max } from "drizzle-orm";
import { createHash } from "node:crypto";
import type {
  ExternalEffectAttemptIdentity,
  ExternalEffectAttemptMarker,
  ExternalEffectAttemptPort,
  ExternalEffectAttemptResult,
  ExternalEffectOutcomeInput,
  ExternalEffectReadOnlyInput,
  ExternalEffectReadOnlyPort,
  ExternalEffectReadOnlyResult,
} from "@outbound/application/mcp/external-effect-attempt";
import type { McpGovernedEffectKind } from "@outbound/application/mcp/mcp-governed-effects";
import type { Database, DatabaseExecutor } from "@outbound/infrastructure/database/client";
import {
  approvalItems,
  campaigns,
  contentPublications,
  conversations,
  jobs,
  mcpEffectIntentions,
  mcpEffectProposals,
  mcpEffectReconciliations,
  mcpEffectTraces,
  meetingProposals,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import {
  PostgresMcpEffectReconciliationRepository,
  canonicalJson,
  isUniqueViolationForConstraint,
  redactReconciliationJson,
} from "./postgres-mcp-effect-reconciliation-repository";

const JOB_TYPE = "mcp.external-effect.execute";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_CODE = /^[A-Z][A-Z0-9_.-]{0,119}$/;
const MAX_LIMIT = 100;
const MAX_RESULT_BYTES = 32_768;

export class McpExternalEffectAttemptRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "McpExternalEffectAttemptRepositoryError";
  }
}

type AttemptTask = ExternalEffectReadOnlyInput;

/**
 * Durable provider-neutral boundary for the final effect attempt. It writes a
 * redacted started marker before an executor can cross into a provider and
 * turns ambiguous outcomes into an immutable unknown + reconciliation row.
 */
export class PostgresMcpExternalEffectAttemptRepository implements ExternalEffectAttemptPort {
  constructor(
    private readonly database: Database,
    private readonly readOnlyPort?: ExternalEffectReadOnlyPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordBeforeProvider(input: ExternalEffectAttemptIdentity): Promise<ExternalEffectAttemptMarker> {
    assertIdentity(input);
    const now = this.now();
    return this.database.transaction(async (tx) => {
      const rows = await lockIdentity(tx, input, now);
      assertStartedLease(rows, input, now);
      const idempotencyKey = `mcp-effect:${input.intentionId}:attempt:v1`;
      const existing = await tx.select().from(mcpEffectTraces).where(and(
        eq(mcpEffectTraces.workspaceId, input.workspaceId),
        eq(mcpEffectTraces.proposalId, input.proposalId),
        eq(mcpEffectTraces.stage, "attempt"),
        eq(mcpEffectTraces.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (existing[0]) {
        return {
          ...input,
          state: "started",
          attempt: readAttempt(existing[0].redactedPayload),
          sequence: existing[0].sequence,
          sourceEventId: existing[0].sourceEventId,
          idempotencyKey,
        };
      }
      // Re-check the authoritative aggregate while the proposal and intention
      // locks are held. This closes the durable pre-provider window: a source
      // cancelled/deleted/revised before this marker commits cannot cross the
      // provider boundary. The provider call itself remains outside this
      // transaction and is therefore intentionally not claimed race-free.
      await lockAttemptAggregate(tx, input.kind, input.workspaceId, input.aggregateId, now);
      const job = rows.job;
      if (!job) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_JOB_LEASE_INVALID");
      const attempt = Number.isSafeInteger(job.attempts) && job.attempts > 0 ? job.attempts : 1;
      const sequence = await nextSequence(tx, input.workspaceId, input.proposalId);
      const sourceEventId = stableUuid(`mcp-effect:${input.intentionId}:attempt:v1`);
      await tx.insert(mcpEffectTraces).values({
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        stage: "attempt",
        sequence,
        sourceEventId,
        idempotencyKey,
        eventType: "McpExternalEffectAttemptStarted",
        redactedPayload: {
          state: "started",
          status: "started",
          attempt,
          kind: input.kind,
          aggregateId: input.aggregateId,
        },
        actor: null,
        correlationId: input.correlationId,
        createdAt: now,
      });
      return { ...input, state: "started", attempt, sequence, sourceEventId, idempotencyKey };
    });
  }

  async recordOutcome(input: ExternalEffectOutcomeInput): Promise<ExternalEffectAttemptResult> {
    assertIdentity(input);
    const now = this.now();
    const result = normalizeOutcome(input);
    const resultIdempotencyKey = input.idempotencyKey ?? `mcp-effect:${input.intentionId}:result:v1`;
    if (!resultIdempotencyKey || resultIdempotencyKey.length > 500) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_OUTCOME_IDEMPOTENCY_INVALID");
    if (input.sourceEventId !== undefined) assertUuid(input.sourceEventId, "MCP_EFFECT_OUTCOME_SOURCE_EVENT_INVALID");
    if (result.outcome === "delivered" && input.authoritative !== true) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_RESULT_NOT_AUTHORITATIVE");
    // Validate any supplied adapter body even when its outcome is failed or
    // unknown; these bodies are never persisted, but non-finite/oversized
    // values must not cross the canonical JSON boundary.
    const redactedResult = input.result === undefined ? {} : redactResult(input.result);
    return this.database.transaction(async (tx) => {
      // A terminal replay is read-only and must remain idempotent even after
      // the queue has acknowledged/cleared its lease. New outcomes still
      // require a live queue lease below.
      const rows = await lockIdentity(tx, input, now, { allowTerminalReplay: true });
      const existingResult = await tx.select().from(mcpEffectTraces).where(and(
        eq(mcpEffectTraces.workspaceId, input.workspaceId),
        eq(mcpEffectTraces.proposalId, input.proposalId),
        eq(mcpEffectTraces.stage, "result"),
        eq(mcpEffectTraces.idempotencyKey, resultIdempotencyKey),
      )).limit(1);
      if (existingResult[0]) {
        if (input.sourceEventId !== undefined && existingResult[0].sourceEventId !== input.sourceEventId) {
          throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_SOURCE_EVENT_CONFLICT");
        }
        assertReplayOutcome(existingResult[0].redactedPayload, result, input, redactedResult);
        const state = result.outcome === "unknown" ? "unknown" : "completed";
        return {
          state,
          proposalStatus: result.outcome === "delivered" ? "delivered" : result.outcome === "failed" ? "failed" : "reconciling",
          reconciliationId: readReconciliationId(existingResult[0].redactedPayload),
          sequence: existingResult[0].sequence,
          sourceEventId: existingResult[0].sourceEventId,
          idempotencyKey: resultIdempotencyKey,
        };
      }
      const idempotencyOwner = await tx.select({ stage: mcpEffectTraces.stage }).from(mcpEffectTraces).where(and(
        eq(mcpEffectTraces.workspaceId, input.workspaceId), eq(mcpEffectTraces.proposalId, input.proposalId), eq(mcpEffectTraces.idempotencyKey, resultIdempotencyKey),
      )).limit(1);
      if (idempotencyOwner[0]) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_IDEMPOTENCY_CONFLICT");
      assertJobLease(rows.job, input, now);
      assertStartedLease(rows, input, now);
      let reconciliationId: string | null = null;
      if (result.outcome === "unknown") {
        reconciliationId = await ensureReconciliation(tx, input, now, redactedResult);
      }
      const state = result.outcome === "unknown" ? "unknown" : "completed";
      const proposalStatus = result.outcome === "delivered" ? "delivered" : result.outcome === "failed" ? "failed" : "reconciling";
      const [updatedIntention] = await tx.update(mcpEffectIntentions).set({
        state,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
      }).where(and(
        eq(mcpEffectIntentions.workspaceId, input.workspaceId),
        eq(mcpEffectIntentions.id, input.intentionId),
        eq(mcpEffectIntentions.state, "started"),
        eq(mcpEffectIntentions.leaseToken, input.leaseToken),
        eq(mcpEffectIntentions.leaseExpiresAt, input.leaseExpiresAt),
      )).returning({ id: mcpEffectIntentions.id });
      if (!updatedIntention) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_LEASE_LOST");
      const proposal = rows.proposal;
      const [updatedProposal] = await tx.update(mcpEffectProposals).set({
        status: proposalStatus,
        ...(reconciliationId ? { reconciliationId } : {}),
        version: proposal.version + 1,
        updatedAt: now,
      }).where(and(
        eq(mcpEffectProposals.workspaceId, input.workspaceId),
        eq(mcpEffectProposals.id, input.proposalId),
        eq(mcpEffectProposals.version, proposal.version),
        eq(mcpEffectProposals.status, "accepted"),
      )).returning({ id: mcpEffectProposals.id });
      if (!updatedProposal) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_VERSION_CONFLICT");
      const sequence = await nextSequence(tx, input.workspaceId, input.proposalId);
      const sourceEventId = input.sourceEventId ?? stableUuid(`mcp-effect:${input.intentionId}:${result.outcome}:v1`);
      const payload = {
        status: result.outcome,
        code: result.code,
        ...(reconciliationId ? { reconciliationId } : {}),
        ...(Object.keys(redactedResult).length > 0 ? { result: redactedResult } : {}),
      };
      try {
        await tx.insert(mcpEffectTraces).values({
          workspaceId: input.workspaceId,
          proposalId: input.proposalId,
          stage: "result",
          sequence,
          sourceEventId,
          idempotencyKey: resultIdempotencyKey,
          eventType: result.outcome === "delivered" ? "McpExternalEffectResultDelivered" : result.outcome === "failed" ? "McpExternalEffectResultFailed" : "McpExternalEffectResultUnknown",
          redactedPayload: payload,
          actor: null,
          correlationId: input.correlationId,
          createdAt: now,
        });
      } catch (error) {
        if (isUniqueViolationForConstraint(error, "mcp_effect_traces_source_event_uq")) {
          throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_SOURCE_EVENT_CONFLICT");
        }
        throw error;
      }
      return { state, proposalStatus, reconciliationId, sequence, sourceEventId, idempotencyKey: resultIdempotencyKey };
    });
  }

  async reconcileReadOnly(input: ExternalEffectReadOnlyInput): Promise<ExternalEffectReadOnlyResult> {
    const safeInput = normalizeReadOnlyInput(input);
    if (!this.readOnlyPort) return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
    try {
      return normalizeReadOnlyResult(await this.readOnlyPort.reconcileReadOnly(safeInput));
    } catch {
      return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
    }
  }

  async recoverExpiredStarted(input: { readonly workspaceId?: string; readonly now: Date; readonly limit?: number }): Promise<number> {
    if (input.workspaceId !== undefined) assertUuid(input.workspaceId, "MCP_EFFECT_WORKSPACE_INVALID");
    if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_RECOVERY_INPUT_INVALID");
    const limit = normalizeLimit(input.limit);
    if (limit === 0) return 0;
    const tasks: AttemptTask[] = [];
    await this.database.transaction(async (tx) => {
      const candidates = await tx.select({
        workspaceId: mcpEffectIntentions.workspaceId,
        proposalId: mcpEffectIntentions.proposalId,
        intentionId: mcpEffectIntentions.id,
        jobId: mcpEffectIntentions.jobId,
        kind: mcpEffectIntentions.kind,
        aggregateId: mcpEffectIntentions.aggregateId,
        correlationId: mcpEffectIntentions.correlationId,
        leaseToken: mcpEffectIntentions.leaseToken,
        leaseExpiresAt: mcpEffectIntentions.leaseExpiresAt,
      }).from(mcpEffectIntentions).where(and(
        eq(mcpEffectIntentions.state, "started"),
        lte(mcpEffectIntentions.leaseExpiresAt, input.now),
        ...(input.workspaceId ? [eq(mcpEffectIntentions.workspaceId, input.workspaceId)] : []),
      )).orderBy(asc(mcpEffectIntentions.leaseExpiresAt), asc(mcpEffectIntentions.id)).limit(limit);
      for (const candidate of candidates) {
        if (!candidate.leaseToken || !candidate.leaseExpiresAt) continue;
        const workspace = (await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, candidate.workspaceId)).for("update", { skipLocked: true }).limit(1))[0];
        if (!workspace) continue;
        const proposal = (await tx.select().from(mcpEffectProposals).where(and(eq(mcpEffectProposals.workspaceId, candidate.workspaceId), eq(mcpEffectProposals.id, candidate.proposalId))).for("update", { skipLocked: true }).limit(1))[0];
        if (!proposal) continue;
        const intention = (await tx.select().from(mcpEffectIntentions).where(and(eq(mcpEffectIntentions.workspaceId, candidate.workspaceId), eq(mcpEffectIntentions.id, candidate.intentionId))).for("update", { skipLocked: true }).limit(1))[0];
        if (!intention || intention.state !== "started" || !intention.leaseToken || !intention.leaseExpiresAt || intention.leaseExpiresAt > input.now) continue;
        const job = (await tx.select({
          id: jobs.id,
          workspaceId: jobs.workspaceId,
          type: jobs.type,
          status: jobs.status,
          lockedBy: jobs.lockedBy,
          lockedUntil: jobs.lockedUntil,
        }).from(jobs).where(and(eq(jobs.workspaceId, candidate.workspaceId), eq(jobs.id, candidate.jobId))).for("update", { skipLocked: true }).limit(1))[0];
        // A recovery candidate is still bound to the exact queue job. A
        // deleted/replaced/malformed row must not be converted into an
        // unowned reconciliation record.
        if (!job || job.id !== candidate.jobId || job.workspaceId !== candidate.workspaceId || job.type !== JOB_TYPE || job.status !== "running" || !job.lockedBy || !job.lockedUntil) continue;
        if (proposal.status !== "accepted") continue;
        const reconciliationId = await ensureReconciliation(tx, {
          workspaceId: candidate.workspaceId,
          proposalId: candidate.proposalId,
          intentionId: candidate.intentionId,
          jobId: candidate.jobId,
          kind: candidate.kind as McpGovernedEffectKind,
          aggregateId: candidate.aggregateId,
          correlationId: candidate.correlationId,
          leaseToken: intention.leaseToken,
          leaseExpiresAt: intention.leaseExpiresAt,
        }, input.now);
        const [updatedIntention] = await tx.update(mcpEffectIntentions).set({ state: "unknown", leaseToken: null, leaseExpiresAt: null, updatedAt: input.now }).where(and(
          eq(mcpEffectIntentions.workspaceId, candidate.workspaceId), eq(mcpEffectIntentions.id, candidate.intentionId),
          eq(mcpEffectIntentions.state, "started"), eq(mcpEffectIntentions.leaseToken, intention.leaseToken), eq(mcpEffectIntentions.leaseExpiresAt, intention.leaseExpiresAt),
        )).returning({ id: mcpEffectIntentions.id });
        if (!updatedIntention) continue;
        const [updatedProposal] = await tx.update(mcpEffectProposals).set({ status: "reconciling", reconciliationId, version: proposal.version + 1, updatedAt: input.now }).where(and(
          eq(mcpEffectProposals.workspaceId, candidate.workspaceId), eq(mcpEffectProposals.id, candidate.proposalId), eq(mcpEffectProposals.status, "accepted"), eq(mcpEffectProposals.version, proposal.version),
        )).returning({ id: mcpEffectProposals.id });
        if (!updatedProposal) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_VERSION_CONFLICT");
        const sequence = await nextSequence(tx, candidate.workspaceId, candidate.proposalId);
        await tx.insert(mcpEffectTraces).values({
          workspaceId: candidate.workspaceId, proposalId: candidate.proposalId, stage: "result", sequence,
          sourceEventId: stableUuid(`mcp-effect:${candidate.intentionId}:unknown:v1`), idempotencyKey: `mcp-effect:${candidate.intentionId}:result:v1`,
          eventType: "McpExternalEffectResultUnknown", redactedPayload: { status: "unknown", code: "ATTEMPT_LEASE_EXPIRED", reconciliationId },
          actor: null, correlationId: candidate.correlationId, createdAt: input.now,
        });
        // Recovery owns the expired queue lease. Completing this existing job
        // prevents a queue restart from replaying the original mutation.
        await tx.update(jobs).set({ status: "completed", lockedBy: null, lockedUntil: null, updatedAt: input.now }).where(and(
          eq(jobs.workspaceId, candidate.workspaceId), eq(jobs.id, candidate.jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, job.lockedBy),
        ));
        tasks.push({
          workspaceId: candidate.workspaceId, proposalId: candidate.proposalId, intentionId: candidate.intentionId,
          kind: candidate.kind as McpGovernedEffectKind, aggregateId: candidate.aggregateId, correlationId: candidate.correlationId,
          reconciliationId, criteriaSnapshot: { proposalId: candidate.proposalId, aggregateId: candidate.aggregateId },
        });
        if (tasks.length >= limit) break;
      }
    });
    for (const task of tasks) {
      const observation = await this.reconcileReadOnly(task);
      await this.applyReadOnlyObservation(task, observation, input.now);
    }
    return tasks.length;
  }

  private async applyReadOnlyObservation(task: AttemptTask, observation: ExternalEffectReadOnlyResult, now: Date): Promise<void> {
    const repository = new PostgresMcpEffectReconciliationRepository(this.database, () => now);
    const lease = await repository.claim({ workspaceId: task.workspaceId, reconciliationId: task.reconciliationId, now, leaseMs: 60_000 });
    if (!lease) return;
    if (observation.outcome === "matched") {
      await repository.markMatched({ workspaceId: task.workspaceId, reconciliationId: task.reconciliationId, leaseToken: lease.leaseToken, now, authoritative: true, candidateCount: 1, result: observation.result, sourceEventId: stableUuid(`mcp-effect:${task.intentionId}:reconciled:v1`), idempotencyKey: `mcp-effect:${task.intentionId}:reconciled:v1` });
      await this.database.update(mcpEffectIntentions).set({ state: "completed", leaseToken: null, leaseExpiresAt: null, updatedAt: now }).where(and(
        eq(mcpEffectIntentions.workspaceId, task.workspaceId), eq(mcpEffectIntentions.id, task.intentionId), eq(mcpEffectIntentions.state, "unknown"),
      ));
    } else if (observation.outcome === "not_found") {
      await repository.markNotFound({ workspaceId: task.workspaceId, reconciliationId: task.reconciliationId, leaseToken: lease.leaseToken, now, terminal: true });
      await this.database.update(mcpEffectIntentions).set({ state: "completed", leaseToken: null, leaseExpiresAt: null, updatedAt: now }).where(and(
        eq(mcpEffectIntentions.workspaceId, task.workspaceId), eq(mcpEffectIntentions.id, task.intentionId), eq(mcpEffectIntentions.state, "unknown"),
      ));
    } else if (observation.outcome === "ambiguous") {
      await repository.markAmbiguous({ workspaceId: task.workspaceId, reconciliationId: task.reconciliationId, leaseToken: lease.leaseToken, now, candidateCount: observation.candidateCount });
    } else {
      await repository.markError({ workspaceId: task.workspaceId, reconciliationId: task.reconciliationId, leaseToken: lease.leaseToken, now, code: observation.code ?? "ADAPTER_UNAVAILABLE", terminal: true });
    }
  }
}

export const PostgresMcpEffectAttemptRepository = PostgresMcpExternalEffectAttemptRepository;
export const PostgresMcpGovernedEffectAttemptRepository = PostgresMcpExternalEffectAttemptRepository;

async function lockIdentity(tx: DatabaseExecutor, input: ExternalEffectAttemptIdentity, now: Date, options: { readonly allowTerminalReplay?: boolean } = {}) {
  const workspace = (await tx.select({ id: workspaces.id, status: workspaces.status, deletedAt: workspaces.deletedAt }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).for("update").limit(1))[0];
  if (!workspace || workspace.status !== "active" || workspace.deletedAt) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_WORKSPACE_UNAVAILABLE");
  const proposal = (await tx.select().from(mcpEffectProposals).where(and(eq(mcpEffectProposals.workspaceId, input.workspaceId), eq(mcpEffectProposals.id, input.proposalId))).for("update").limit(1))[0];
  if (!proposal || proposal.kind !== input.kind || proposal.aggregateId !== input.aggregateId || proposal.correlationId !== input.correlationId) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_BINDING_CONFLICT");
  const intention = (await tx.select().from(mcpEffectIntentions).where(and(eq(mcpEffectIntentions.workspaceId, input.workspaceId), eq(mcpEffectIntentions.id, input.intentionId), eq(mcpEffectIntentions.proposalId, input.proposalId), eq(mcpEffectIntentions.jobId, input.jobId))).for("update").limit(1))[0];
  if (!intention || intention.kind !== input.kind || intention.aggregateId !== input.aggregateId || intention.correlationId !== input.correlationId) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_BINDING_CONFLICT");
  const job = (await tx.select().from(jobs).where(and(eq(jobs.workspaceId, input.workspaceId), eq(jobs.id, input.jobId))).for("update").limit(1))[0];
  if (!options.allowTerminalReplay) assertJobLease(job, input, now);
  return { workspace, proposal, intention, job };
}

async function lockAttemptAggregate(tx: DatabaseExecutor, kind: McpGovernedEffectKind, workspaceId: string, aggregateId: string, now: Date): Promise<void> {
  if (kind === "conversation_reply") {
    const row = (await tx.select({ id: conversations.id, status: conversations.status }).from(conversations).where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, aggregateId))).for("update").limit(1))[0];
    if (!row || row.status === "deleted") throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_SOURCE_STALE");
    return;
  }
  if (kind === "content_publication") {
    const row = (await tx.select({ id: contentPublications.id, status: contentPublications.status }).from(contentPublications).where(and(eq(contentPublications.workspaceId, workspaceId), eq(contentPublications.id, aggregateId))).for("update").limit(1))[0];
    if (!row || (row.status !== "scheduled" && row.status !== "retry")) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_SOURCE_STALE");
    return;
  }
  if (kind === "meeting_proposal") {
    const row = (await tx.select({ id: meetingProposals.id, status: meetingProposals.status, expiresAt: meetingProposals.expiresAt }).from(meetingProposals).where(and(eq(meetingProposals.workspaceId, workspaceId), eq(meetingProposals.id, aggregateId))).for("update").limit(1))[0];
    if (!row || row.status !== "offered" || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt <= now) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_SOURCE_STALE");
    return;
  }
  const row = (await tx.select({ id: campaigns.id, archivedAt: campaigns.archivedAt }).from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, aggregateId))).for("update").limit(1))[0];
  if (!row || row.archivedAt) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_SOURCE_STALE");
}

function assertJobLease(job: Awaited<ReturnType<typeof lockIdentity>>["job"], input: ExternalEffectAttemptIdentity, now: Date): void {
  if (!job || job.type !== JOB_TYPE || job.status !== "running" || !job.lockedUntil || job.lockedUntil <= now || !job.lockedBy || input.jobLeaseOwner !== undefined && job.lockedBy !== input.jobLeaseOwner) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_JOB_LEASE_INVALID");
}

function assertStartedLease(rows: Awaited<ReturnType<typeof lockIdentity>>, input: ExternalEffectAttemptIdentity, now: Date): void {
  if (rows.proposal.status !== "accepted" || rows.intention.state !== "started" || rows.intention.leaseToken !== input.leaseToken || !rows.intention.leaseExpiresAt || rows.intention.leaseExpiresAt.getTime() !== input.leaseExpiresAt.getTime() || rows.intention.leaseExpiresAt <= now) {
    throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_LEASE_LOST");
  }
}

function assertIdentity(input: ExternalEffectAttemptIdentity): void {
  for (const value of [input.workspaceId, input.proposalId, input.intentionId, input.jobId, input.aggregateId, input.correlationId, input.leaseToken]) assertUuid(value, "MCP_EFFECT_ATTEMPT_ID_INVALID");
  if (input.jobLeaseOwner !== undefined && (typeof input.jobLeaseOwner !== "string" || input.jobLeaseOwner.length < 1 || input.jobLeaseOwner.length > 180)) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_INPUT_INVALID");
  if (!KINDS.has(input.kind) || !(input.leaseExpiresAt instanceof Date) || !Number.isFinite(input.leaseExpiresAt.getTime())) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_ATTEMPT_INPUT_INVALID");
}

function normalizeReadOnlyInput(input: ExternalEffectReadOnlyInput): ExternalEffectReadOnlyInput {
  for (const value of [input.workspaceId, input.proposalId, input.intentionId, input.aggregateId, input.correlationId, input.reconciliationId]) assertUuid(value, "MCP_EFFECT_RECONCILIATION_INPUT_INVALID");
  if (!KINDS.has(input.kind)) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_RECONCILIATION_INPUT_INVALID");
  return { ...input, criteriaSnapshot: redactReconciliationJson(input.criteriaSnapshot) };
}

function normalizeOutcome(input: ExternalEffectOutcomeInput): { outcome: "delivered" | "failed" | "unknown"; code: string } {
  const code = input.code ?? (input.outcome === "delivered" ? "DELIVERED" : input.outcome === "failed" ? "EFFECT_FAILED" : "EFFECT_UNKNOWN");
  if (!SAFE_CODE.test(code)) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_OUTCOME_CODE_INVALID");
  if (input.outcome !== "delivered" && input.outcome !== "failed" && input.outcome !== "unknown") throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_OUTCOME_INVALID");
  return { outcome: input.outcome, code };
}

function normalizeReadOnlyResult(result: ExternalEffectReadOnlyResult): ExternalEffectReadOnlyResult {
  if (!result || typeof result !== "object") return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
  if (result.outcome === "matched") {
    if (result.authoritative !== true || result.candidateCount !== 1) return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
    const redacted = redactReconciliationJson(result.result);
    if (Object.keys(redacted).length === 0) return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
    return { outcome: "matched", authoritative: true, candidateCount: 1, result: redacted };
  }
  if (result.outcome === "not_found") return { outcome: "not_found", candidateCount: 0 };
  if (result.outcome === "ambiguous") {
    if (!Number.isSafeInteger(result.candidateCount) || result.candidateCount < 2 || result.candidateCount > 1_000_000) return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
    return { outcome: "ambiguous", candidateCount: result.candidateCount };
  }
  if (result.outcome === "error") return { outcome: "error", code: typeof result.code === "string" && SAFE_CODE.test(result.code) ? result.code : "ADAPTER_UNAVAILABLE" };
  return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
}

function redactResult(value: unknown): Record<string, unknown> {
  const result = redactReconciliationJson(value);
  if (new TextEncoder().encode(canonicalJson(result)).byteLength > MAX_RESULT_BYTES) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_RESULT_TOO_LARGE");
  if (Object.keys(result).length === 0) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_RESULT_INVALID");
  return result;
}

async function ensureReconciliation(tx: DatabaseExecutor, input: ExternalEffectAttemptIdentity, now: Date, result: Record<string, unknown> = {}): Promise<string> {
  const existing = (await tx.select({ id: mcpEffectReconciliations.id }).from(mcpEffectReconciliations).where(and(eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.proposalId, input.proposalId))).for("update").limit(1))[0];
  if (existing) return existing.id;
  const [created] = await tx.insert(mcpEffectReconciliations).values({
    workspaceId: input.workspaceId, proposalId: input.proposalId, status: "pending",
    criteriaSnapshot: {
      proposalId: input.proposalId,
      kind: input.kind,
      aggregateId: input.aggregateId,
      ...(typeof result.providerPostId === "string" ? { providerPostId: result.providerPostId } : {}),
    },
    attempts: 0, maxAttempts: 5, nextAttemptAt: now, candidateCount: 0, createdAt: now, updatedAt: now,
  }).returning({ id: mcpEffectReconciliations.id });
  if (!created) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_RECONCILIATION_CREATE_FAILED");
  return created.id;
}

async function nextSequence(tx: DatabaseExecutor, workspaceId: string, proposalId: string): Promise<number> {
  const rows = await tx.select({ sequence: max(mcpEffectTraces.sequence) }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, proposalId)));
  return Number(rows[0]?.sequence ?? 0) + 1;
}

function assertReplayOutcome(payload: unknown, result: { outcome: string; code: string }, input: ExternalEffectOutcomeInput, redactedResult: Record<string, unknown>): void {
  if (!payload || typeof payload !== "object") throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_OUTCOME_REPLAY_CONFLICT");
  const existing = payload as { status?: unknown; code?: unknown; result?: unknown };
  if (existing.status !== result.outcome || existing.code !== result.code || (input.outcome === "delivered" && input.authoritative !== true)) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_OUTCOME_REPLAY_CONFLICT");
  // Idempotent replays must describe the same durable outcome for every
  // terminal state, including unknown.  Otherwise an ambiguous first result
  // could be silently rebound to different evidence on a later retry.
  const existingResult = existing.result === undefined ? {} : existing.result;
  if (canonicalJson(existingResult) !== canonicalJson(redactedResult)) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_OUTCOME_REPLAY_CONFLICT");
}

function readAttempt(payload: unknown): number {
  if (payload && typeof payload === "object" && Number.isInteger((payload as { attempt?: unknown }).attempt)) return (payload as { attempt: number }).attempt;
  return 1;
}

function readReconciliationId(payload: unknown): string | null {
  if (payload && typeof payload === "object" && typeof (payload as { reconciliationId?: unknown }).reconciliationId === "string") return (payload as { reconciliationId: string }).reconciliationId;
  return null;
}

function assertUuid(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new McpExternalEffectAttemptRepositoryError(code);
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 0 || value > MAX_LIMIT) throw new McpExternalEffectAttemptRepositoryError("MCP_EFFECT_RECOVERY_LIMIT_INVALID");
  return value;
}

const KINDS = new Set<McpGovernedEffectKind>(["conversation_reply", "content_publication", "meeting_proposal", "campaign_activation"]);

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
