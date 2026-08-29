import { and, asc, eq, gt, isNull, lte, max, notInArray, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { McpGovernedEffectStatus, McpReconciliationStatus } from "@outbound/application/mcp/mcp-governed-effects";
import { mapMcpReconciliationToProposalStatus } from "@outbound/application/mcp/mcp-governed-effects";
import type { Database, DatabaseExecutor } from "@outbound/infrastructure/database/client";
import { mcpEffectProposals, mcpEffectReconciliations, mcpEffectTraces } from "@outbound/infrastructure/database/schema";

export const RECONCILIATION_MAX_JSON_BYTES = 32_768;
const MAX_ATTEMPTS = 100;
const MAX_CANDIDATE_COUNT = 1_000_000;
const SAFE_CODE = /^[A-Z0-9_]{1,120}$/;
const SENSITIVE_NORMALIZED_KEYS = new Set([
  "provider", "providerpostid", "providerresponse", "responsebody", "rawresponse",
  "accesstoken", "refreshtoken", "token", "secret", "password", "credential",
  "authorization", "cookie", "header", "headers", "raw", "body", "text",
]);
const SENSITIVE_NORMALIZED_SUFFIXES = ["apikey", "privatekey", "accesstoken", "refreshtoken", "authorization", "credential", "password", "secret", "token"];
const MAX_REDACTION_DEPTH = 8;
const MAX_REDACTION_ITEMS = 100;

export class McpEffectReconciliationRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "McpEffectReconciliationRepositoryError";
  }
}

export interface McpEffectReconciliationRecord {
  readonly reconciliationId: string;
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly status: McpReconciliationStatus;
  readonly proposalStatus: McpGovernedEffectStatus;
  readonly criteriaSnapshot: Record<string, unknown>;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly nextAttemptAt: Date | null;
  readonly completedAt: Date | null;
  readonly candidateCount: number;
  readonly resultSnapshot: Record<string, unknown> | null;
  /** Alias used by callers that refer to the matched result as evidence. */
  readonly evidenceSnapshot: Record<string, unknown> | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface McpEffectReconciliationLease extends McpEffectReconciliationRecord {
  readonly leaseToken: string;
  readonly attempt: number;
}

export interface CreateOrGetReconciliationInput {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly criteriaSnapshot?: unknown;
  readonly maxAttempts?: number;
  readonly now?: Date;
}

export type ReconciliationLeaseInput = {
  readonly workspaceId: string;
  readonly reconciliationId: string;
  readonly leaseToken: string;
  readonly now?: Date;
};

export type ReconciliationMatchTraceInput = {
  readonly sourceEventId?: string;
  readonly idempotencyKey?: string;
};

export function prepareMatchedEvidence(input: {
  readonly authoritative?: boolean;
  readonly candidateCount?: number;
  readonly candidatesCount?: number;
  readonly result?: unknown;
}): Record<string, unknown> {
  if (input.authoritative !== true) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_MATCH_NOT_AUTHORITATIVE");
  const candidateCount = normalizeCandidateCount(input.candidateCount, input.candidatesCount);
  if (candidateCount !== 1) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_MATCH_NOT_UNIQUE");
  if (input.result === undefined || input.result === null) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_MATCH_EVIDENCE_REQUIRED");
  const result = redactReconciliationJson(input.result);
  if (Object.keys(result).length === 0) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_MATCH_EVIDENCE_REQUIRED");
  return JSON.parse(canonicalJson(result)) as Record<string, unknown>;
}

/** Stable JSON representation: object keys are recursively sorted, arrays retain their order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_SNAPSHOT_NON_FINITE_NUMBER");
  return JSON.stringify(value) ?? "null";
}

export function mapAttachedProposalStatus(
  reconciliationStatus: McpReconciliationStatus,
  currentProposalStatus: McpGovernedEffectStatus,
): McpGovernedEffectStatus {
  const mapped = mapMcpReconciliationToProposalStatus(reconciliationStatus);
  if (MCP_TERMINAL_PROPOSAL_STATUSES.has(currentProposalStatus)) return currentProposalStatus;
  return mapped;
}

const MCP_TERMINAL_PROPOSAL_STATUSES = new Set<McpGovernedEffectStatus>([
  "policy_denied", "delivered", "failed", "rejected", "invalidated",
]);

/** Persistence-only, provider-free reconciliation state machine for MCP effects. */
export class PostgresMcpEffectReconciliationRepository {
  constructor(private readonly database: Database, private readonly now: () => Date = () => new Date()) {}

