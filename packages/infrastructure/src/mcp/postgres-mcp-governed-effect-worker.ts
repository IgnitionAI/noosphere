import { and, eq, sql } from "drizzle-orm";
import type { ExternalEffectPolicy, McpEffectProposal, McpGovernedEffectKind } from "@outbound/application/mcp/mcp-governed-effects";
import type {
  ExternalEffectAttemptIdentity,
  ExternalEffectAttemptPort,
  ExternalEffectExecutor,
} from "@outbound/application/mcp/external-effect-attempt";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";
import type { JobQueue } from "@outbound/application/jobs/job-queue";
import type { Database, DatabaseExecutor } from "@outbound/infrastructure/database/client";
import {
  approvalItems,
  campaigns,
  contentPublications,
  conversations,
  jobs,
  meetingProposals,
  mcpEffectIntentions,
  mcpEffectProposals,
  mcpEffectTraces,
  workspaces,
} from "@outbound/infrastructure/database/schema";

export const MCP_EXTERNAL_EFFECT_EXECUTE_JOB_TYPE = "mcp.external-effect.execute";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set<McpGovernedEffectKind>([
  "conversation_reply", "content_publication", "meeting_proposal", "campaign_activation",
]);
const POLICY_CODES = new Set([
  "OK", "CONTACT_SUPPRESSED", "HUMAN_REPLY_ARRIVED", "SOURCE_STALE", "CAMPAIGN_NOT_ACTIVE",
  "ACCOUNT_UNHEALTHY", "QUOTA_EXCEEDED", "ADAPTER_UNAVAILABLE", "POLICY_VERSION_UNSUPPORTED",
  "SCHEDULE_WINDOW_NOT_OPEN", "SCHEDULE_WINDOW_EXPIRED", "EFFECT_CANCELLED", "EFFECT_EXPIRED",
  "IDEMPOTENCY_CONFLICT",
]);

export class McpGovernedEffectWorkerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "McpGovernedEffectWorkerError";
  }
}

export interface McpExternalEffectJobPayload {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly intentionId: string;
  readonly kind: McpGovernedEffectKind;
  readonly aggregateId: string;
  readonly correlationId: string;
}

/** The queue lease is part of the trust boundary; callers cannot submit a bare payload. */
export interface McpExternalEffectLeasedJob {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly workspaceId: string;
  readonly payload: unknown;
  readonly lockedUntil: Date;
  readonly lockedBy: string;
}

/** Parse the worker envelope before any tenant lookup. Extra/provider fields are rejected. */
export function parseMcpExternalEffectJobPayload(value: unknown, workspaceId: string): McpExternalEffectJobPayload {
  if (!UUID.test(workspaceId) || !isRecord(value)) throw new McpGovernedEffectWorkerError("MCP_EFFECT_JOB_PAYLOAD_INVALID");
  const keys = Object.keys(value).sort();
  const expected = ["aggregateId", "correlationId", "intentionId", "kind", "proposalId", "workspaceId"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new McpGovernedEffectWorkerError("MCP_EFFECT_JOB_PAYLOAD_INVALID");
  }
  const payload = value as Record<string, unknown>;
  if (payload.workspaceId !== workspaceId) throw new McpGovernedEffectWorkerError("MCP_EFFECT_JOB_WORKSPACE_CONFLICT");
  if (!UUID.test(String(payload.proposalId)) || !UUID.test(String(payload.intentionId))
    || !UUID.test(String(payload.aggregateId)) || !UUID.test(String(payload.correlationId))
    || typeof payload.kind !== "string" || !KINDS.has(payload.kind as McpGovernedEffectKind)) {
    throw new McpGovernedEffectWorkerError("MCP_EFFECT_JOB_PAYLOAD_INVALID");
  }
  return {
    workspaceId,
    proposalId: payload.proposalId as string,
    intentionId: payload.intentionId as string,
    kind: payload.kind as McpGovernedEffectKind,
    aggregateId: payload.aggregateId as string,
    correlationId: payload.correlationId as string,
  };
}

/** The worker has no OAuth bearer; this synthetic principal is still tenant-bound. */
export function mcpEffectWorkerContext(workspaceId: string): McpExecutionContext {
  if (!UUID.test(workspaceId)) throw new McpGovernedEffectWorkerError("MCP_EFFECT_WORKSPACE_INVALID");
  return {
    userId: "mcp-effect-worker",
    workspaceId,
    clientId: "mcp-effect-worker",
    role: "owner",
    scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    audience: "internal",
  };
}

