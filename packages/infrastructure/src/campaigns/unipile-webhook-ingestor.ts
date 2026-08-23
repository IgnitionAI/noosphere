import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { INBOUND_REPLY_PROCESS_JOB_TYPE } from "@outbound/application/campaigns/autonomous-prospecting";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  connectedAccounts,
  approvalItems,
  campaignEnrollments,
  campaignProspects,
  contactIdentities,
  conversations,
  integrationEvents,
  jobs,
  outboxEvents,
  outreachActions,
  prospectDecisions,
  prospectDiscoveryCandidates,
  workspaceChannelAccounts,
} from "@outbound/infrastructure/database/schema";
import { normalizeInboundWebhook } from "./inbound-reply-runner";
import { normalizeEmail, normalizePhone } from "@outbound/domain/crm/normalization";
import { captureProspectDecisionMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-decision-mutation";

export class UnipileWebhookIngestor {
  constructor(
    private readonly database: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ingest(rawBody: string): Promise<{ duplicate: boolean; eventId: string }> {
    const payload = parseJsonObject(rawBody);
    const accountId = stringAt(payload, "account_id") ?? stringAt(payload, "accountId");
    if (!accountId) throw new UnipileWebhookError("WEBHOOK_ACCOUNT_MISSING", 400);
    const workspaceId = await resolveWebhookWorkspace(this.database, accountId);
    if (!workspaceId) throw new UnipileWebhookError("WEBHOOK_ACCOUNT_UNMAPPED", 409);
    const providerEventId = webhookEventId(payload, rawBody);
    const eventType = stringAt(payload, "event")
      ?? stringAt(payload, "type")
      ?? "unknown";
    const eventId = crypto.randomUUID();
    const now = this.now();
    return this.database.transaction(async (tx) => {
      const [inserted] = await tx.insert(integrationEvents).values({
        id: eventId,
        workspaceId,
        provider: "unipile",
        providerEventId,
        eventType,
        payload,
        status: "pending",
        receivedAt: now,
      }).onConflictDoNothing().returning({ id: integrationEvents.id });
      if (!inserted) {
        const [existing] = await tx
          .select({ id: integrationEvents.id })
          .from(integrationEvents)
          .where(
            and(
              eq(integrationEvents.workspaceId, workspaceId),
              eq(integrationEvents.provider, "unipile"),
              eq(integrationEvents.providerEventId, providerEventId),
            ),
          )
          .limit(1);
        return { duplicate: true, eventId: existing?.id ?? eventId };
      }
      await tx.insert(jobs).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: INBOUND_REPLY_PROCESS_JOB_TYPE,
        payload: { workspaceId, integrationEventId: eventId },
        idempotencyKey: `${eventId}:process:v1`,
        correlationId: `unipile-event:${eventId}`,
        maxAttempts: 3,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const incoming = normalizeInboundWebhook(payload);
      if (incoming?.inbound) {
        const match = await matchInboundContact(tx, workspaceId, incoming);
        if (match) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${match.contactId}:outbound`}, 0))`);
          await tx.update(campaignEnrollments).set({ status: "cancelled", completedAt: now }).where(and(
            eq(campaignEnrollments.workspaceId, workspaceId),
            eq(campaignEnrollments.contactId, match.contactId),
            eq(campaignEnrollments.status, "active"),
          ));
          await tx.update(outreachActions).set({
            status: "cancelled",
            responseReceivedAt: incoming.occurredAt,
            cancelledAt: now,
            lastErrorCode: "PROSPECT_REPLIED",
            lastErrorMessage: "Une réponse entrante a invalidé cette action avant son envoi.",
            lockedAt: null,
            lockedUntil: null,
            lockedBy: null,
            updatedAt: now,
          }).where(and(
            eq(outreachActions.workspaceId, workspaceId),
            eq(outreachActions.contactId, match.contactId),
            inArray(outreachActions.status, ["scheduled", "awaiting_approval", "executing"]),
          ));
          const invalidatedDecisions = await tx.update(prospectDecisions).set({
            status: "cancelled",
            invalidatedAt: now,
            completedAt: now,
            lastErrorCode: "PROSPECT_REPLIED",
            lastErrorMessage: "Décision invalidée atomiquement à l’ingestion de la réponse.",
            updatedAt: now,
          }).where(and(
            eq(prospectDecisions.workspaceId, workspaceId),
            eq(prospectDecisions.contactId, match.contactId),
            inArray(prospectDecisions.status, ["pending", "running", "awaiting_approval"]),
          )).returning();
          for (const invalidatedDecision of invalidatedDecisions) {
            await captureProspectDecisionMutation(
              tx,
              invalidatedDecision,
              `unipile-event:${eventId}`,
            );
          }
          await tx.update(approvalItems).set({
            status: "invalidated",
            invalidationReason: "prospect_replied",
            updatedAt: now,
          }).where(and(
            eq(approvalItems.workspaceId, workspaceId),
            eq(approvalItems.contactId, match.contactId),
            eq(approvalItems.status, "pending"),
            inArray(approvalItems.itemType, ["prospect_decision_send", "first_contact"]),
          ));
          await tx.insert(outboxEvents).values({
            id: crypto.randomUUID(),
            workspaceId,
            aggregateType: "Contact",
            aggregateId: match.contactId,
            eventType: "PendingOutreachInvalidatedByInbound",
            payload: {
              contactId: match.contactId,
              campaignId: match.campaignId,
              integrationEventId: eventId,
              occurredAt: incoming.occurredAt.toISOString(),
            },
            availableAt: now,
            createdAt: now,
          });
        }
      }
      return { duplicate: false, eventId };
    });
  }

  async recordRejected(rawBody: string, reasonCode: string): Promise<boolean> {
    return recordRejectedUnipileWebhook(this.database, rawBody, reasonCode, this.now());
  }
}