  async createOrGet(input: CreateOrGetReconciliationInput): Promise<McpEffectReconciliationRecord> {
    assertWorkspaceAndId(input.workspaceId, input.proposalId, "MCP_RECONCILIATION_PROPOSAL_ID_INVALID");
    const criteriaSnapshot = redactReconciliationJson(input.criteriaSnapshot ?? {});
    const maxAttempts = input.maxAttempts ?? 5;
    assertMaxAttempts(maxAttempts);
    const now = input.now ?? this.now();
    return this.database.transaction(async (tx) => {
      const proposal = await lockedProposal(tx, input.workspaceId, input.proposalId);
      if (!proposal) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_PROPOSAL_NOT_FOUND");
      const existing = await tx.select().from(mcpEffectReconciliations).where(and(
        eq(mcpEffectReconciliations.workspaceId, input.workspaceId),
        eq(mcpEffectReconciliations.proposalId, input.proposalId),
      )).limit(1).for("update");
      if (existing[0]) {
        await syncProposalStatus(tx, input.workspaceId, input.proposalId, existing[0].status as McpReconciliationStatus, now);
        return toRecord(existing[0]);
      }
      const inserted = await tx.insert(mcpEffectReconciliations).values({
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        criteriaSnapshot,
        maxAttempts,
        status: "pending",
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      }).returning();
      const row = inserted[0];
      if (!row) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_CREATE_FAILED");
      await tx.update(mcpEffectProposals).set({ reconciliationId: row.id, status: mapAttachedProposalStatus("pending", proposal.status as McpGovernedEffectStatus), updatedAt: now }).where(and(
        eq(mcpEffectProposals.workspaceId, input.workspaceId),
        eq(mcpEffectProposals.id, input.proposalId),
      ));
      return toRecord(row);
    });
  }

  /** Attach an existing row, or create the one durable row for this proposal. */
  async attachProposal(input: CreateOrGetReconciliationInput & { readonly reconciliationId?: string }): Promise<McpEffectReconciliationRecord> {
    if (!input.reconciliationId) return this.createOrGet(input);
    const reconciliationId = input.reconciliationId;
    assertWorkspaceAndId(input.workspaceId, input.proposalId, "MCP_RECONCILIATION_PROPOSAL_ID_INVALID");
    assertUuid(reconciliationId, "MCP_RECONCILIATION_ID_INVALID");
    return this.database.transaction(async (tx) => {
      const proposal = await lockedProposal(tx, input.workspaceId, input.proposalId);
      if (!proposal) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_PROPOSAL_NOT_FOUND");
      const row = await tx.select().from(mcpEffectReconciliations).where(and(
        eq(mcpEffectReconciliations.workspaceId, input.workspaceId),
        eq(mcpEffectReconciliations.id, reconciliationId),
        eq(mcpEffectReconciliations.proposalId, input.proposalId),
      )).limit(1).for("update");
      if (!row[0]) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_NOT_FOUND");
      const now = input.now ?? this.now();
      await tx.update(mcpEffectProposals).set({ reconciliationId: row[0].id, status: mapAttachedProposalStatus(row[0].status as McpReconciliationStatus, proposal.status as McpGovernedEffectStatus), updatedAt: now }).where(and(
        eq(mcpEffectProposals.workspaceId, input.workspaceId), eq(mcpEffectProposals.id, input.proposalId),
      ));
      return toRecord(row[0]);
    });
  }

  async get(input: { readonly workspaceId: string; readonly reconciliationId: string }): Promise<McpEffectReconciliationRecord | null> {
    assertWorkspaceAndId(input.workspaceId, input.reconciliationId, "MCP_RECONCILIATION_ID_INVALID");
    const rows = await this.database.select().from(mcpEffectReconciliations).where(and(
      eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.id, input.reconciliationId),
    )).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async getByProposal(input: { readonly workspaceId: string; readonly proposalId: string }): Promise<McpEffectReconciliationRecord | null> {
    assertWorkspaceAndId(input.workspaceId, input.proposalId, "MCP_RECONCILIATION_PROPOSAL_ID_INVALID");
    const rows = await this.database.select().from(mcpEffectReconciliations).where(and(
      eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.proposalId, input.proposalId),
    )).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listDue(input: { readonly workspaceId?: string; readonly now: Date; readonly limit?: number }): Promise<readonly McpEffectReconciliationRecord[]> {
    if (input.workspaceId !== undefined) assertUuid(input.workspaceId, "MCP_RECONCILIATION_WORKSPACE_ID_INVALID");
    const limit = normalizeLimit(input.limit);
    if (limit === 0) return [];
    const due = or(
      and(eq(mcpEffectReconciliations.status, "pending"), lte(mcpEffectReconciliations.nextAttemptAt, input.now)),
      and(eq(mcpEffectReconciliations.status, "error"), lte(mcpEffectReconciliations.nextAttemptAt, input.now)),
      and(eq(mcpEffectReconciliations.status, "searching"), lte(mcpEffectReconciliations.leaseExpiresAt, input.now)),
    );
    const rows = await this.database.select().from(mcpEffectReconciliations).where(and(
      isNull(mcpEffectReconciliations.completedAt), due, ...(input.workspaceId ? [eq(mcpEffectReconciliations.workspaceId, input.workspaceId)] : []),
    )).orderBy(
      asc(sql`case when ${mcpEffectReconciliations.status} = 'searching' then ${mcpEffectReconciliations.leaseExpiresAt} else ${mcpEffectReconciliations.nextAttemptAt} end`),
      asc(mcpEffectReconciliations.status),
      asc(mcpEffectReconciliations.id),
    ).limit(limit);
    return rows.map(toRecord);
  }

