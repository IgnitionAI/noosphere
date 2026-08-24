import { and, count, desc, eq, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type {
  SocialContentItemView,
  SocialContentSyncAccount,
  SocialContentSyncLease,
  SocialContentSyncRepository,
  SocialContentSyncStatusView,
} from "@outbound/application/content/social-content-sync";
import type { SocialContentSnapshot, SocialMetricsSnapshot } from "@outbound/application/content/social-ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  connectedAccounts,
  contentMetricSnapshots,
  contentPublications,
  socialContentItems,
  socialContentSyncStates,
} from "@outbound/infrastructure/database/schema";

export class PostgresSocialContentSyncRepository implements SocialContentSyncRepository {
  constructor(private readonly database: Database) {}

  async listDueAccounts(input: { readonly workspaceId?: string; readonly now: Date }): Promise<readonly SocialContentSyncAccount[]> {
    const rows = await this.database.select({
      workspaceId: connectedAccounts.workspaceId,
      connectedAccountId: connectedAccounts.id,
      providerAccountId: connectedAccounts.providerAccountId,
      stateStatus: socialContentSyncStates.status,
      nextSyncAt: socialContentSyncStates.nextSyncAt,
      lockedUntil: socialContentSyncStates.lockedUntil,
    }).from(connectedAccounts).leftJoin(socialContentSyncStates, and(
      eq(socialContentSyncStates.workspaceId, connectedAccounts.workspaceId),
      eq(socialContentSyncStates.connectedAccountId, connectedAccounts.id),
    )).where(and(
      eq(connectedAccounts.provider, "unipile"),
      eq(connectedAccounts.status, "connected"),
      sql`${connectedAccounts.capabilities} ? 'linkedin'`,
      ...(input.workspaceId ? [eq(connectedAccounts.workspaceId, input.workspaceId)] : []),
    ));
    return rows.filter((row) => {
      if (!row.nextSyncAt) return true;
      if (row.nextSyncAt > input.now) return false;
      return row.stateStatus !== "syncing" || !row.lockedUntil || row.lockedUntil <= input.now;
    }).map(({ workspaceId, connectedAccountId, providerAccountId }) => ({ workspaceId, connectedAccountId, providerAccountId }));
  }

