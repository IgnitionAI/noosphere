import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  accountHealthAlerts,
  connectedAccountWebhooks,
  connectedAccounts,
  connectionOnboardings,
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

export interface ConnectionOnboardingView {
  readonly id: string;
  readonly provider: string;
  readonly channel: string;
  readonly step: string;
  readonly status: string;
  readonly hostedUrl: string | null;
  readonly providerAccountId: string | null;
  readonly result: unknown;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AccountHealthAlertView {
  readonly id: string;
  readonly connectedAccountId: string;
  readonly status: string;
  readonly reasonCode: string | null;
  readonly reasonMessage: string | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AccountQuotaView {
  readonly accountId: string;
  readonly referenceDate: string;
  readonly timezone: "UTC";
  readonly channels: readonly {
    readonly channel: string;
    readonly sentToday: number;
    readonly limit: number | null;
    readonly percentage: number | null;
    readonly state: "ok" | "near_limit" | "reached" | "unlimited";
  }[];
}

export interface AccountSuspensionImpactView {
  readonly accountId: string;
  readonly campaigns: readonly { readonly campaignId: string; readonly campaignName: string; readonly suspendedActions: number }[];
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
      await this.syncHealthAlert(tx, current, updated, input.actorUserId ?? null);
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

  async startOnboarding(input: { id: string; workspaceId: string; channel: string; createdBy: string; expiresAt: Date }): Promise<ConnectionOnboardingView> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.select().from(connectionOnboardings).where(and(
        eq(connectionOnboardings.workspaceId, input.workspaceId),
        eq(connectionOnboardings.channel, input.channel),
        sql`${connectionOnboardings.status} in ('initiated', 'awaiting_callback', 'verifying')`,
      )).limit(1);
      if (existing[0]) return toOnboardingView(existing[0]);
      const rows = await tx.insert(connectionOnboardings).values({
        id: input.id,
        workspaceId: input.workspaceId,
        channel: input.channel,
        step: "callback",
        status: "awaiting_callback",
        hostedUrl: `/api/v1/connected-accounts/onboarding/${input.id}/callback`,
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
      }).onConflictDoNothing().returning();
      const row = rows[0];
      if (!row) {
        const raced = await tx.select().from(connectionOnboardings).where(and(
          eq(connectionOnboardings.workspaceId, input.workspaceId),
          eq(connectionOnboardings.channel, input.channel),
          sql`${connectionOnboardings.status} in ('initiated', 'awaiting_callback', 'verifying')`,
        )).limit(1);
        if (raced[0]) return toOnboardingView(raced[0]);
        throw new Error("CONNECTION_ONBOARDING_CREATE_FAILED");
      }
      await this.recordOnboardingEvent(tx, row, "ConnectionOnboardingStarted", input.createdBy);
      return toOnboardingView(row);
    });
  }

  async getOnboarding(input: { workspaceId: string; id: string }): Promise<ConnectionOnboardingView | null> {
    const rows = await this.db.select().from(connectionOnboardings).where(and(
      eq(connectionOnboardings.workspaceId, input.workspaceId), eq(connectionOnboardings.id, input.id),
    )).limit(1);
    return rows[0] ? toOnboardingView(rows[0]) : null;
  }

  async completeOnboarding(input: {
    workspaceId: string;
    onboardingId: string;
    providerAccountId: string;
    displayName: string | null;
    encryptedSecret: string;
    snapshot: UnipileAccountSnapshot;
    actorUserId: string;
  }): Promise<{ onboarding: ConnectionOnboardingView; account: ConnectedAccountView }> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(connectionOnboardings).where(and(
        eq(connectionOnboardings.workspaceId, input.workspaceId), eq(connectionOnboardings.id, input.onboardingId),
      )).limit(1);
      const onboarding = rows[0];
      if (!onboarding) throw new Error("CONNECTION_ONBOARDING_NOT_FOUND");
      if (onboarding.expiresAt <= new Date()) throw new Error("CONNECTION_ONBOARDING_EXPIRED");
      if (!["initiated", "awaiting_callback", "verifying"].includes(onboarding.status)) {
        const account = onboarding.providerAccountId
          ? await tx.select().from(connectedAccounts).where(and(eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.providerAccountId, onboarding.providerAccountId))).limit(1)
          : [];
        if (account[0]) return { onboarding: toOnboardingView(onboarding), account: toView(account[0]) };
        throw new Error("CONNECTION_ONBOARDING_NOT_ACTIVE");
      }
      const accountRows = await tx.insert(connectedAccounts).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        provider: "unipile",
        providerAccountId: input.providerAccountId,
        displayName: input.snapshot.displayName ?? input.displayName,
        status: input.snapshot.status,
        capabilities: input.snapshot.capabilities,
        quotas: input.snapshot.quotas,
        encryptedSecret: input.encryptedSecret,
        lastCheckedAt: new Date(),
        createdBy: input.actorUserId,
      }).returning();
      const account = accountRows[0];
      if (!account) throw new Error("CONNECTED_ACCOUNT_CREATE_FAILED");
      const updatedRows = await tx.update(connectionOnboardings).set({
        step: "verification",
        status: "completed",
        providerAccountId: input.providerAccountId,
        result: { status: input.snapshot.status, capabilities: input.snapshot.capabilities, quotas: input.snapshot.quotas },
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      }).where(eq(connectionOnboardings.id, onboarding.id)).returning();
      const updated = updatedRows[0] ?? onboarding;
      await this.recordEvent(tx, {
        workspaceId: input.workspaceId,
        accountId: account.id,
        actorUserId: input.actorUserId,
        status: account.status,
        previousStatus: null,
        capabilities: account.capabilities,
      });
      await this.syncHealthAlert(tx, null, account, input.actorUserId);
      await this.recordOnboardingEvent(tx, updated, "ConnectionOnboardingCompleted", input.actorUserId);
      return { onboarding: toOnboardingView(updated), account: toView(account) };
    });
  }

  async failOnboarding(input: { workspaceId: string; id: string; errorCode: string; errorMessage: string }): Promise<ConnectionOnboardingView | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.update(connectionOnboardings).set({
        step: "verification", status: "failed", errorCode: input.errorCode, errorMessage: input.errorMessage, updatedAt: new Date(),
      }).where(and(
        eq(connectionOnboardings.workspaceId, input.workspaceId),
        eq(connectionOnboardings.id, input.id),
        sql`${connectionOnboardings.status} in ('initiated', 'awaiting_callback', 'verifying')`,
      )).returning();
      if (rows[0]) {
        await this.recordOnboardingEvent(tx, rows[0], "ConnectionOnboardingFailed", null);
        return toOnboardingView(rows[0]);
      }
      const existing = await tx.select().from(connectionOnboardings).where(and(eq(connectionOnboardings.workspaceId, input.workspaceId), eq(connectionOnboardings.id, input.id))).limit(1);
      return existing[0] ? toOnboardingView(existing[0]) : null;
    });
  }

  async quotas(input: { workspaceId: string; accountId: string }): Promise<AccountQuotaView | null> {
    const rows = await this.db.select().from(connectedAccounts).where(and(
      eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.id, input.accountId),
    )).limit(1);
    const account = rows[0];
    if (!account) return null;
    const channels = confirmedSendingChannels(account.capabilities);
    const counts = await Promise.all(channels.map(async (channel) => {
      const result = await this.db.execute<{ count: number | string }>(sql`SELECT count(*)::int AS count FROM outreach_actions WHERE workspace_id = ${input.workspaceId} AND connected_account_id = ${input.accountId} AND channel = ${channel} AND sent_at >= CURRENT_DATE AND sent_at < CURRENT_DATE + interval '1 day'`);
      return [channel, Number(result[0]?.count ?? 0)] as const;
    }));
    const sentByChannel = new Map(counts);
    return {
      accountId: account.id,
      referenceDate: new Date().toISOString().slice(0, 10),
      timezone: "UTC",
      channels: channels.map((channel) => quotaForChannel(channel, sentByChannel.get(channel) ?? 0, account.quotas)),
    };
  }

  async listHealthAlerts(input: { workspaceId: string }): Promise<readonly AccountHealthAlertView[]> {
    const rows = await this.db.select().from(accountHealthAlerts).where(and(
      eq(accountHealthAlerts.workspaceId, input.workspaceId), sql`${accountHealthAlerts.status} in ('active', 'acknowledged')`,
    )).orderBy(desc(accountHealthAlerts.createdAt));
    return rows.map(toAlertView);
  }

  async acknowledgeHealthAlert(input: { workspaceId: string; id: string; actorUserId: string }): Promise<AccountHealthAlertView | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.update(accountHealthAlerts).set({
        status: "acknowledged", acknowledgedBy: input.actorUserId, acknowledgedAt: new Date(), updatedAt: new Date(),
      }).where(and(eq(accountHealthAlerts.workspaceId, input.workspaceId), eq(accountHealthAlerts.id, input.id), eq(accountHealthAlerts.status, "active"))).returning();
      if (rows[0]) {
        const [event] = await tx.insert(outboxEvents).values({
          workspaceId: input.workspaceId,
          aggregateType: "ConnectedAccount",
          aggregateId: rows[0].connectedAccountId,
          eventType: "AccountHealthAlertAcknowledged",
          payload: { type: "AccountHealthAlertAcknowledged", alertId: rows[0].id, accountId: rows[0].connectedAccountId, workspaceId: input.workspaceId },
        }).returning({ id: outboxEvents.id });
        if (event) await tx.insert(auditLogs).values({
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: "AccountHealthAlertAcknowledged",
          subjectType: "AccountHealthAlert",
          subjectId: rows[0].id,
          changes: { status: "acknowledged" },
          sourceEventId: event.id,
        });
        return toAlertView(rows[0]);
      }
      const existing = await tx.select().from(accountHealthAlerts).where(and(eq(accountHealthAlerts.workspaceId, input.workspaceId), eq(accountHealthAlerts.id, input.id))).limit(1);
      return existing[0] ? toAlertView(existing[0]) : null;
    });
  }

  async suspensionImpact(input: { workspaceId: string; accountId: string }): Promise<AccountSuspensionImpactView | null> {
    const account = await this.get({ workspaceId: input.workspaceId, id: input.accountId });
    if (!account) return null;
    const rows = await this.db.execute<{ campaign_id: string; campaign_name: string; suspended_actions: number | string }>(sql`SELECT c.id AS campaign_id, c.name AS campaign_name, count(oa.id)::int AS suspended_actions FROM campaigns c JOIN outreach_actions oa ON oa.workspace_id = c.workspace_id AND oa.campaign_id = c.id AND oa.connected_account_id = ${input.accountId} AND oa.status = 'suspended' WHERE c.workspace_id = ${input.workspaceId} AND c.status = 'active' GROUP BY c.id, c.name ORDER BY c.name`);
    return { accountId: input.accountId, campaigns: rows.map((row) => ({ campaignId: row.campaign_id, campaignName: row.campaign_name, suspendedActions: Number(row.suspended_actions) })) };
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
      await this.syncHealthAlert(tx, current, updated, null);
      return { duplicate: false, account: toView(updated) };
    });
  }

  private async syncHealthAlert(tx: any, previous: typeof connectedAccounts.$inferSelect | null, account: typeof connectedAccounts.$inferSelect, actorUserId: string | null): Promise<void> {
    if (account.status === "degraded" && previous?.status !== "degraded") {
      const episodeKey = `${account.id}:${account.updatedAt.toISOString()}`;
      const [alert] = await tx.insert(accountHealthAlerts).values({
        id: crypto.randomUUID(),
        workspaceId: account.workspaceId,
        connectedAccountId: account.id,
        episodeKey,
        status: "active",
        reasonCode: account.lastErrorCode,
        reasonMessage: account.lastErrorMessage,
      }).onConflictDoNothing({ target: [accountHealthAlerts.connectedAccountId, accountHealthAlerts.episodeKey] }).returning();
      if (alert) await this.recordHealthAlertEvent(tx, alert, "AccountHealthAlertRaised", actorUserId);
    }
    if (previous?.status === "degraded" && account.status !== "degraded") {
      const resolved = await tx.update(accountHealthAlerts).set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() }).where(and(
        eq(accountHealthAlerts.connectedAccountId, account.id), sql`${accountHealthAlerts.status} in ('active', 'acknowledged')`,
      )).returning();
      for (const alert of resolved) await this.recordHealthAlertEvent(tx, alert, "AccountHealthAlertResolved", actorUserId);
    }
  }

  private async recordHealthAlertEvent(tx: any, alert: typeof accountHealthAlerts.$inferSelect, eventType: "AccountHealthAlertRaised" | "AccountHealthAlertResolved", actorUserId: string | null): Promise<void> {
    const [event] = await tx.insert(outboxEvents).values({
      workspaceId: alert.workspaceId,
      aggregateType: "ConnectedAccount",
      aggregateId: alert.connectedAccountId,
      eventType,
      payload: { type: eventType, alertId: alert.id, accountId: alert.connectedAccountId, workspaceId: alert.workspaceId },
    }).returning({ id: outboxEvents.id });
    if (event) await tx.insert(auditLogs).values({
      workspaceId: alert.workspaceId,
      actorUserId,
      action: eventType,
      subjectType: "AccountHealthAlert",
      subjectId: alert.id,
      changes: { status: alert.status },
      sourceEventId: event.id,
    });
  }

  private async recordOnboardingEvent(
    tx: any,
    onboarding: typeof connectionOnboardings.$inferSelect,
    eventType: "ConnectionOnboardingStarted" | "ConnectionOnboardingCompleted" | "ConnectionOnboardingFailed",
    actorUserId: string | null,
  ): Promise<void> {
    const [event] = await tx.insert(outboxEvents).values({
      workspaceId: onboarding.workspaceId,
      aggregateType: "ConnectionOnboarding",
      aggregateId: onboarding.id,
      eventType,
      payload: {
        type: eventType,
        onboardingId: onboarding.id,
        workspaceId: onboarding.workspaceId,
        channel: onboarding.channel,
        status: onboarding.status,
      },
    }).returning({ id: outboxEvents.id });
    if (event) await tx.insert(auditLogs).values({
      workspaceId: onboarding.workspaceId,
      actorUserId,
      action: eventType,
      subjectType: "ConnectionOnboarding",
      subjectId: onboarding.id,
      changes: { channel: onboarding.channel, status: onboarding.status },
      sourceEventId: event.id,
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

function toOnboardingView(row: typeof connectionOnboardings.$inferSelect): ConnectionOnboardingView {
  return {
    id: row.id,
    provider: row.provider,
    channel: row.channel,
    step: row.step,
    status: row.status,
    hostedUrl: row.hostedUrl,
    providerAccountId: row.providerAccountId,
    result: row.result,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAlertView(row: typeof accountHealthAlerts.$inferSelect): AccountHealthAlertView {
  return {
    id: row.id,
    connectedAccountId: row.connectedAccountId,
    status: row.status,
    reasonCode: row.reasonCode,
    reasonMessage: row.reasonMessage,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function confirmedSendingChannels(capabilities: unknown): string[] {
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return [];
  return Object.entries(capabilities as Record<string, unknown>)
    .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value) && Object.values(value as Record<string, unknown>).some((flag) => flag === true))
    .map(([channel]) => channel)
    .filter((channel) => ["email", "linkedin", "whatsapp"].includes(channel));
}

function quotaForChannel(channel: string, sentToday: number, quotas: unknown): AccountQuotaView["channels"][number] {
  const channelQuota = quotas && typeof quotas === "object" && !Array.isArray(quotas)
    ? (quotas as Record<string, unknown>)[channel]
    : undefined;
  const root = quotas && typeof quotas === "object" && !Array.isArray(quotas) ? quotas as Record<string, unknown> : {};
  const candidate = channelQuota && typeof channelQuota === "object" && !Array.isArray(channelQuota) ? channelQuota as Record<string, unknown> : {};
  const rawLimit = candidate.daily ?? candidate.limit ?? root.daily ?? root.limit;
  const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : typeof rawLimit === "string" && Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : null;
  const percentage = limit && limit > 0 ? Math.min(100, (sentToday / limit) * 100) : null;
  const state = limit === null ? "unlimited" : sentToday >= limit ? "reached" : sentToday >= limit * 0.8 ? "near_limit" : "ok";
  return { channel, sentToday, limit, percentage, state };
}