  async list(input: { readonly workspaceId?: string; readonly now: Date; readonly limit?: number }): Promise<readonly McpEffectReconciliationRecord[]> {
    return this.listDue(input);
  }

  async claim(input: { readonly workspaceId: string; readonly reconciliationId: string; readonly now: Date; readonly leaseMs: number }): Promise<McpEffectReconciliationLease | null> {
    assertWorkspaceAndId(input.workspaceId, input.reconciliationId, "MCP_RECONCILIATION_ID_INVALID");
    if (!Number.isFinite(input.leaseMs) || input.leaseMs <= 0 || input.leaseMs > 24 * 60 * 60_000) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_LEASE_INVALID");
    return this.database.transaction(async (tx) => {
      const ref = await tx.select({ proposalId: mcpEffectReconciliations.proposalId }).from(mcpEffectReconciliations).where(and(
        eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.id, input.reconciliationId),
      )).limit(1);
      if (!ref[0]) return null;
      const proposal = await lockedProposal(tx, input.workspaceId, ref[0].proposalId);
      if (!proposal) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_PROPOSAL_NOT_FOUND");
      const row = await lockedReconciliation(tx, input.workspaceId, input.reconciliationId);
      if (!row || row.completedAt || row.attempts >= row.maxAttempts) return null;
      const due = row.status === "searching" ? Boolean(row.leaseExpiresAt && row.leaseExpiresAt <= input.now) : Boolean(row.nextAttemptAt && row.nextAttemptAt <= input.now);
      if (!due || !["pending", "searching", "error"].includes(row.status)) return null;
      const leaseToken = crypto.randomUUID();
      const updated = await tx.update(mcpEffectReconciliations).set({
        status: "searching", attempts: row.attempts + 1, leaseToken, leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs), nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: input.now,
      }).where(and(eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.id, row.id))).returning();
      const claimed = updated[0];
      if (!claimed) return null;
      await tx.update(mcpEffectProposals).set({ status: mapAttachedProposalStatus("searching", proposal.status as McpGovernedEffectStatus), updatedAt: input.now }).where(and(eq(mcpEffectProposals.workspaceId, input.workspaceId), eq(mcpEffectProposals.id, row.proposalId)));
      return { ...toRecord(claimed), leaseToken, attempt: claimed.attempts };
    });
  }

  async claimPending(input: Parameters<PostgresMcpEffectReconciliationRepository["claim"]>[0]) { return this.claim(input); }
  async claimDue(input: Parameters<PostgresMcpEffectReconciliationRepository["claim"]>[0]) { return this.claim(input); }

  async heartbeat(input: ReconciliationLeaseInput & { readonly leaseMs: number }): Promise<boolean> {
    assertWorkspaceAndId(input.workspaceId, input.reconciliationId, "MCP_RECONCILIATION_ID_INVALID");
    assertUuid(input.leaseToken, "MCP_RECONCILIATION_LEASE_TOKEN_INVALID");
    if (!Number.isFinite(input.leaseMs) || input.leaseMs <= 0 || input.leaseMs > 24 * 60 * 60_000) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_LEASE_INVALID");
    const now = input.now ?? this.now();
    const updated = await this.database.update(mcpEffectReconciliations).set({ leaseExpiresAt: new Date(now.getTime() + input.leaseMs), updatedAt: now }).where(and(
      eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.id, input.reconciliationId), eq(mcpEffectReconciliations.status, "searching"), eq(mcpEffectReconciliations.leaseToken, input.leaseToken), gt(mcpEffectReconciliations.leaseExpiresAt, now)
    )).returning({ id: mcpEffectReconciliations.id });
    return Boolean(updated[0]);
  }

  async defer(input: ReconciliationLeaseInput & { readonly nextAttemptAt: Date }): Promise<void> {
    await this.finishLease(input, { status: "pending", nextAttemptAt: input.nextAttemptAt, completedAt: null, errorCode: null, errorMessage: null, candidateCount: 0 });
  }

  async markMatched(input: ReconciliationLeaseInput & ReconciliationMatchTraceInput & { readonly result?: unknown; readonly authoritative?: boolean; readonly candidateCount?: number; readonly candidatesCount?: number }): Promise<void> {
    const result = prepareMatchedEvidence(input);
    await this.finishLease(input, {
      status: "matched", nextAttemptAt: null, completedAt: input.now ?? this.now(), candidateCount: 1,
      resultSnapshot: result,
      resultTrace: { ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}), redactedPayload: result },
      errorCode: "RECONCILIATION_MATCHED", errorMessage: null,
    });
  }

  async markNotFound(input: ReconciliationLeaseInput & { readonly terminal?: boolean; readonly nextAttemptAt?: Date }): Promise<void> {
    const now = input.now ?? this.now();
    const terminal = input.terminal ?? true;
    await this.finishLease(input, { status: terminal ? "not_found" : "pending", nextAttemptAt: terminal ? null : (input.nextAttemptAt ?? new Date(now.getTime() + 300_000)), completedAt: terminal ? now : null, candidateCount: 0, errorCode: terminal ? "RECONCILIATION_NOT_FOUND" : null, errorMessage: terminal ? "No authoritative matching effect was observed." : null });
  }

  async markAmbiguous(input: ReconciliationLeaseInput & { readonly candidateCount?: number; readonly candidatesCount?: number }): Promise<void> {
    const candidateCount = normalizeCandidateCount(input.candidateCount, input.candidatesCount) ?? 0;
    assertCandidateCount(candidateCount);
    await this.finishLease(input, { status: "ambiguous", nextAttemptAt: null, completedAt: input.now ?? this.now(), candidateCount, errorCode: "RECONCILIATION_AMBIGUOUS", errorMessage: "Multiple candidate effects require manual resolution." });
  }

  async markError(input: ReconciliationLeaseInput & { readonly code?: string; readonly errorCode?: string; readonly terminal?: boolean; readonly nextAttemptAt?: Date }): Promise<void> {
    const now = input.now ?? this.now();
    const code = safeCode(input.code ?? input.errorCode ?? "RECONCILIATION_ERROR");
    const current = await this.get(input);
    if (!current) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_LEASE_LOST");
    const terminal = input.terminal ?? current.attempts >= current.maxAttempts;
    await this.finishLease(input, { status: "error", nextAttemptAt: terminal ? null : (input.nextAttemptAt ?? new Date(now.getTime() + 300_000)), completedAt: terminal ? now : null, candidateCount: 0, errorCode: terminal ? "RECONCILIATION_ERROR" : code, errorMessage: `Read-only reconciliation failed (${terminal ? "RECONCILIATION_ERROR" : code}).` });
  }

  async release(input: ReconciliationLeaseInput): Promise<boolean> {
    assertLeaseInput(input);
    const now = input.now ?? this.now();
    return this.database.transaction(async (tx) => {
      const ref = await tx.select({ proposalId: mcpEffectReconciliations.proposalId }).from(mcpEffectReconciliations).where(and(
        eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.id, input.reconciliationId),
      )).limit(1);
      if (!ref[0]) return false;
      const proposal = await lockedProposal(tx, input.workspaceId, ref[0].proposalId);
      if (!proposal) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_PROPOSAL_NOT_FOUND");
      const row = await lockedReconciliation(tx, input.workspaceId, input.reconciliationId);
      if (!row || row.status !== "searching" || row.leaseToken !== input.leaseToken) return false;
      const exhausted = row.attempts >= row.maxAttempts;
      await tx.update(mcpEffectReconciliations).set({
        status: exhausted ? "error" : "pending", leaseToken: null, leaseExpiresAt: null,
        nextAttemptAt: exhausted ? null : now, completedAt: exhausted ? now : null,
        errorCode: exhausted ? "RECONCILIATION_ATTEMPTS_EXHAUSTED" : null,
        errorMessage: exhausted ? "Reconciliation lease attempts exhausted; manual resolution required." : null,
        updatedAt: now,
      }).where(and(eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.id, input.reconciliationId), eq(mcpEffectReconciliations.status, "searching"), eq(mcpEffectReconciliations.leaseToken, input.leaseToken)));
      await tx.update(mcpEffectProposals).set({ status: mapAttachedProposalStatus(exhausted ? "error" : "pending", proposal.status as McpGovernedEffectStatus), updatedAt: now }).where(and(eq(mcpEffectProposals.workspaceId, input.workspaceId), eq(mcpEffectProposals.id, row.proposalId)));
      return true;
    });
  }

  async releaseLease(input: ReconciliationLeaseInput) { return this.release(input); }

  async recoverExpired(input: { readonly workspaceId?: string; readonly now: Date; readonly limit?: number }): Promise<number> {
    if (input.workspaceId !== undefined) assertUuid(input.workspaceId, "MCP_RECONCILIATION_WORKSPACE_ID_INVALID");
    const limit = normalizeLimit(input.limit);
    if (limit === 0) return 0;
    return this.database.transaction(async (tx) => {
      let recovered = 0;
      const seen = new Set<string>();
      while (recovered < limit) {
        const expired = await tx.select().from(mcpEffectReconciliations).where(and(
          eq(mcpEffectReconciliations.status, "searching"),
          lte(mcpEffectReconciliations.leaseExpiresAt, input.now),
          isNull(mcpEffectReconciliations.completedAt),
          ...(input.workspaceId ? [eq(mcpEffectReconciliations.workspaceId, input.workspaceId)] : []),
          ...(seen.size > 0 ? [notInArray(mcpEffectReconciliations.id, [...seen])] : []),
        )).orderBy(asc(mcpEffectReconciliations.leaseExpiresAt), asc(mcpEffectReconciliations.id)).limit(limit - recovered);
        if (expired.length === 0) break;
        for (const candidate of expired) {
          seen.add(candidate.id);
          // Keep the proposal → reconciliation lock order. SKIP LOCKED on both
          // rows lets concurrent recovery workers move on without waiting.
          const proposal = await lockedProposal(tx, candidate.workspaceId, candidate.proposalId, { skipLocked: true });
          if (!proposal) continue;
          const row = await lockedReconciliation(tx, candidate.workspaceId, candidate.id, { skipLocked: true });
          if (!row || row.status !== "searching" || !row.leaseToken || !row.leaseExpiresAt || row.leaseExpiresAt > input.now || row.completedAt) continue;
          const exhausted = row.attempts >= row.maxAttempts;
          const updated = await tx.update(mcpEffectReconciliations).set({
            status: exhausted ? "error" : "pending", leaseToken: null, leaseExpiresAt: null,
            nextAttemptAt: exhausted ? null : input.now, completedAt: exhausted ? input.now : null,
            errorCode: exhausted ? "RECONCILIATION_ATTEMPTS_EXHAUSTED" : null,
            errorMessage: exhausted ? "Reconciliation lease attempts exhausted; manual resolution required." : null,
            updatedAt: input.now,
          }).where(and(
            eq(mcpEffectReconciliations.workspaceId, row.workspaceId), eq(mcpEffectReconciliations.id, row.id),
            eq(mcpEffectReconciliations.status, "searching"), eq(mcpEffectReconciliations.leaseToken, row.leaseToken),
          )).returning({ id: mcpEffectReconciliations.id });
          if (!updated[0]) continue;
          await tx.update(mcpEffectProposals).set({ status: mapAttachedProposalStatus(exhausted ? "error" : "pending", proposal.status as McpGovernedEffectStatus), updatedAt: input.now }).where(and(eq(mcpEffectProposals.workspaceId, row.workspaceId), eq(mcpEffectProposals.id, row.proposalId)));
          recovered += 1;
          if (recovered >= limit) break;
        }
      }
      return recovered;
    });
  }

  private async finishLease(input: ReconciliationLeaseInput, values: { status: "pending" | "matched" | "not_found" | "ambiguous" | "error"; nextAttemptAt: Date | null; completedAt: Date | null; candidateCount: number; errorCode: string | null; errorMessage: string | null; resultSnapshot?: Record<string, unknown>; resultTrace?: { sourceEventId?: string; idempotencyKey?: string; redactedPayload: Record<string, unknown> } }): Promise<void> {
    assertLeaseInput(input);
    assertCandidateCount(values.candidateCount);
    const now = input.now ?? this.now();
    await this.database.transaction(async (tx) => {
      const { resultSnapshot, resultTrace: _resultTrace, ...reconciliationValues } = values;
      const ref = await tx.select({ proposalId: mcpEffectReconciliations.proposalId }).from(mcpEffectReconciliations).where(and(
        eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.id, input.reconciliationId),
      )).limit(1);
      if (!ref[0]) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_LEASE_LOST");
      const proposal = await lockedProposal(tx, input.workspaceId, ref[0].proposalId);
      if (!proposal) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_PROPOSAL_NOT_FOUND");
      const current = await lockedReconciliation(tx, input.workspaceId, input.reconciliationId);
      if (!current) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_LEASE_LOST");
      const leaseMatches = current.status === "searching" && current.leaseToken === input.leaseToken;
      if (!leaseMatches) {
        if (values.status === "matched" && current.status === "matched" && values.resultTrace) {
          if (!resultSnapshot || canonicalJson(current.resultSnapshot) !== canonicalJson(resultSnapshot)) {
            throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_TRACE_IDEMPOTENCY_CONFLICT");
          }
          await appendResultTrace(tx, {
            workspaceId: input.workspaceId, proposalId: current.proposalId,
            sourceEventId: values.resultTrace.sourceEventId ?? stableUuid(`mcp-reconciliation:${input.reconciliationId}:matched`),
            idempotencyKey: values.resultTrace.idempotencyKey ?? `reconciliation:${input.reconciliationId}:matched:v1`,
            redactedPayload: values.resultTrace.redactedPayload, correlationId: proposal.correlationId, createdAt: now,
          });
          return;
        }
        throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_LEASE_LOST");
      }
      const exhausted = current.attempts >= current.maxAttempts && (values.status === "pending" || values.status === "error");
      const finalValues = exhausted ? {
        ...reconciliationValues, status: "error" as const, nextAttemptAt: null, completedAt: now,
        errorCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED", errorMessage: "Reconciliation lease attempts exhausted; manual resolution required.",
      } : reconciliationValues;
      const rows = await tx.update(mcpEffectReconciliations).set({ ...finalValues, ...(resultSnapshot ? { resultSnapshot } : {}), leaseToken: null, leaseExpiresAt: null, updatedAt: now }).where(and(
        eq(mcpEffectReconciliations.workspaceId, input.workspaceId), eq(mcpEffectReconciliations.id, input.reconciliationId), eq(mcpEffectReconciliations.status, "searching"), eq(mcpEffectReconciliations.leaseToken, input.leaseToken),
      )).returning({ id: mcpEffectReconciliations.id, proposalId: mcpEffectReconciliations.proposalId });
      if (!rows[0]) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_LEASE_LOST");
      if (values.resultTrace) {
        await appendResultTrace(tx, {
          workspaceId: input.workspaceId, proposalId: rows[0].proposalId,
          sourceEventId: values.resultTrace.sourceEventId ?? stableUuid(`mcp-reconciliation:${input.reconciliationId}:matched`),
          idempotencyKey: values.resultTrace.idempotencyKey ?? `reconciliation:${input.reconciliationId}:matched:v1`,
          redactedPayload: values.resultTrace.redactedPayload,
          correlationId: proposal.correlationId, createdAt: now,
        });
      }
      await tx.update(mcpEffectProposals).set({ status: mapAttachedProposalStatus((exhausted ? "error" : values.status) as McpReconciliationStatus, proposal.status as McpGovernedEffectStatus), updatedAt: now }).where(and(
        eq(mcpEffectProposals.workspaceId, input.workspaceId), eq(mcpEffectProposals.id, rows[0].proposalId),
      ));
    });
  }
}

