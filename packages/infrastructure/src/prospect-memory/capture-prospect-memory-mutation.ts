import { and, eq } from "drizzle-orm";
import {
  PROSPECT_MEMORY_REFRESH_JOB_TYPE,
  type CaptureProspectMemoryMutationInput,
  type CaptureProspectMemoryMutationResult,
} from "@outbound/application/prospect-memory/prospect-memory";
import { PROSPECT_MEMORY_EVENT_SCHEMA_VERSION } from "@outbound/domain/prospect-memory/prospect-memory";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  contacts,
  jobs,
  prospectMemoryEvents,
  workspaceProspectMemorySettings,
} from "@outbound/infrastructure/database/schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type CaptureExecutor = Pick<Transaction, "select" | "insert">;

/**
 * Must be called from the same database transaction as the authoritative
 * business mutation. The event and its durable refresh job therefore commit or
 * roll back together; no agent process owns this state.
 */
export async function captureProspectMemoryMutation(
  executor: CaptureExecutor,
  input: CaptureProspectMemoryMutationInput,
): Promise<CaptureProspectMemoryMutationResult> {
  // occurredAt can be a future business instant (for example the start of a
  // booked call). Unless a caller explicitly supplies another validity window,
  // the captured fact is valid as soon as the mutation is observed.
  const validFrom = input.validFrom ?? input.observedAt;
  if (validFrom > input.observedAt) {
    throw new Error("PROSPECT_MEMORY_FUTURE_VALIDITY_UNSUPPORTED");
  }
  if (input.validTo && input.validTo <= validFrom) {
    throw new Error("PROSPECT_MEMORY_VALIDITY_INVALID");
  }
  const [settings] = await executor
    .select({ captureEnabled: workspaceProspectMemorySettings.captureEnabled })
    .from(workspaceProspectMemorySettings)
    .where(eq(workspaceProspectMemorySettings.workspaceId, input.workspaceId))
    .limit(1);
  if (!settings?.captureEnabled) return emptyResult("disabled");

  const [contact] = await executor
    .select({
      id: contacts.id,
      mergedIntoId: contacts.mergedIntoId,
      anonymizedAt: contacts.anonymizedAt,
      privacyEpoch: contacts.privacyEpoch,
    })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, input.sourceContactId)))
    .limit(1);
  if (!contact) return emptyResult("contact_missing");
  if (contact.anonymizedAt) return emptyResult("anonymized");
  const canonicalContactId = contact.mergedIntoId ?? contact.id;
  const canonicalContact = contact.mergedIntoId
    ? (await executor
        .select({
          anonymizedAt: contacts.anonymizedAt,
          privacyEpoch: contacts.privacyEpoch,
        })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, canonicalContactId)))
        .limit(1))[0]
    : contact;
  if (!canonicalContact) return emptyResult("contact_missing");
  if (canonicalContact.anonymizedAt) return emptyResult("anonymized");

  const [event] = await executor
    .insert(prospectMemoryEvents)
    .values({
      workspaceId: input.workspaceId,
      sourceContactId: input.sourceContactId,
      canonicalContactId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      kind: input.kind,
      occurredAt: input.occurredAt,
      observedAt: input.observedAt,
      validFrom,
      validTo: input.validTo ?? null,
      supersedesEventId: input.supersedesEventId ?? null,
      payload: input.payload,
      schemaVersion: PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
      createdAt: input.observedAt,
    })
    .onConflictDoNothing({
      target: [
        prospectMemoryEvents.workspaceId,
        prospectMemoryEvents.sourceKind,
        prospectMemoryEvents.sourceId,
        prospectMemoryEvents.sourceVersion,
      ],
    })
    .returning({ id: prospectMemoryEvents.id, sequenceId: prospectMemoryEvents.sequenceId });
  if (!event) {
    return { outcome: "duplicate", eventId: null, sequenceId: null, canonicalContactId };
  }

  const debounceWindowMs = 30_000;
  const debounceBucket = Math.floor(input.observedAt.getTime() / debounceWindowMs);
  const availableAt = new Date(input.observedAt.getTime() + debounceWindowMs);
  const payload = {
    workspaceId: input.workspaceId,
    contactId: canonicalContactId,
    targetSequenceId: event.sequenceId,
    privacyEpoch: canonicalContact.privacyEpoch,
  };
  await executor.insert(jobs).values({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    type: PROSPECT_MEMORY_REFRESH_JOB_TYPE,
    payload,
    // All mutations observed for the same prospect in the same 30-second
    // window share one durable job. The latest event advances the target and
    // extends the debounce without creating a queue storm.
    idempotencyKey: `prospect-memory:auto:${canonicalContactId}:${debounceBucket}`,
    correlationId: input.correlationId,
    maxAttempts: 3,
    priority: -50,
    availableAt,
    createdAt: input.observedAt,
    updatedAt: input.observedAt,
  }).onConflictDoUpdate({
    target: [jobs.workspaceId, jobs.type, jobs.idempotencyKey],
    set: {
      payload,
      correlationId: input.correlationId,
      availableAt,
      updatedAt: input.observedAt,
    },
  });

  return {
    outcome: "captured",
    eventId: event.id,
    sequenceId: event.sequenceId,
    canonicalContactId,
  };
}

function emptyResult(
  outcome: "disabled" | "contact_missing" | "anonymized",
): CaptureProspectMemoryMutationResult {
  return { outcome, eventId: null, sequenceId: null, canonicalContactId: null };
}