async function resolveWebhookWorkspace(database: Database, accountId: string): Promise<string | null> {
  const [selected, connected] = await Promise.all([
    database
      .selectDistinct({ workspaceId: workspaceChannelAccounts.workspaceId })
      .from(workspaceChannelAccounts)
      .where(and(eq(workspaceChannelAccounts.provider, "unipile"), eq(workspaceChannelAccounts.providerAccountId, accountId))),
    database
      .selectDistinct({ workspaceId: connectedAccounts.workspaceId })
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.provider, "unipile"), eq(connectedAccounts.providerAccountId, accountId))),
  ]);
  const candidates = new Set([...selected, ...connected].map((row) => row.workspaceId));
  if (candidates.size > 1) throw new UnipileWebhookError("WEBHOOK_ACCOUNT_AMBIGUOUS", 409);
  const currentWorkspaceId = candidates.values().next().value;
  if (currentWorkspaceId) return currentWorkspaceId;

  const action = await database
    .selectDistinct({ workspaceId: outreachActions.workspaceId })
    .from(outreachActions)
    .where(and(eq(outreachActions.provider, "unipile"), eq(outreachActions.providerAccountId, accountId)));
  const historicalCandidates = new Set(action.map((row) => row.workspaceId));
  if (historicalCandidates.size > 1) throw new UnipileWebhookError("WEBHOOK_ACCOUNT_AMBIGUOUS", 409);
  return historicalCandidates.values().next().value ?? null;
}