export function mapReconciliationProposalStatus(status: McpReconciliationStatus | null): McpGovernedEffectStatus {
  return mapMcpReconciliationToProposalStatus(status);
}

export function redactReconciliationJson(value: unknown): Record<string, unknown> {
  assertFiniteJsonNumbers(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_SNAPSHOT_INVALID");
  const sanitized = sanitizeObject(value as Record<string, unknown>, 0);
  const bytes = new TextEncoder().encode(JSON.stringify(sanitized)).byteLength;
  if (bytes > RECONCILIATION_MAX_JSON_BYTES) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_SNAPSHOT_TOO_LARGE");
  return sanitized;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_LIMIT_INVALID");
  return value;
}

function assertWorkspaceAndId(workspaceId: string, id: string, code: string): void {
  assertUuid(workspaceId, "MCP_RECONCILIATION_WORKSPACE_ID_INVALID");
  assertUuid(id, code);
}

function assertReconciliationIds(workspaceId: string, proposalId: string): void {
  assertWorkspaceAndId(workspaceId, proposalId, "MCP_RECONCILIATION_PROPOSAL_ID_INVALID");
}

function assertLeaseInput(input: ReconciliationLeaseInput): void {
  assertWorkspaceAndId(input.workspaceId, input.reconciliationId, "MCP_RECONCILIATION_ID_INVALID");
  assertUuid(input.leaseToken, "MCP_RECONCILIATION_LEASE_TOKEN_INVALID");
}

async function syncProposalStatus(executor: DatabaseExecutor, workspaceId: string, proposalId: string, reconciliationStatus: McpReconciliationStatus, now: Date): Promise<void> {
  await updateProposalStatus(executor, workspaceId, proposalId, reconciliationStatus, now);
}

function assertUuid(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new McpEffectReconciliationRepositoryError(code);
  }
}

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