  async acquire(input: SocialContentSyncAccount & { readonly now: Date; readonly leaseMs: number }): Promise<SocialContentSyncLease | null> {
    return this.database.transaction(async (tx) => {
      const inserted = (await tx.insert(socialContentSyncStates).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        connectedAccountId: input.connectedAccountId,
        providerAccountId: input.providerAccountId,
        nextSyncAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      }).onConflictDoNothing({ target: [socialContentSyncStates.workspaceId, socialContentSyncStates.connectedAccountId] }).returning())[0];
      let state = inserted ?? (await tx.select().from(socialContentSyncStates).where(and(
        eq(socialContentSyncStates.workspaceId, input.workspaceId),
        eq(socialContentSyncStates.connectedAccountId, input.connectedAccountId),
      )).limit(1).for("update"))[0];
      if (!state) throw new Error("SOCIAL_CONTENT_SYNC_STATE_MISSING");
      if (state.providerAccountId !== input.providerAccountId) {
        state = (await tx.update(socialContentSyncStates).set({
          providerAccountId: input.providerAccountId,
          cursor: null,
          highWatermark: null,
          backfillComplete: false,
          status: "idle",
          leaseToken: null,
          lockedUntil: null,
          nextSyncAt: input.now,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: input.now,
        }).where(eq(socialContentSyncStates.id, state.id)).returning())[0]!;
      }
      const leaseToken = crypto.randomUUID();
      const leased = (await tx.update(socialContentSyncStates).set({
        status: "syncing",
        leaseToken,
        lockedUntil: new Date(input.now.getTime() + input.leaseMs),
        lastAttemptAt: input.now,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: input.now,
      }).where(and(
        eq(socialContentSyncStates.id, state.id),
        eq(socialContentSyncStates.workspaceId, input.workspaceId),
        lte(socialContentSyncStates.nextSyncAt, input.now),
        or(
          ne(socialContentSyncStates.status, "syncing"),
          isNull(socialContentSyncStates.lockedUntil),
          lte(socialContentSyncStates.lockedUntil, input.now),
        ),
      )).returning())[0];
      return leased ? toLease(leased) : null;
    });
  }

  async persistPage(input: Parameters<SocialContentSyncRepository["persistPage"]>[0]): Promise<number> {
    return this.database.transaction(async (tx) => {
      const locked = (await tx.select({ id: socialContentSyncStates.id }).from(socialContentSyncStates).where(and(
        eq(socialContentSyncStates.workspaceId, input.lease.workspaceId),
        eq(socialContentSyncStates.id, input.lease.stateId),
        eq(socialContentSyncStates.status, "syncing"),
        eq(socialContentSyncStates.leaseToken, input.lease.leaseToken),
      )).limit(1).for("update"))[0];
      if (!locked) throw new Error("SOCIAL_CONTENT_SYNC_LEASE_LOST");
      const metrics = new Map(input.metrics.map((snapshot) => [snapshot.providerPostId, snapshot]));
      let highWatermark = input.lease.highWatermark;
      for (const post of input.posts) {
        highWatermark = latestDate(highWatermark, post.publishedAt);
        const publication = await matchingPublication(tx, input.lease, post);
        const metric = metrics.get(post.providerPostId) ?? (post.socialId ? metrics.get(numericActivityId(post.socialId) ?? post.socialId) : undefined);
        const [stored] = await tx.insert(socialContentItems).values({
          id: crypto.randomUUID(),
          workspaceId: input.lease.workspaceId,
          connectedAccountId: input.lease.connectedAccountId,
          providerAccountId: input.lease.providerAccountId,
          publicationId: publication?.id ?? null,
          origin: publication ? "internal" : "external",
          providerPostId: post.providerPostId,
          socialId: post.socialId,
          authorProviderId: post.authorProviderId,
          text: post.text,
          url: post.url,
          status: "observed",
          publishedAt: post.publishedAt,
          ...(metric ? metricValues(metric) : {}),
          metricsObservedAt: metric?.observedAt ?? null,
          firstSeenAt: post.observedAt,
          lastSeenAt: post.observedAt,
          createdAt: input.now,
          updatedAt: input.now,
        }).onConflictDoUpdate({
          target: [socialContentItems.workspaceId, socialContentItems.connectedAccountId, socialContentItems.providerPostId],
          set: {
            publicationId: publication?.id ?? null,
            origin: publication ? "internal" : "external",
            socialId: post.socialId,
            authorProviderId: post.authorProviderId,
            text: post.text,
            url: post.url,
            status: "observed",
            publishedAt: post.publishedAt,
            ...(metric ? metricValues(metric) : {}),
            ...(metric ? { metricsObservedAt: metric.observedAt } : {}),
            lastSeenAt: post.observedAt,
            updatedAt: input.now,
          },
        }).returning({ id: socialContentItems.id });
        if (stored && metric) {
          await tx.insert(contentMetricSnapshots).values({
            id: crypto.randomUUID(),
            workspaceId: input.lease.workspaceId,
            socialContentId: stored.id,
            providerPostId: post.providerPostId,
            ...metricValues(metric),
            observedAt: metric.observedAt,
            createdAt: input.now,
          }).onConflictDoNothing({ target: [contentMetricSnapshots.workspaceId, contentMetricSnapshots.socialContentId, contentMetricSnapshots.observedAt] });
        }
      }
      const backfillComplete = input.lease.backfillComplete || input.nextCursor === null;
      const completed = await tx.update(socialContentSyncStates).set({
        cursor: input.nextCursor,
        highWatermark,
        backfillComplete,
        status: "idle",
        leaseToken: null,
        lockedUntil: null,
        nextSyncAt: input.nextCursor ? input.now : new Date(input.now.getTime() + input.refreshIntervalMs),
        lastSuccessAt: input.now,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: input.now,
      }).where(and(
        eq(socialContentSyncStates.workspaceId, input.lease.workspaceId),
        eq(socialContentSyncStates.id, input.lease.stateId),
        eq(socialContentSyncStates.leaseToken, input.lease.leaseToken),
      )).returning({ id: socialContentSyncStates.id });
      if (!completed[0]) throw new Error("SOCIAL_CONTENT_SYNC_LEASE_LOST");
      return input.posts.length;
    });
  }

  async markFailed(input: Parameters<SocialContentSyncRepository["markFailed"]>[0]): Promise<void> {
    const automaticallyDeferred = input.code === "SOCIAL_RATE_LIMITED";
    const updated = await this.database.update(socialContentSyncStates).set({
      status: automaticallyDeferred ? "idle" : "error",
      leaseToken: null,
      lockedUntil: null,
      nextSyncAt: new Date(input.now.getTime() + input.retryAfterMs),
      lastErrorCode: automaticallyDeferred ? null : input.code,
      lastErrorMessage: automaticallyDeferred ? null : input.message.slice(0, 4_000),
      updatedAt: input.now,
    }).where(and(
      eq(socialContentSyncStates.workspaceId, input.lease.workspaceId),
      eq(socialContentSyncStates.id, input.lease.stateId),
      eq(socialContentSyncStates.leaseToken, input.lease.leaseToken),
    )).returning({ id: socialContentSyncStates.id });
    if (!updated[0]) throw new Error("SOCIAL_CONTENT_SYNC_LEASE_LOST");
  }

  async list(input: Parameters<SocialContentSyncRepository["list"]>[0]) {
    const cursor = input.cursor ? parseCursor(input.cursor) : null;
    const rows = await this.database.select().from(socialContentItems).where(and(
      eq(socialContentItems.workspaceId, input.workspaceId),
      ...(cursor ? [or(
        lt(socialContentItems.lastSeenAt, cursor.at),
        and(eq(socialContentItems.lastSeenAt, cursor.at), lt(socialContentItems.id, cursor.id)),
      )!] : []),
    )).orderBy(desc(socialContentItems.lastSeenAt), desc(socialContentItems.id)).limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const data = rows.slice(0, input.limit).map(toView);
    const last = data.at(-1);
    return { data, nextCursor: hasMore && last ? `${last.lastSeenAt.toISOString()}|${last.id}` : null };
  }

  async status(input: { readonly workspaceId: string }): Promise<SocialContentSyncStatusView> {
    const [accounts, states] = await Promise.all([
      this.database.select({ value: count() }).from(connectedAccounts).where(and(
        eq(connectedAccounts.workspaceId, input.workspaceId),
        eq(connectedAccounts.provider, "unipile"),
        eq(connectedAccounts.status, "connected"),
        sql`${connectedAccounts.capabilities} ? 'linkedin'`,
      )),
      this.database.select().from(socialContentSyncStates).where(eq(socialContentSyncStates.workspaceId, input.workspaceId)).orderBy(desc(socialContentSyncStates.updatedAt)),
    ]);
    if (Number(accounts[0]?.value ?? 0) === 0) return { status: "not_configured", backfillComplete: false, lastSuccessAt: null, nextSyncAt: null, lastErrorCode: null, lastErrorMessage: null };
    const latest = states[0];
    const error = states.find((state) => state.status === "error");
    const status = error ? "error" : states.some((state) => state.status === "syncing") ? "syncing" : "idle";
    return {
      status,
      backfillComplete: states.length > 0 && states.every((state) => state.backfillComplete),
      lastSuccessAt: latestDate(...states.map((state) => state.lastSuccessAt)),
      nextSyncAt: earliestDate(...states.map((state) => state.nextSyncAt)),
      lastErrorCode: error?.lastErrorCode ?? null,
      lastErrorMessage: error?.lastErrorMessage ?? null,
    };
  }
}