/** Final gate only: facts are re-read by ExternalEffectPolicy; no adapter/provider is reachable here. */
export async function evaluateMcpEffectFinalGate(
  policy: Pick<ExternalEffectPolicy, "final">,
  proposal: McpEffectProposal,
  context: McpExecutionContext,
): Promise<{ readonly decision: "allow" | "deny"; readonly code: string; readonly factsVersion: number }> {
  if (context.workspaceId !== proposal.workspaceId) {
    return { decision: "deny", code: "ADAPTER_UNAVAILABLE", factsVersion: 0 };
  }
  try {
    const result = await policy.final({ context, proposal, phase: "final" });
    const factsVersion = Number.isSafeInteger(result.factsVersion) && result.factsVersion >= 0 ? result.factsVersion : 0;
    const code = typeof result.code === "string" && POLICY_CODES.has(result.code) ? result.code : "ADAPTER_UNAVAILABLE";
    if ((result.decision !== "allow" && result.decision !== "deny") || factsVersion === 0 && result.decision === "allow") {
      return { decision: "deny", code: "ADAPTER_UNAVAILABLE", factsVersion };
    }
    return { decision: result.decision, code, factsVersion };
  } catch {
    return { decision: "deny", code: "ADAPTER_UNAVAILABLE", factsVersion: 0 };
  }
}

export type McpEffectWorkerOutcome =
  | { readonly outcome: "claimed"; readonly proposalId: string; readonly intentionId: string; readonly leaseToken: string; readonly leaseExpiresAt: Date; readonly code: string; readonly factsVersion: number }
  | { readonly outcome: "invalidated" | "policy_denied" | "already_claimed" | "already_completed"; readonly proposalId: string; readonly intentionId: string; readonly code: string; readonly factsVersion: number };

export interface McpGovernedEffectWorkerOptions {
  readonly now?: () => Date;
  readonly leaseMs?: number;
  /** Optional queue adapter used only to acknowledge terminal jobs. */
  readonly queue?: Pick<JobQueue, "acknowledge">;
  /** Durable attempt boundary. When provided, it is called only after claim. */
  readonly attemptPort?: ExternalEffectAttemptPort;
  /** Optional provider-neutral executor, invoked only after the attempt marker commits. */
  readonly executor?: ExternalEffectExecutor;
}

/**
 * Provider-free final worker boundary. It claims an existing durable intention
 * only; decideAndQueue remains the sole owner of intention/job/outbox creation.
 */
export class PostgresMcpGovernedEffectWorker {
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly queue: Pick<JobQueue, "acknowledge"> | undefined;
  private readonly attemptPort: ExternalEffectAttemptPort | undefined;
  private readonly executor: ExternalEffectExecutor | undefined;

  constructor(
    private readonly database: Database,
    private readonly policy: Pick<ExternalEffectPolicy, "final">,
    options: McpGovernedEffectWorkerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.leaseMs = Number.isSafeInteger(options.leaseMs) && (options.leaseMs ?? 0) > 0 ? options.leaseMs! : 60_000;
    this.queue = options.queue;
    this.attemptPort = options.attemptPort;
    this.executor = options.executor;
  }