async function matchInboundContact(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  workspaceId: string,
  incoming: NonNullable<ReturnType<typeof normalizeInboundWebhook>>,
): Promise<{ contactId: string; campaignId: string | null } | null> {
  const [conversation] = await tx
    .select({ contactId: conversations.contactId, campaignId: conversations.campaignId })
    .from(conversations)
    .where(and(
      eq(conversations.workspaceId, workspaceId),
      eq(conversations.providerAccountId, incoming.accountId),
      eq(conversations.providerThreadId, incoming.threadId),
    ))
    .limit(1);
  if (conversation) return conversation;

  const [exactAction] = await tx
    .select({ contactId: outreachActions.contactId, campaignId: outreachActions.campaignId })
    .from(outreachActions)
    .where(and(
      eq(outreachActions.workspaceId, workspaceId),
      eq(outreachActions.providerAccountId, incoming.accountId),
      eq(outreachActions.providerRequestId, incoming.messageId),
    ))
    .limit(1);
  if (exactAction) return exactAction;

  let contactId: string | null = null;
  if (incoming.senderValue && incoming.channel !== "linkedin") {
    try {
      const normalized = incoming.channel === "email"
        ? normalizeEmail(incoming.senderValue)
        : normalizePhone(incoming.senderValue);
      const [identity] = await tx
        .select({ contactId: contactIdentities.contactId })
        .from(contactIdentities)
        .where(and(
          eq(contactIdentities.workspaceId, workspaceId),
          eq(contactIdentities.normalizedValue, normalized),
        ))
        .limit(1);
      contactId = identity?.contactId ?? null;
    } catch {
      // Invalid provider identities are still processed asynchronously and
      // recorded as unmatched rather than weakening the ingestion barrier.
    }
  }

  if (!contactId && incoming.senderProviderId) {
    const [candidate] = await tx
      .select({ contactId: campaignProspects.contactId })
      .from(campaignProspects)
      .innerJoin(
        prospectDiscoveryCandidates,
        and(
          eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
          eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
        ),
      )
      .where(and(
        eq(campaignProspects.workspaceId, workspaceId),
        sql`${prospectDiscoveryCandidates.providerData}->>'providerId' = ${incoming.senderProviderId}`,
      ))
      .orderBy(desc(campaignProspects.updatedAt))
      .limit(1);
    contactId = candidate?.contactId ?? null;
  }

  if (!contactId) return null;
  const [sentAction] = await tx
    .select({ contactId: outreachActions.contactId, campaignId: outreachActions.campaignId })
    .from(outreachActions)
    .where(and(
      eq(outreachActions.workspaceId, workspaceId),
      eq(outreachActions.contactId, contactId),
      eq(outreachActions.providerAccountId, incoming.accountId),
      eq(outreachActions.channel, incoming.channel),
      eq(outreachActions.status, "sent"),
    ))
    .orderBy(desc(outreachActions.sentAt), desc(outreachActions.createdAt))
    .limit(1);
  if (sentAction) return sentAction;
  return { contactId, campaignId: null };
}

export async function recordRejectedUnipileWebhook(database: Database, rawBody: string, reasonCode: string, now = new Date()): Promise<boolean> {
  try {
    const payload = tryParseJsonObject(rawBody);
    if (!payload) return false;
    const accountId = stringAt(payload, "account_id") ?? stringAt(payload, "accountId")
      ?? nestedString(payload, "account", "id") ?? nestedString(payload, "data", "account_id") ?? nestedString(payload, "data", "accountId");
    if (!accountId) return false;
    const workspaceId = await resolveWebhookWorkspace(database, accountId);
    if (!workspaceId) return false;
    const bodyHash = new Bun.CryptoHasher("sha256").update(rawBody).digest("hex");
    const accountHash = new Bun.CryptoHasher("sha256").update(accountId).digest("hex").slice(0, 24);
    const hourBucket = now.toISOString().slice(0, 13);
    const inserted = await database.insert(integrationEvents).values({
      id: crypto.randomUUID(),
      workspaceId,
      provider: "unipile",
      providerEventId: `rejected:${reasonCode}:${accountHash}:${hourBucket}`,
      eventType: "rejected_webhook",
      payload: { bodyHash, accountHash, aggregatedBy: "account_reason_hour" },
      status: "rejected",
      errorCode: reasonCode.slice(0, 160),
      errorMessage: "Webhook rejected before ingestion",
      receivedAt: now,
      processedAt: now,
    }).onConflictDoNothing().returning({ id: integrationEvents.id });
    return inserted.length === 1;
  } catch {
    return false;
  }
}

export class UnipileWebhookError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function webhookEventId(payload: Record<string, unknown>, rawBody: string): string {
  for (const path of ["webhook_id", "event_id", "id", "message_id", "email_id"]) {
    const value = stringAt(payload, path);
    if (value) return `${stringAt(payload, "event") ?? "event"}:${value}`;
  }
  return `sha256:${new Bun.CryptoHasher("sha256").update(rawBody).digest("hex")}`;
}

function parseJsonObject(rawBody: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new UnipileWebhookError("WEBHOOK_JSON_INVALID", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UnipileWebhookError("WEBHOOK_PAYLOAD_INVALID", 400);
  }
  return value as Record<string, unknown>;
}

function tryParseJsonObject(rawBody: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(rawBody) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function stringAt(value: Record<string, unknown>, key: string): string | null {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item : null;
}

function nestedString(value: Record<string, unknown>, parent: string, key: string): string | null {
  const nested = value[parent];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? stringAt(nested as Record<string, unknown>, key) : null;
}
