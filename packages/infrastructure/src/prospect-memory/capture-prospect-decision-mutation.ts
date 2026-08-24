import type { Database } from "@outbound/infrastructure/database/client";
import type { prospectDecisions } from "@outbound/infrastructure/database/schema";
import { captureProspectMemoryMutation } from "./capture-prospect-memory-mutation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ProspectDecision = Pick<
  typeof prospectDecisions.$inferSelect,
  | "id"
  | "workspaceId"
  | "contactId"
  | "campaignId"
  | "kind"
  | "status"
  | "dueAt"
  | "attempts"
  | "proposedAction"
  | "lastErrorCode"
  | "updatedAt"
>;

/**
 * Records a meaningful prospect-decision state transition in the same
 * transaction as the authoritative row. The source version is content-derived
 * instead of timestamp-derived so two transitions observed in the same
 * millisecond cannot collapse into one memory event, while an exact replay is
 * still idempotent.
 */
export async function captureProspectDecisionMutation(
  executor: Pick<Transaction, "select" | "insert">,
  decision: ProspectDecision,
  correlationId: string,
) {
  const payload = {
    decisionId: decision.id,
    campaignId: decision.campaignId,
    kind: decision.kind,
    status: decision.status,
    dueAt: decision.dueAt.toISOString(),
    attempts: decision.attempts,
    proposedAction: decision.proposedAction,
    lastErrorCode: decision.lastErrorCode,
    updatedAt: decision.updatedAt.toISOString(),
  } as const;
  return captureProspectMemoryMutation(executor, {
    workspaceId: decision.workspaceId,
    sourceContactId: decision.contactId,
    sourceKind: "prospect_decision",
    sourceId: decision.id,
    sourceVersion: await stablePositiveInteger(payload),
    kind: "decision_changed",
    occurredAt: decision.updatedAt,
    observedAt: decision.updatedAt,
    payload,
    correlationId,
  });
}

async function stablePositiveInteger(value: unknown): Promise<number> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  ));
  // 48 bits stay safely below Number.MAX_SAFE_INTEGER and are enough for an
  // idempotency version. Sequence ordering remains the database sequence_id.
  let result = 0;
  for (const byte of digest.slice(0, 6)) result = (result * 256) + byte;
  return result || 1;
}