  /** Claim first, then cross the durable attempt boundary before any executor. */
  async process(job: McpExternalEffectLeasedJob): Promise<McpEffectWorkerOutcome> {
    const result = await this.claim(job);
    if (result.outcome !== "claimed" || !this.attemptPort) {
      if (result.outcome !== "claimed" && this.queue) await this.queue.acknowledge(job.id, job.lockedBy, this.now());
      return result;
    }

    const payload = parseMcpExternalEffectJobPayload(job.payload, job.workspaceId);
    const identity: ExternalEffectAttemptIdentity = {
      workspaceId: payload.workspaceId,
      proposalId: payload.proposalId,
      intentionId: payload.intentionId,
      jobId: job.id,
      kind: payload.kind,
      aggregateId: payload.aggregateId,
      correlationId: payload.correlationId,
      leaseToken: result.leaseToken,
      leaseExpiresAt: result.leaseExpiresAt,
      jobLeaseOwner: job.lockedBy,
    };
    const marker = await this.attemptPort.recordBeforeProvider(identity);
    let outcome;
    if (!this.executor) {
      outcome = { outcome: "failed" as const, code: "ADAPTER_UNAVAILABLE" };
    } else {
      try {
        outcome = await this.executor({ identity, marker });
      } catch {
        // A thrown/ambiguous adapter result is never retried as a mutation.
        outcome = { outcome: "unknown" as const, code: "EFFECT_EXECUTOR_AMBIGUOUS" };
      }
    }
    await this.attemptPort.recordOutcome({ ...identity, ...outcome });
    if (this.queue) await this.queue.acknowledge(job.id, job.lockedBy, this.now());
    return terminal(
      payload,
      outcome.code ?? (outcome.outcome === "delivered" ? "DELIVERED" : outcome.outcome === "failed" ? "EFFECT_FAILED" : "EFFECT_UNKNOWN"),
      outcome.outcome === "failed" ? "invalidated" : outcome.outcome === "unknown" ? "invalidated" : "already_completed",
      result.factsVersion,
    );
  }