async function matchingPublication(tx: any, lease: SocialContentSyncLease, post: SocialContentSnapshot) {
  const identifiers = [eq(contentPublications.providerPostId, post.providerPostId)];
  if (post.socialId) identifiers.push(eq(contentPublications.providerSocialId, post.socialId));
  return (await tx.select().from(contentPublications).where(and(
    eq(contentPublications.workspaceId, lease.workspaceId),
    sql`${contentPublications.accountSnapshot}->>'providerAccountId' = ${lease.providerAccountId}`,
    or(...identifiers),
  )).limit(1))[0] as typeof contentPublications.$inferSelect | undefined;
}

function metricValues(metric: SocialMetricsSnapshot) { return { impressions: metric.impressions, reactions: metric.reactions, comments: metric.comments, reposts: metric.reposts }; }
function toLease(row: typeof socialContentSyncStates.$inferSelect): SocialContentSyncLease { if (!row.leaseToken) throw new Error("SOCIAL_CONTENT_SYNC_LEASE_MISSING"); return { stateId: row.id, leaseToken: row.leaseToken, workspaceId: row.workspaceId, connectedAccountId: row.connectedAccountId, providerAccountId: row.providerAccountId, cursor: row.cursor, highWatermark: row.highWatermark, backfillComplete: row.backfillComplete }; }
function toView(row: typeof socialContentItems.$inferSelect): SocialContentItemView { return { id: row.id, publicationId: row.publicationId, origin: row.origin as "internal" | "external", providerPostId: row.providerPostId, socialId: row.socialId, text: row.text, url: row.url, publishedAt: row.publishedAt, status: row.status as "observed" | "unavailable", impressions: row.impressions, reactions: row.reactions, comments: row.comments, reposts: row.reposts, metricsObservedAt: row.metricsObservedAt, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt }; }
function parseCursor(value: string) { const separator = value.indexOf("|"); const at = new Date(separator > 0 ? value.slice(0, separator) : ""); const id = separator > 0 ? value.slice(separator + 1) : ""; if (Number.isNaN(at.getTime()) || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error("SOCIAL_CONTENT_CURSOR_INVALID"); return { at, id }; }
function numericActivityId(value: string): string | null { return value.match(/^urn:li:activity:(\d+)$/)?.[1] ?? null; }
function latestDate(...values: (Date | null)[]): Date | null { return values.reduce<Date | null>((latest, value) => !value || latest && latest >= value ? latest : value, null); }
function earliestDate(...values: (Date | null)[]): Date | null { return values.reduce<Date | null>((earliest, value) => !value || earliest && earliest <= value ? earliest : value, null); }
