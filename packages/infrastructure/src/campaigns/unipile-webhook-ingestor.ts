import { and, desc, eq } from "drizzle-orm";
import { INBOUND_REPLY_PROCESS_JOB_TYPE } from "@outbound/application/campaigns/autonomous-prospecting";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  connectedAccounts,
  integrationEvents,
  jobs,
  outreachActions,
} from "@outbound/infrastructure/database/schema";

export class UnipileWebhookIngestor {
  constructor(
    private readonly database: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ingest(rawBody: string): Promise<{ duplicate: boolean; eventId: string }> {
    const payload = parseJsonObject(rawBody);
    const accountId = stringAt(payload, "account_id") ?? stringAt(payload, "accountId");
    if (!accountId) throw new UnipileWebhookError("WEBHOOK_ACCOUNT_MISSING", 400);
    const [accountAction] = await this.database
      .select({ workspaceId: outreachActions.workspaceId })
      .from(outreachActions)
      .where(eq(outreachActions.providerAccountId, accountId))
      .orderBy(desc(outreachActions.createdAt))
      .limit(1);
    if (!accountAction) throw new UnipileWebhookError("WEBHOOK_ACCOUNT_UNMAPPED", 409);
    const providerEventId = webhookEventId(payload, rawBody);
    const eventType = stringAt(payload, "event")
      ?? stringAt(payload, "type")
      ?? "unknown";
    const eventId = crypto.randomUUID();
    const now = this.now();
    return this.database.transaction(async (tx) => {
      const [inserted] = await tx.insert(integrationEvents).values({
        id: eventId,
        workspaceId: accountAction.workspaceId,
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
              eq(integrationEvents.workspaceId, accountAction.workspaceId),
              eq(integrationEvents.provider, "unipile"),
              eq(integrationEvents.providerEventId, providerEventId),
            ),
          )
          .limit(1);
        return { duplicate: true, eventId: existing?.id ?? eventId };
      }
      await tx.insert(jobs).values({
        id: crypto.randomUUID(),
        workspaceId: accountAction.workspaceId,
        type: INBOUND_REPLY_PROCESS_JOB_TYPE,
        payload: { workspaceId: accountAction.workspaceId, integrationEventId: eventId },
        idempotencyKey: `${eventId}:process:v1`,
        correlationId: `unipile-event:${eventId}`,
        maxAttempts: 3,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { duplicate: false, eventId };
    });
  }

  async recordRejected(rawBody: string, reasonCode: string): Promise<boolean> {
    return recordRejectedUnipileWebhook(this.database, rawBody, reasonCode, this.now());
  }
}

export async function recordRejectedUnipileWebhook(database: Database, rawBody: string, reasonCode: string, now = new Date()): Promise<boolean> {
  try {
    const payload = tryParseJsonObject(rawBody);
    if (!payload) return false;
    const accountId = stringAt(payload, "account_id") ?? stringAt(payload, "accountId")
      ?? nestedString(payload, "account", "id") ?? nestedString(payload, "data", "account_id") ?? nestedString(payload, "data", "accountId");
    if (!accountId) return false;
    const [connected] = await database.select({ workspaceId: connectedAccounts.workspaceId }).from(connectedAccounts).where(eq(connectedAccounts.providerAccountId, accountId)).orderBy(desc(connectedAccounts.createdAt)).limit(1);
    const [action] = connected ? [] : await database.select({ workspaceId: outreachActions.workspaceId }).from(outreachActions).where(eq(outreachActions.providerAccountId, accountId)).orderBy(desc(outreachActions.createdAt)).limit(1);
    const workspaceId = connected?.workspaceId ?? action?.workspaceId;
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