  async claim(job: McpExternalEffectLeasedJob): Promise<McpEffectWorkerOutcome> {
    const now = this.now();
    validateLeasedJob(job, now);
    let payload: McpExternalEffectJobPayload;
    try {
      payload = parseMcpExternalEffectJobPayload(job.payload, job.workspaceId);
    } catch {
      // A queue caller may not turn malformed/foreign envelopes into a retryable
      // business outcome: they are invalid leases and must never be acknowledged.
      throw new McpGovernedEffectWorkerError("MCP_EFFECT_JOB_LEASE_INVALID");
    }
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    const workerContext = mcpEffectWorkerContext(payload.workspaceId);
    return this.database.transaction(async (tx) => {
      const workspace = (await tx.select({ id: workspaces.id, status: workspaces.status, deletedAt: workspaces.deletedAt })
        .from(workspaces).where(eq(workspaces.id, payload.workspaceId)).for("update").limit(1))[0];
      if (!workspace || workspace.status !== "active" || workspace.deletedAt) return terminal(payload, "MCP_EFFECT_WORKSPACE_UNAVAILABLE");

      // Lock order is deliberately workspace -> proposal -> approval -> aggregate.
      const proposal = (await tx.select().from(mcpEffectProposals).where(and(
        eq(mcpEffectProposals.workspaceId, payload.workspaceId), eq(mcpEffectProposals.id, payload.proposalId),
      )).for("update").limit(1))[0];
      if (!proposal || proposal.kind !== payload.kind || proposal.aggregateId !== payload.aggregateId || proposal.correlationId !== payload.correlationId) {
        return terminal(payload, "MCP_EFFECT_JOB_BINDING_CONFLICT");
      }
      const approval = proposal.approvalItemId
        ? (await tx.select().from(approvalItems).where(and(eq(approvalItems.workspaceId, payload.workspaceId), eq(approvalItems.id, proposal.approvalItemId))).for("update").limit(1))[0]
        : undefined;
      if (!approval || approval.itemType !== "mcp_external_effect" || approval.proposalId !== proposal.id) return terminal(payload, "MCP_EFFECT_APPROVAL_UNAVAILABLE");
      if (proposal.status === "queued" && approval.status !== "approved") return terminal(payload, "MCP_EFFECT_APPROVAL_UNAVAILABLE");
      const storedLease = (await tx.select({ id: jobs.id, workspaceId: jobs.workspaceId, type: jobs.type, status: jobs.status, lockedBy: jobs.lockedBy, lockedUntil: jobs.lockedUntil })
        .from(jobs).where(and(eq(jobs.workspaceId, payload.workspaceId), eq(jobs.id, job.id))).limit(1))[0];
      assertStoredLease(storedLease, job, now);
      // Fast replay check is deliberately read-only. The locked recheck below
      // remains authoritative for races, while terminal replays do not touch a
      // deleted/cancelled aggregate again.
      const replayIntention = (await tx.select({ id: mcpEffectIntentions.id, kind: mcpEffectIntentions.kind, aggregateId: mcpEffectIntentions.aggregateId, state: mcpEffectIntentions.state })
        .from(mcpEffectIntentions).where(and(eq(mcpEffectIntentions.workspaceId, payload.workspaceId), eq(mcpEffectIntentions.id, payload.intentionId), eq(mcpEffectIntentions.proposalId, payload.proposalId), eq(mcpEffectIntentions.jobId, job.id))).limit(1))[0];
      if (replayIntention && replayIntention.kind === payload.kind && replayIntention.aggregateId === payload.aggregateId) {
        if (replayIntention.state === "completed") return terminal(payload, "MCP_EFFECT_ALREADY_COMPLETED", "already_completed");
        if (proposal.status === "accepted" && replayIntention.state === "started") return terminal(payload, "MCP_EFFECT_ALREADY_CLAIMED", "already_claimed");
      }
      try {
        await lockAggregate(tx, payload.kind, payload.workspaceId, payload.aggregateId, now);
      } catch (error) {
        if (error instanceof McpGovernedEffectWorkerError && error.code === "MCP_EFFECT_SOURCE_STALE") {
          const [invalidatedIntention] = await tx.update(mcpEffectIntentions).set({ state: "completed", leaseToken: null, leaseExpiresAt: null, updatedAt: now }).where(and(
            eq(mcpEffectIntentions.workspaceId, payload.workspaceId), eq(mcpEffectIntentions.id, payload.intentionId),
            eq(mcpEffectIntentions.proposalId, payload.proposalId), eq(mcpEffectIntentions.state, "queued"),
          )).returning({ id: mcpEffectIntentions.id });
          if (invalidatedIntention) {
            await tx.update(approvalItems).set({ status: "invalidated", invalidationReason: "SOURCE_STALE", updatedAt: now }).where(and(
              eq(approvalItems.workspaceId, payload.workspaceId), eq(approvalItems.id, approval.id), eq(approvalItems.status, "approved"),
            ));
            const [invalidatedProposal] = await tx.update(mcpEffectProposals).set({
              status: "invalidated", policyFinal: { decision: "deny", code: "SOURCE_STALE", factsVersion: 0, phase: "final" }, version: proposal.version + 1, updatedAt: now,
            }).where(and(eq(mcpEffectProposals.workspaceId, payload.workspaceId), eq(mcpEffectProposals.id, proposal.id), eq(mcpEffectProposals.version, proposal.version))).returning();
            if (invalidatedProposal) await appendPolicyTrace(tx, proposal, { decision: "deny", code: "SOURCE_STALE", factsVersion: 0 }, now);
          }
          return terminal(payload, "SOURCE_STALE");
        }
        throw error;
      }
      const storedJob = (await tx.select({ id: jobs.id, type: jobs.type, status: jobs.status, lockedBy: jobs.lockedBy, lockedUntil: jobs.lockedUntil })
        .from(jobs).where(and(eq(jobs.workspaceId, payload.workspaceId), eq(jobs.id, job.id))).for("update").limit(1))[0];
      assertStoredLease(storedJob, job, now);
      const intention = (await tx.select().from(mcpEffectIntentions).where(and(
        eq(mcpEffectIntentions.workspaceId, payload.workspaceId), eq(mcpEffectIntentions.id, payload.intentionId),
        eq(mcpEffectIntentions.proposalId, payload.proposalId), eq(mcpEffectIntentions.jobId, job.id),
      )).for("update").limit(1))[0];
      const boundIntention = intention;
      if (!boundIntention || boundIntention.kind !== payload.kind || boundIntention.aggregateId !== payload.aggregateId) return terminal(payload, "MCP_EFFECT_INTENTION_UNAVAILABLE");
      if (boundIntention.state === "completed") return terminal(payload, "MCP_EFFECT_ALREADY_COMPLETED", "already_completed");
      if (boundIntention.state !== "queued") return terminal(payload, "MCP_EFFECT_ALREADY_CLAIMED", "already_claimed");
      if (proposal.status !== "queued") return terminal(payload, "MCP_EFFECT_DECISION_CONFLICT");
      const policyProposal = {
        proposalId: proposal.id, workspaceId: proposal.workspaceId, kind: proposal.kind as McpGovernedEffectKind,
        status: proposal.status as McpEffectProposal["status"], approvalItemId: proposal.approvalItemId,
        correlationId: proposal.correlationId, version: proposal.version, revision: proposal.revision,
        sourceVersion: proposal.sourceVersion, createdAt: proposal.createdAt.toISOString(), updatedAt: proposal.updatedAt.toISOString(),
        aggregateId: proposal.aggregateId, intentSnapshot: proposal.intentSnapshot, sourceSnapshot: proposal.sourceSnapshot,
        ...(proposal.policyPreview === null ? {} : { policyPreview: proposal.policyPreview }),
        ...(proposal.policyFinal === null ? {} : { policyFinal: proposal.policyFinal }),
      } as McpEffectProposal;
      const gate = await evaluateMcpEffectFinalGate(this.policy, policyProposal, workerContext);
      if (gate.decision === "deny") {
        await tx.update(mcpEffectIntentions).set({ state: "completed", leaseToken: null, leaseExpiresAt: null, updatedAt: now }).where(and(eq(mcpEffectIntentions.workspaceId, payload.workspaceId), eq(mcpEffectIntentions.id, boundIntention.id), eq(mcpEffectIntentions.state, "queued")));
        await tx.update(approvalItems).set({ status: "invalidated", invalidationReason: gate.code, updatedAt: now }).where(and(eq(approvalItems.workspaceId, payload.workspaceId), eq(approvalItems.id, approval.id), eq(approvalItems.status, "approved")));
        const [updatedProposal] = await tx.update(mcpEffectProposals).set({ status: gate.code === "ADAPTER_UNAVAILABLE" || gate.code === "SOURCE_STALE" ? "invalidated" : "policy_denied", policyFinal: { decision: "deny", code: gate.code, factsVersion: gate.factsVersion, phase: "final" }, version: proposal.version + 1, updatedAt: now }).where(and(eq(mcpEffectProposals.workspaceId, payload.workspaceId), eq(mcpEffectProposals.id, proposal.id), eq(mcpEffectProposals.version, proposal.version))).returning();
        if (!updatedProposal) throw new McpGovernedEffectWorkerError("MCP_EFFECT_VERSION_CONFLICT");
        await appendPolicyTrace(tx, proposal, gate, now);
        return terminal(payload, gate.code, gate.code === "ADAPTER_UNAVAILABLE" || gate.code === "SOURCE_STALE" ? "invalidated" : "policy_denied", gate.factsVersion);
      }
      const leaseToken = crypto.randomUUID();
      const [startedIntention] = await tx.update(mcpEffectIntentions).set({ state: "started", leaseToken, leaseExpiresAt, updatedAt: now }).where(and(eq(mcpEffectIntentions.workspaceId, payload.workspaceId), eq(mcpEffectIntentions.id, boundIntention.id), eq(mcpEffectIntentions.state, "queued"))).returning({ id: mcpEffectIntentions.id });
      if (!startedIntention) return terminal(payload, "MCP_EFFECT_ALREADY_CLAIMED", "already_claimed");
      const [acceptedProposal] = await tx.update(mcpEffectProposals).set({ status: "accepted", policyFinal: { decision: "allow", code: gate.code, factsVersion: gate.factsVersion, phase: "final" }, version: proposal.version + 1, updatedAt: now }).where(and(eq(mcpEffectProposals.workspaceId, payload.workspaceId), eq(mcpEffectProposals.id, proposal.id), eq(mcpEffectProposals.version, proposal.version))).returning();
      if (!acceptedProposal) throw new McpGovernedEffectWorkerError("MCP_EFFECT_VERSION_CONFLICT");
      await appendPolicyTrace(tx, proposal, gate, now);
      return { outcome: "claimed", proposalId: payload.proposalId, intentionId: payload.intentionId, leaseToken, leaseExpiresAt, code: gate.code, factsVersion: gate.factsVersion };
    });
  }
}