async function updateProposalStatus(executor: DatabaseExecutor, workspaceId: string, proposalId: string, reconciliationStatus: McpReconciliationStatus, now: Date): Promise<void> {
  const proposal = await lockedProposal(executor, workspaceId, proposalId);
  if (!proposal) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_PROPOSAL_NOT_FOUND");
  const status = mapAttachedProposalStatus(reconciliationStatus, proposal.status as McpGovernedEffectStatus);
  if (status === proposal.status) return;
  await executor.update(mcpEffectProposals).set({ status, updatedAt: now }).where(and(
    eq(mcpEffectProposals.workspaceId, workspaceId), eq(mcpEffectProposals.id, proposalId),
  ));
}

async function appendResultTrace(executor: DatabaseExecutor, input: {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly sourceEventId: string;
  readonly idempotencyKey: string;
  readonly redactedPayload: Record<string, unknown>;
  readonly correlationId: string;
  readonly createdAt: Date;
}): Promise<void> {
  assertUuid(input.sourceEventId, "MCP_RECONCILIATION_TRACE_SOURCE_EVENT_INVALID");
  if (!input.idempotencyKey || input.idempotencyKey.length > 500) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_TRACE_IDEMPOTENCY_INVALID");
  const redactedPayload = JSON.parse(canonicalJson(input.redactedPayload)) as Record<string, unknown>;
  const existingResult = await executor.select().from(mcpEffectTraces).where(and(
    eq(mcpEffectTraces.workspaceId, input.workspaceId), eq(mcpEffectTraces.proposalId, input.proposalId),
    eq(mcpEffectTraces.stage, "result"), eq(mcpEffectTraces.eventType, "McpReconciliationMatched"),
  )).orderBy(asc(mcpEffectTraces.sequence)).limit(1);
  if (existingResult[0]) {
    if (existingResult[0].sourceEventId !== input.sourceEventId || existingResult[0].idempotencyKey !== input.idempotencyKey || existingResult[0].correlationId !== input.correlationId || canonicalJson(existingResult[0].redactedPayload) !== canonicalJson(redactedPayload)) {
      throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_TRACE_IDEMPOTENCY_CONFLICT");
    }
    return;
  }
  const existing = await executor.select().from(mcpEffectTraces).where(and(
    eq(mcpEffectTraces.workspaceId, input.workspaceId), eq(mcpEffectTraces.proposalId, input.proposalId), eq(mcpEffectTraces.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  if (existing[0]) {
    if (existing[0].stage !== "result" || existing[0].eventType !== "McpReconciliationMatched" || existing[0].sourceEventId !== input.sourceEventId || existing[0].correlationId !== input.correlationId || canonicalJson(existing[0].redactedPayload) !== canonicalJson(redactedPayload)) {
      throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_TRACE_IDEMPOTENCY_CONFLICT");
    }
    return;
  }
  const sourceEvent = await executor.select({ id: mcpEffectTraces.id }).from(mcpEffectTraces).where(and(
    eq(mcpEffectTraces.workspaceId, input.workspaceId), eq(mcpEffectTraces.sourceEventId, input.sourceEventId),
  )).limit(1);
  if (sourceEvent[0]) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_TRACE_SOURCE_EVENT_CONFLICT");
  const sequenceRows = await executor.select({ sequence: max(mcpEffectTraces.sequence) }).from(mcpEffectTraces).where(and(
    eq(mcpEffectTraces.workspaceId, input.workspaceId), eq(mcpEffectTraces.proposalId, input.proposalId),
  ));
  try {
    await executor.insert(mcpEffectTraces).values({
      workspaceId: input.workspaceId, proposalId: input.proposalId, stage: "result", sequence: Number(sequenceRows[0]?.sequence ?? 0) + 1,
      sourceEventId: input.sourceEventId, idempotencyKey: input.idempotencyKey, eventType: "McpReconciliationMatched",
      redactedPayload, actor: null, correlationId: input.correlationId, createdAt: input.createdAt,
    });
  } catch (error) {
    if (isUniqueViolationForConstraint(error, "mcp_effect_traces_source_event_uq")) {
      throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_TRACE_SOURCE_EVENT_CONFLICT");
    }
    throw error;
  }
}

function sanitizeObject(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (depth > MAX_REDACTION_DEPTH) return output;
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const nested = sanitizeObject(item as Record<string, unknown>, depth + 1);
      if (Object.keys(nested).length > 0) output[key] = nested;
    }
    else if (Array.isArray(item)) {
      const nestedItems: unknown[] = [];
      for (const part of item.slice(0, MAX_REDACTION_ITEMS)) {
        if (part === null || typeof part !== "object") {
          if (["string", "number", "boolean"].includes(typeof part)) nestedItems.push(part);
          continue;
        }
        if (Array.isArray(part)) {
          const nestedArray = sanitizeArray(part, depth + 1);
          if (nestedArray.length > 0) nestedItems.push(nestedArray);
          continue;
        }
        const nested = sanitizeObject(part as Record<string, unknown>, depth + 1);
        if (Object.keys(nested).length > 0) nestedItems.push(nested);
      }
      if (nestedItems.length > 0) output[key] = nestedItems;
    }
    else if (item === null || ["string", "number", "boolean"].includes(typeof item)) output[key] = item;
  }
  return output;
}

function normalizeJsonKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeJsonKey(key);
  return SENSITIVE_NORMALIZED_KEYS.has(normalized) || SENSITIVE_NORMALIZED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function assertFiniteJsonNumbers(value: unknown): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_SNAPSHOT_NON_FINITE_NUMBER");
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertFiniteJsonNumbers(item);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) assertFiniteJsonNumbers(item);
}

