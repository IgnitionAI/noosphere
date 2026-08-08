import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  connectedAccountWebhooks,
  connectedAccounts,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";
import type { ConnectedAccountStatus, UnipileAccountSnapshot } from "./unipile-client";

export interface ConnectedAccountView {
  readonly id: string;
  readonly provider: string;
  readonly providerAccountId: string;
  readonly displayName: string | null;
  readonly status: ConnectedAccountStatus;
  readonly capabilities: unknown;
  readonly quotas: unknown;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly lastCheckedAt: Date | null;
  readonly disconnectedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class PostgresConnectedAccountRepository {
  constructor(private readonly db: Database) {}

  async list(workspaceId: string): Promise<readonly ConnectedAccountView[]> {
    const rows = await this.db.select().from(connectedAccounts)
      .where(eq(connectedAccounts.workspaceId, workspaceId))
      .orderBy(desc(connectedAccounts.updatedAt));
    return rows.map(toView);
  }

  async get(input: { workspaceId: string; id: string }): Promise<ConnectedAccountView | null> {
    const rows = await this.db.select().from(connectedAccounts).where(and(
      eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.id, input.id),
    )).limit(1);
    return rows[0] ? toView(rows[0]) : null;
  }

  async create(input: {
    id: string;
    workspaceId: string;
    provider: string;
    providerAccountId: string;
    displayName: string | null;
    encryptedSecret: string;
    createdBy: string;
    snapshot: UnipileAccountSnapshot;
  }): Promise<ConnectedAccountView> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.insert(connectedAccounts).values({
        id: input.id,
        workspaceId: input.workspaceId,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        displayName: input.snapshot.displayName ?? input.displayName,
        status: input.snapshot.status,
        capabilities: input.snapshot.capabilities,
        quotas: input.snapshot.quotas,
        encryptedSecret: input.encryptedSecret,
        lastCheckedAt: new Date(),
        createdBy: input.createdBy,
      }).returning();
      const account = rows[0];
      if (!account) throw new Error("CONNECTED_ACCOUNT_CREATE_FAILED");
      await this.recordEvent(tx, {
        workspaceId: input.workspaceId,
        accountId: account.id,
        actorUserId: input.createdBy,
        status: account.status,
        previousStatus: null,
        capabilities: account.capabilities,
      });
      return toView(account);
    });
  }

  async findByProviderAccount(input: { provider: string; providerAccountId: string }) {
    const rows = await this.db.select().from(connectedAccounts).where(and(
      eq(connectedAccounts.provider, input.provider),
      eq(connectedAccounts.providerAccountId, input.providerAccountId),
    )).limit(1);
    return rows[0] ?? null;
  }

  async getWithSecret(input: { workspaceId: string; id: string }) {
    const rows = await this.db.select().from(connectedAccounts).where(and(
      eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.id, input.id),
    )).limit(1);
    return rows[0] ?? null;
  }

  async updateFromProvider(input: {
    workspaceId: string;
    accountId: string;
    snapshot: UnipileAccountSnapshot;
    errorCode?: string | null;
    errorMessage?: string | null;
    actorUserId?: string | null;
  }): Promise<ConnectedAccountView | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(connectedAccounts).where(and(
        eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.id, input.accountId),
      )).limit(1);
      const current = rows[0];
      if (!current) return null;
      const changed = current.status !== input.snapshot.status
        || JSON.stringify(current.capabilities) !== JSON.stringify(input.snapshot.capabilities)
        || JSON.stringify(current.quotas) !== JSON.stringify(input.snapshot.quotas)
        || current.displayName !== input.snapshot.displayName
        || current.lastErrorCode !== (input.errorCode ?? null)
        || current.lastErrorMessage !== (input.errorMessage ?? null);
      const updatedRows = await tx.update(connectedAccounts).set({
        displayName: input.snapshot.displayName,
        status: input.snapshot.status,
        capabilities: input.snapshot.capabilities,
        quotas: input.snapshot.quotas,
        lastErrorCode: input.errorCode ?? null,
        lastErrorMessage: input.errorMessage ?? null,
        lastCheckedAt: new Date(),
        disconnectedAt: input.snapshot.status === "disconnected" ? new Date() : null,
        updatedAt: new Date(),
      }).where(and(eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.id, input.accountId))).returning();
      const updated = updatedRows[0] ?? current;
      if (changed) {
        await this.recordEvent(tx, {
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          actorUserId: input.actorUserId ?? null,
          status: updated.status,
          previousStatus: current.status,
          capabilities: updated.capabilities,
        });
      }
      return toView(updated);
    });
  }

  async disconnect(input: { workspaceId: string; accountId: string; actorUserId: string }): Promise<ConnectedAccountView | null> {
    return this.db.transaction(async (tx) => {
      const currentRows = await tx.select().from(connectedAccounts).where(and(
        eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.id, input.accountId),
      )).limit(1);
      const current = currentRows[0];
      if (!current) return null;
      const rows = await tx.update(connectedAccounts).set({
        status: "disconnected",
        disconnectedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.id, input.accountId))).returning();
      const account = rows[0];
      if (!account) return null;
      if (current.status !== "disconnected") {
        await this.recordEvent(tx, {
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          actorUserId: input.actorUserId,
          status: "disconnected",
          previousStatus: current.status,
          capabilities: account.capabilities,
        });
      }
      return toView(account);
    });
  }

  async processWebhook(input: {
    eventId: string;
    providerAccountId: string;
    payload: unknown;
    snapshot: UnipileAccountSnapshot | null;
  }): Promise<{ duplicate: boolean; account: ConnectedAccountView | null }> {
    return this.db.transaction(async (tx) => {
      const account = input.snapshot ? await tx.select().from(connectedAccounts).where(and(
        eq(connectedAccounts.provider, "unipile"), eq(connectedAccounts.providerAccountId, input.providerAccountId),
      )).limit(1) : [];
      const current = account[0];
      const inserted = await tx.insert(connectedAccountWebhooks).values({
        provider: "unipile",
        eventId: input.eventId,
        workspaceId: current?.workspaceId ?? null,
        connectedAccountId: current?.id ?? null,
        payload: input.payload,
        processedAt: new Date(),
      }).onConflictDoNothing({ target: [connectedAccountWebhooks.provider, connectedAccountWebhooks.eventId] }).returning({ id: connectedAccountWebhooks.id });
      if (!inserted[0]) return { duplicate: true, account: current ? toView(current) : null };
      if (!current || !input.snapshot) return { duplicate: false, account: current ? toView(current) : null };
      const updatedRows = await tx.update(connectedAccounts).set({
        status: input.snapshot.status,
        displayName: input.snapshot.displayName,
        capabilities: input.snapshot.capabilities,
        quotas: input.snapshot.quotas,
        lastCheckedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      }).where(eq(connectedAccounts.id, current.id)).returning();
      const updated = updatedRows[0] ?? current;
      if (current.status !== updated.status || JSON.stringify(current.capabilities) !== JSON.stringify(updated.capabilities)) {
        await this.recordEvent(tx, {
          workspaceId: current.workspaceId,
          accountId: current.id,
          actorUserId: null,
          status: updated.status,
          previousStatus: current.status,
          capabilities: updated.capabilities,
        });
      }
      return { duplicate: false, account: toView(updated) };
    });
  }

  private async recordEvent(tx: any, input: {
    workspaceId: string;
    accountId: string;
    actorUserId: string | null;
    status: ConnectedAccountStatus;
    previousStatus: ConnectedAccountStatus | null;
    capabilities: unknown;
  }) {
    const [event] = await tx.insert(outboxEvents).values({
      workspaceId: input.workspaceId,
      aggregateType: "ConnectedAccount",
      aggregateId: input.accountId,
      eventType: "ConnectedAccountStatusChanged",
      payload: {
        type: "ConnectedAccountStatusChanged",
        accountId: input.accountId,
        workspaceId: input.workspaceId,
        status: input.status,
        previousStatus: input.previousStatus,
        capabilities: input.capabilities,
      },
    }).returning({ id: outboxEvents.id });
    if (event) {
      await tx.insert(auditLogs).values({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "ConnectedAccountStatusChanged",
        subjectType: "ConnectedAccount",
        subjectId: input.accountId,
        changes: { status: input.status, previousStatus: input.previousStatus },
        sourceEventId: event.id,
      });
    }
  }
}

function toView(row: typeof connectedAccounts.$inferSelect): ConnectedAccountView {
  return {
    id: row.id,
    provider: row.provider,
    providerAccountId: row.providerAccountId,
    displayName: row.displayName,
    status: row.status,
    capabilities: row.capabilities,
    quotas: row.quotas,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    lastCheckedAt: row.lastCheckedAt,
    disconnectedAt: row.disconnectedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