export const McpGovernedEffectWorker = PostgresMcpGovernedEffectWorker;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function terminal(payload: McpExternalEffectJobPayload, code: string, outcome: McpEffectWorkerOutcome["outcome"] = "invalidated", factsVersion = 0): McpEffectWorkerOutcome {
  return { outcome: outcome as "invalidated" | "policy_denied" | "already_claimed" | "already_completed", proposalId: payload.proposalId, intentionId: payload.intentionId, code, factsVersion };
}

function validateLeasedJob(job: McpExternalEffectLeasedJob, now: Date): void {
  if (!isRecord(job) || !UUID.test(String(job.id)) || job.type !== MCP_EXTERNAL_EFFECT_EXECUTE_JOB_TYPE || job.status !== "running"
    || typeof job.lockedBy !== "string" || !job.lockedBy || !(job.lockedUntil instanceof Date) || !Number.isFinite(job.lockedUntil.getTime()) || job.lockedUntil.getTime() <= now.getTime()) {
    throw new McpGovernedEffectWorkerError("MCP_EFFECT_JOB_LEASE_INVALID");
  }
}

function assertStoredLease(
  stored: { readonly id: string; readonly workspaceId?: string; readonly type: string; readonly status: string; readonly lockedBy: string | null; readonly lockedUntil: Date | null } | undefined,
  incoming: McpExternalEffectLeasedJob,
  now: Date,
): asserts stored is { readonly id: string; readonly workspaceId?: string; readonly type: string; readonly status: string; readonly lockedBy: string; readonly lockedUntil: Date } {
  if (!stored || stored.id !== incoming.id || stored.workspaceId !== undefined && stored.workspaceId !== incoming.workspaceId
    || stored.type !== MCP_EXTERNAL_EFFECT_EXECUTE_JOB_TYPE || stored.status !== "running"
    || stored.lockedBy !== incoming.lockedBy || !stored.lockedUntil
    || stored.lockedUntil.getTime() !== incoming.lockedUntil.getTime() || stored.lockedUntil.getTime() <= now.getTime()) {
    throw new McpGovernedEffectWorkerError("MCP_EFFECT_JOB_LEASE_INVALID");
  }
}