export function isUniqueViolationForConstraint(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown };
    if (candidate.code === "23505" && candidate.constraint_name === constraint) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function sanitizeArray(value: readonly unknown[], depth: number): unknown[] {
  if (depth > MAX_REDACTION_DEPTH) return [];
  const output: unknown[] = [];
  for (const item of value.slice(0, MAX_REDACTION_ITEMS)) {
    if (item === null || typeof item !== "object") {
      if (["string", "number", "boolean"].includes(typeof item)) output.push(item);
    } else if (Array.isArray(item)) {
      const nested = sanitizeArray(item, depth + 1);
      if (nested.length > 0) output.push(nested);
    } else {
      const nested = sanitizeObject(item as Record<string, unknown>, depth + 1);
      if (Object.keys(nested).length > 0) output.push(nested);
    }
  }
  return output;
}

function assertMaxAttempts(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ATTEMPTS) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_MAX_ATTEMPTS_INVALID");
}
function assertCandidateCount(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_CANDIDATE_COUNT) throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_CANDIDATE_COUNT_INVALID");
}
function normalizeCandidateCount(candidateCount: number | undefined, candidatesCount: number | undefined): number | undefined {
  if (candidateCount !== undefined && candidatesCount !== undefined && candidateCount !== candidatesCount) {
    throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_CANDIDATE_COUNT_CONFLICT");
  }
  return candidateCount ?? candidatesCount;
}
function safeCode(value: string): string { return SAFE_CODE.test(value) ? value : "RECONCILIATION_ERROR"; }

