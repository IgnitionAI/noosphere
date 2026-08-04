import { and, desc, eq } from "drizzle-orm";
import { INBOUND_REPLY_PROCESS_JOB_TYPE } from "@outbound/application/campaigns/autonomous-prospecting";
import type { Database } from "@outbound/infrastructure/database/client";
import {
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

function stringAt(value: Record<string, unknown>, key: string): string | null {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item : null;
}