async function lockAggregate(tx: DatabaseExecutor, kind: McpGovernedEffectKind, workspaceId: string, aggregateId: string, now: Date): Promise<void> {
  if (kind === "conversation_reply") {
    const row = (await tx.select({ id: conversations.id, status: conversations.status, contactId: conversations.contactId }).from(conversations).where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, aggregateId))).for("update").limit(1))[0];
    if (!row || row.status === "deleted") throw new McpGovernedEffectWorkerError("MCP_EFFECT_SOURCE_STALE");
    return;
  }
  if (kind === "content_publication") {
    const row = (await tx.select({ id: contentPublications.id, status: contentPublications.status }).from(contentPublications).where(and(eq(contentPublications.workspaceId, workspaceId), eq(contentPublications.id, aggregateId))).for("update").limit(1))[0];
    if (!row) throw new McpGovernedEffectWorkerError("MCP_EFFECT_SOURCE_STALE");
    return;
  }
  if (kind === "meeting_proposal") {
    const row = (await tx.select({ id: meetingProposals.id, status: meetingProposals.status, expiresAt: meetingProposals.expiresAt }).from(meetingProposals).where(and(eq(meetingProposals.workspaceId, workspaceId), eq(meetingProposals.id, aggregateId))).for("update").limit(1))[0];
    if (!row || row.status !== "offered" || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt.getTime() <= now.getTime()) throw new McpGovernedEffectWorkerError("MCP_EFFECT_SOURCE_STALE");
    return;
  }
  const row = (await tx.select({ id: campaigns.id, status: campaigns.status, archivedAt: campaigns.archivedAt }).from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, aggregateId))).for("update").limit(1))[0];
  if (!row || row.archivedAt) throw new McpGovernedEffectWorkerError("MCP_EFFECT_SOURCE_STALE");
}

async function appendPolicyTrace(tx: DatabaseExecutor, proposal: { id: string; workspaceId: string; correlationId: string }, gate: { decision: string; code: string; factsVersion: number }, now: Date): Promise<void> {
  const existing = await tx.select({ sequence: mcpEffectTraces.sequence }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, proposal.workspaceId), eq(mcpEffectTraces.proposalId, proposal.id))).orderBy(sql`${mcpEffectTraces.sequence} desc`).limit(1);
  const sequence = (existing[0]?.sequence ?? 0) + 1;
  await tx.insert(mcpEffectTraces).values({
    workspaceId: proposal.workspaceId, proposalId: proposal.id, stage: "policy", sequence,
    sourceEventId: crypto.randomUUID(), idempotencyKey: `worker-final:${proposal.id}:v1`, eventType: "McpEffectFinalPolicyEvaluated",
    redactedPayload: { decision: gate.decision, code: gate.code, factsVersion: gate.factsVersion, state: "started" },
    actor: null, correlationId: proposal.correlationId, createdAt: now,
  });
}