async function lockedProposal(tx: DatabaseExecutor, workspaceId: string, proposalId: string, options?: { readonly skipLocked?: boolean }) {
  const query = tx.select().from(mcpEffectProposals).where(and(eq(mcpEffectProposals.workspaceId, workspaceId), eq(mcpEffectProposals.id, proposalId))).limit(1);
  return (await (options?.skipLocked ? query.for("update", { skipLocked: true }) : query.for("update")))[0];
}

async function lockedReconciliation(tx: DatabaseExecutor, workspaceId: string, reconciliationId: string, options?: { readonly skipLocked?: boolean }) {
  const query = tx.select().from(mcpEffectReconciliations).where(and(eq(mcpEffectReconciliations.workspaceId, workspaceId), eq(mcpEffectReconciliations.id, reconciliationId))).limit(1);
  return (await (options?.skipLocked ? query.for("update", { skipLocked: true }) : query.for("update")))[0];
}

function toRecord(row: typeof mcpEffectReconciliations.$inferSelect): McpEffectReconciliationRecord {
  const status = row.status as McpReconciliationStatus;
  const resultSnapshot = row.resultSnapshot === null ? null : redactReconciliationJson(row.resultSnapshot);
  if (status === "matched" && (row.candidateCount !== 1 || !resultSnapshot || Object.keys(resultSnapshot).length === 0)) {
    throw new McpEffectReconciliationRepositoryError("MCP_RECONCILIATION_MATCH_EVIDENCE_REQUIRED");
  }
  return {
    reconciliationId: row.id, workspaceId: row.workspaceId, proposalId: row.proposalId, status,
    proposalStatus: mapReconciliationProposalStatus(status), criteriaSnapshot: redactReconciliationJson(row.criteriaSnapshot), attempts: row.attempts, maxAttempts: row.maxAttempts,
    leaseToken: row.leaseToken, leaseExpiresAt: row.leaseExpiresAt, nextAttemptAt: row.nextAttemptAt, completedAt: row.completedAt, candidateCount: row.candidateCount,
    errorCode: row.errorCode, errorMessage: row.errorMessage, resultSnapshot,
    evidenceSnapshot: resultSnapshot, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
