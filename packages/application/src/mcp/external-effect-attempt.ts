import type { McpGovernedEffectKind, McpGovernedEffectStatus } from "./mcp-governed-effects";

/**
 * Provider-neutral identity for one leased governed effect.  Every field is
 * supplied by the queue/repository boundary; callers may not substitute a
 * different tenant, proposal, intention, or job while recording an attempt.
 */
export interface ExternalEffectAttemptIdentity {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly intentionId: string;
  readonly jobId: string;
  readonly kind: McpGovernedEffectKind;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  /** Queue lease owner, when the caller has a leased job envelope. */
  readonly jobLeaseOwner?: string;
}

export interface ExternalEffectAttemptMarker extends ExternalEffectAttemptIdentity {
  readonly state: "started";
  readonly attempt: number;
  readonly sequence: number;
  readonly sourceEventId: string;
  readonly idempotencyKey: string;
}

/**
 * Provider-neutral callback boundary. Implementations may be supplied by a
 * later adapter slice, but must only run after `recordBeforeProvider` has
 * committed its durable marker.
 */
export interface ExternalEffectExecutorInput {
  readonly identity: ExternalEffectAttemptIdentity;
  readonly marker: ExternalEffectAttemptMarker;
}

export type ExternalEffectOutcome = "delivered" | "failed" | "unknown";

export interface ExternalEffectOutcomeInput extends ExternalEffectAttemptIdentity {
  readonly outcome: ExternalEffectOutcome;
  /** Required for delivered; provider response bodies are never persisted. */
  readonly authoritative?: boolean;
  readonly code?: string;
  readonly result?: unknown;
  readonly sourceEventId?: string;
  readonly idempotencyKey?: string;
}

export interface ExternalEffectExecutorResult {
  readonly outcome: ExternalEffectOutcome;
  readonly authoritative?: boolean;
  readonly code?: string;
  readonly result?: unknown;
}

export type ExternalEffectExecutor = (
  input: ExternalEffectExecutorInput,
) => Promise<ExternalEffectExecutorResult>;

export interface ExternalEffectAttemptResult {
  readonly state: "completed" | "unknown";
  readonly proposalStatus: McpGovernedEffectStatus;
  readonly reconciliationId: string | null;
  readonly sequence: number;
  readonly sourceEventId: string;
  readonly idempotencyKey: string;
}

export interface ExternalEffectReadOnlyInput {
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly intentionId: string;
  readonly kind: McpGovernedEffectKind;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly reconciliationId: string;
  readonly criteriaSnapshot: Record<string, unknown>;
}

export type ExternalEffectReadOnlyResult =
  | { readonly outcome: "matched"; readonly authoritative: true; readonly candidateCount: 1; readonly result: Record<string, unknown> }
  | { readonly outcome: "not_found"; readonly candidateCount?: 0 }
  | { readonly outcome: "ambiguous"; readonly candidateCount: number }
  | { readonly outcome: "error"; readonly code?: string };

/** Injected reconciliation capability. It must only perform read-only lookups. */
export interface ExternalEffectReadOnlyPort {
  reconcileReadOnly(input: ExternalEffectReadOnlyInput): Promise<ExternalEffectReadOnlyResult>;
}

/** Durable attempt boundary shared by all future provider adapters. */
export interface ExternalEffectAttemptPort {
  recordBeforeProvider(input: ExternalEffectAttemptIdentity): Promise<ExternalEffectAttemptMarker>;
  recordOutcome(input: ExternalEffectOutcomeInput): Promise<ExternalEffectAttemptResult>;
  reconcileReadOnly(input: ExternalEffectReadOnlyInput): Promise<ExternalEffectReadOnlyResult>;
  recoverExpiredStarted(input: { readonly workspaceId?: string; readonly now: Date; readonly limit?: number }): Promise<number>;
  /** Independently scans durable due reconciliation rows after restart. */
  reconcileDue?(input: { readonly workspaceId?: string; readonly now: Date; readonly limit?: number }): Promise<number>;
}
