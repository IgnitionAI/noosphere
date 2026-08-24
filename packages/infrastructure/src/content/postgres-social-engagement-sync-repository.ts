import { and, count, desc, eq, isNull, lt, lte, ne, notExists, or, sql } from "drizzle-orm";
import type {
  SocialEngagementSyncLease,
  SocialEngagementSyncRepository,
  SocialEngagementSyncStatusView,
  SocialEngagementSyncTarget,
  SocialInteractionView,
} from "@outbound/application/content/social-engagement-sync";
import type { SocialEngagementSnapshot } from "@outbound/application/content/social-ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  socialContentItems,
  socialInteractions,
  socialInteractionSyncStates,
} from "@outbound/infrastructure/database/schema";

export class PostgresSocialEngagementSyncRepository implements SocialEngagementSyncRepository {
  constructor(private readonly database: Database) {}

  async listDueTargets(input: { readonly workspaceId?: string; readonly now: Date; readonly limit: number }): Promise<readonly SocialEngagementSyncTarget[]> {
    const missing = await this.database.select({
      workspaceId: socialContentItems.workspaceId,
      socialContentId: socialContentItems.id,
      connectedAccountId: socialContentItems.connectedAccountId,
      providerAccountId: socialContentItems.providerAccountId,
      providerSocialId: socialContentItems.socialId,
      ownerProviderId: socialContentItems.authorProviderId,
    }).from(socialContentItems).where(and(
      eq(socialContentItems.status, "observed"),
      sql`${socialContentItems.socialId} is not null`,
      ...(input.workspaceId ? [eq(socialContentItems.workspaceId, input.workspaceId)] : []),
      or(
        notExists(this.database.select({ id: socialInteractionSyncStates.id }).from(socialInteractionSyncStates).where(and(
          eq(socialInteractionSyncStates.workspaceId, socialContentItems.workspaceId),
          eq(socialInteractionSyncStates.socialContentId, socialContentItems.id),
          eq(socialInteractionSyncStates.kind, "comments"),
          eq(socialInteractionSyncStates.scopeKey, "post"),
        ))),
        notExists(this.database.select({ id: socialInteractionSyncStates.id }).from(socialInteractionSyncStates).where(and(
          eq(socialInteractionSyncStates.workspaceId, socialContentItems.workspaceId),
          eq(socialInteractionSyncStates.socialContentId, socialContentItems.id),
          eq(socialInteractionSyncStates.kind, "reactions"),
          eq(socialInteractionSyncStates.scopeKey, "post"),
        ))),
      ),
    )).orderBy(desc(socialContentItems.lastSeenAt)).limit(input.limit);
    for (const post of missing) {
      if (!post.providerSocialId) continue;
      await this.database.insert(socialInteractionSyncStates).values((["comments", "reactions"] as const).map((kind) => ({
        id: crypto.randomUUID(),
        workspaceId: post.workspaceId,
        socialContentId: post.socialContentId,
        connectedAccountId: post.connectedAccountId,
        providerAccountId: post.providerAccountId,
        providerSocialId: post.providerSocialId!,
        ownerProviderId: post.ownerProviderId,
        kind,
        scopeKey: "post",
        nextSyncAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      }))).onConflictDoNothing({
        target: [socialInteractionSyncStates.workspaceId, socialInteractionSyncStates.socialContentId, socialInteractionSyncStates.kind, socialInteractionSyncStates.scopeKey],
      });
    }
    const rows = await this.database.select({
      state: socialInteractionSyncStates,
      currentSocialId: socialContentItems.socialId,
      currentOwnerId: socialContentItems.authorProviderId,
    }).from(socialInteractionSyncStates).innerJoin(socialContentItems, and(
      eq(socialContentItems.workspaceId, socialInteractionSyncStates.workspaceId),
      eq(socialContentItems.id, socialInteractionSyncStates.socialContentId),
    )).where(and(
      eq(socialContentItems.status, "observed"),
      sql`${socialContentItems.socialId} is not null`,
      lte(socialInteractionSyncStates.nextSyncAt, input.now),
      or(
        ne(socialInteractionSyncStates.status, "syncing"),
        isNull(socialInteractionSyncStates.lockedUntil),
        lte(socialInteractionSyncStates.lockedUntil, input.now),
      ),
      ...(input.workspaceId ? [eq(socialInteractionSyncStates.workspaceId, input.workspaceId)] : []),
    )).orderBy(socialInteractionSyncStates.nextSyncAt, socialInteractionSyncStates.createdAt).limit(input.limit);
    return rows.flatMap(({ state, currentSocialId, currentOwnerId }) => currentSocialId ? [{
      workspaceId: state.workspaceId,
      socialContentId: state.socialContentId,
      connectedAccountId: state.connectedAccountId,
      providerAccountId: state.providerAccountId,
      providerSocialId: currentSocialId,
      ownerProviderId: currentOwnerId,
      kind: state.kind as "comments" | "reactions",
      scopeKey: state.scopeKey,
      parentProviderInteractionId: state.parentProviderInteractionId,
    }] : []);
  }

  async acquire(input: SocialEngagementSyncTarget & { readonly now: Date; readonly leaseMs: number }): Promise<SocialEngagementSyncLease | null> {
    return this.database.transaction(async (tx) => {
      let state = (await tx.select().from(socialInteractionSyncStates).where(and(
        eq(socialInteractionSyncStates.workspaceId, input.workspaceId),
        eq(socialInteractionSyncStates.socialContentId, input.socialContentId),
        eq(socialInteractionSyncStates.kind, input.kind),
        eq(socialInteractionSyncStates.scopeKey, input.scopeKey),
      )).limit(1).for("update"))[0];
      if (!state) return null;
      if (state.providerSocialId !== input.providerSocialId || state.providerAccountId !== input.providerAccountId) {
        state = (await tx.update(socialInteractionSyncStates).set({
          providerAccountId: input.providerAccountId,
          providerSocialId: input.providerSocialId,
          ownerProviderId: input.ownerProviderId,
          cursor: null,
          scanToken: null,
          status: "idle",
          leaseToken: null,
          lockedUntil: null,
          nextSyncAt: input.now,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: input.now,
        }).where(eq(socialInteractionSyncStates.id, state.id)).returning())[0]!;
      }
      const leaseToken = crypto.randomUUID();
      const scanToken = state.scanToken ?? crypto.randomUUID();
      const leased = (await tx.update(socialInteractionSyncStates).set({
        ownerProviderId: input.ownerProviderId,
        status: "syncing",
        leaseToken,
        scanToken,
        lockedUntil: new Date(input.now.getTime() + input.leaseMs),
        lastAttemptAt: input.now,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: input.now,
      }).where(and(
        eq(socialInteractionSyncStates.id, state.id),
        eq(socialInteractionSyncStates.workspaceId, input.workspaceId),
        lte(socialInteractionSyncStates.nextSyncAt, input.now),
        or(
          ne(socialInteractionSyncStates.status, "syncing"),
          isNull(socialInteractionSyncStates.lockedUntil),
          lte(socialInteractionSyncStates.lockedUntil, input.now),
        ),
      )).returning())[0];
      return leased ? toLease(leased) : null;
    });
  }

  async persistPage(input: Parameters<SocialEngagementSyncRepository["persistPage"]>[0]): Promise<number> {
    return this.database.transaction(async (tx) => {
      const locked = (await tx.select().from(socialInteractionSyncStates).where(and(
        eq(socialInteractionSyncStates.workspaceId, input.lease.workspaceId),
        eq(socialInteractionSyncStates.id, input.lease.stateId),
        eq(socialInteractionSyncStates.status, "syncing"),
        eq(socialInteractionSyncStates.leaseToken, input.lease.leaseToken),
        eq(socialInteractionSyncStates.scanToken, input.lease.scanToken),
      )).limit(1).for("update"))[0];
      if (!locked) throw new Error("SOCIAL_ENGAGEMENT_SYNC_LEASE_LOST");
      for (const engagement of input.engagements) {
        await persistEngagement(tx, input.lease, engagement, input.now);
        if ((engagement.type === "comment" || engagement.type === "reply") && engagement.replyCount > 0) {
          await seedChildScope(tx, input.lease, engagement.providerInteractionId, "comments", input.now);
        }
        if ((engagement.type === "comment" || engagement.type === "reply") && engagement.reactionCount > 0) {
          await seedChildScope(tx, input.lease, engagement.providerInteractionId, "reactions", input.now);
        }
      }
      if (input.nextCursor === null) {
        await tx.update(socialInteractions).set({
          status: "removed",
          removedAt: input.now,
          updatedAt: input.now,
        }).where(and(
          eq(socialInteractions.workspaceId, input.lease.workspaceId),
          eq(socialInteractions.socialContentId, input.lease.socialContentId),
          eq(socialInteractions.syncKind, input.lease.kind),
          eq(socialInteractions.scopeKey, input.lease.scopeKey),
          ne(socialInteractions.lastScanToken, input.lease.scanToken),
          eq(socialInteractions.status, "observed"),
        ));
      }
      const completed = await tx.update(socialInteractionSyncStates).set({
        cursor: input.nextCursor,
        scanToken: input.nextCursor ? input.lease.scanToken : null,
        status: "idle",
        leaseToken: null,
        lockedUntil: null,
        nextSyncAt: input.nextCursor ? input.now : new Date(input.now.getTime() + input.refreshIntervalMs),
        lastSuccessAt: input.now,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: input.now,
      }).where(and(
        eq(socialInteractionSyncStates.workspaceId, input.lease.workspaceId),
        eq(socialInteractionSyncStates.id, input.lease.stateId),
        eq(socialInteractionSyncStates.leaseToken, input.lease.leaseToken),
        eq(socialInteractionSyncStates.scanToken, input.lease.scanToken),
      )).returning({ id: socialInteractionSyncStates.id });
      if (!completed[0]) throw new Error("SOCIAL_ENGAGEMENT_SYNC_LEASE_LOST");
      return input.engagements.length;
    });
  }

  async markFailed(input: Parameters<SocialEngagementSyncRepository["markFailed"]>[0]): Promise<void> {
    if (input.code === "SOCIAL_RATE_LIMITED") {
      await this.database.transaction(async (tx) => {
        const retryAt = new Date(input.now.getTime() + input.retryAfterMs);
        const released = await tx.update(socialInteractionSyncStates).set({
          status: "idle",
          leaseToken: null,
          lockedUntil: null,
          nextSyncAt: retryAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: input.now,
        }).where(and(
          eq(socialInteractionSyncStates.workspaceId, input.lease.workspaceId),
          eq(socialInteractionSyncStates.id, input.lease.stateId),
          eq(socialInteractionSyncStates.leaseToken, input.lease.leaseToken),
          eq(socialInteractionSyncStates.scanToken, input.lease.scanToken),
        )).returning({ id: socialInteractionSyncStates.id });
        if (!released[0]) throw new Error("SOCIAL_ENGAGEMENT_SYNC_LEASE_LOST");

        await tx.update(socialInteractionSyncStates).set({
          status: "idle",
          nextSyncAt: retryAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: input.now,
        }).where(and(
          eq(socialInteractionSyncStates.workspaceId, input.lease.workspaceId),
          eq(socialInteractionSyncStates.providerAccountId, input.lease.providerAccountId),
          lte(socialInteractionSyncStates.nextSyncAt, retryAt),
          or(
            ne(socialInteractionSyncStates.status, "error"),
            eq(socialInteractionSyncStates.lastErrorCode, "SOCIAL_RATE_LIMITED"),
          ),
          or(
            ne(socialInteractionSyncStates.status, "syncing"),
            isNull(socialInteractionSyncStates.lockedUntil),
            lte(socialInteractionSyncStates.lockedUntil, input.now),
          ),
        ));
      });
      return;
    }

    const updated = await this.database.update(socialInteractionSyncStates).set({
      status: "error",
      leaseToken: null,
      lockedUntil: null,
      nextSyncAt: new Date(input.now.getTime() + input.retryAfterMs),
      lastErrorCode: input.code,
      lastErrorMessage: input.message.slice(0, 4_000),
      updatedAt: input.now,
    }).where(and(
      eq(socialInteractionSyncStates.workspaceId, input.lease.workspaceId),
      eq(socialInteractionSyncStates.id, input.lease.stateId),
      eq(socialInteractionSyncStates.leaseToken, input.lease.leaseToken),
      eq(socialInteractionSyncStates.scanToken, input.lease.scanToken),
    )).returning({ id: socialInteractionSyncStates.id });
    if (!updated[0]) throw new Error("SOCIAL_ENGAGEMENT_SYNC_LEASE_LOST");
  }

  async list(input: Parameters<SocialEngagementSyncRepository["list"]>[0]) {
    const cursor = input.cursor ? parseCursor(input.cursor) : null;
    const rows = await this.database.select({ interaction: socialInteractions, post: socialContentItems }).from(socialInteractions).innerJoin(socialContentItems, and(
      eq(socialContentItems.workspaceId, socialInteractions.workspaceId),
      eq(socialContentItems.id, socialInteractions.socialContentId),
    )).where(and(
      eq(socialInteractions.workspaceId, input.workspaceId),
      ...(input.type ? [eq(socialInteractions.type, input.type)] : []),
      ...(input.socialContentId ? [eq(socialInteractions.socialContentId, input.socialContentId)] : []),
      ...(input.direction ? [eq(socialInteractions.direction, input.direction)] : []),
      ...(input.status ? [eq(socialInteractions.status, input.status)] : []),
      ...(cursor ? [or(
        lt(socialInteractions.lastSeenAt, cursor.at),
        and(eq(socialInteractions.lastSeenAt, cursor.at), lt(socialInteractions.id, cursor.id)),
      )!] : []),
    )).orderBy(desc(socialInteractions.lastSeenAt), desc(socialInteractions.id)).limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const data = rows.slice(0, input.limit).map(({ interaction, post }) => toView(interaction, post));
    const last = data.at(-1);
    return { data, nextCursor: hasMore && last ? `${last.lastSeenAt.toISOString()}|${last.id}` : null };
  }

  async status(input: { readonly workspaceId: string }): Promise<SocialEngagementSyncStatusView> {
    const [posts, states, observed, incoming] = await Promise.all([
      this.database.select({ value: count() }).from(socialContentItems).where(and(eq(socialContentItems.workspaceId, input.workspaceId), eq(socialContentItems.status, "observed"), sql`${socialContentItems.socialId} is not null`)),
      this.database.select().from(socialInteractionSyncStates).where(eq(socialInteractionSyncStates.workspaceId, input.workspaceId)).orderBy(desc(socialInteractionSyncStates.updatedAt)),
      this.database.select({ value: count() }).from(socialInteractions).where(and(eq(socialInteractions.workspaceId, input.workspaceId), eq(socialInteractions.status, "observed"))),
      this.database.select({ value: count() }).from(socialInteractions).where(and(eq(socialInteractions.workspaceId, input.workspaceId), eq(socialInteractions.status, "observed"), eq(socialInteractions.direction, "incoming"))),
    ]);
    if (Number(posts[0]?.value ?? 0) === 0) return { status: "not_configured", observed: 0, incoming: 0, lastSuccessAt: null, nextSyncAt: null, lastErrorCode: null, lastErrorMessage: null };
    const error = states.find((state) => state.status === "error");
    const status = error ? "error" : states.some((state) => state.status === "syncing") ? "syncing" : "idle";
    return {
      status,
      observed: Number(observed[0]?.value ?? 0),
      incoming: Number(incoming[0]?.value ?? 0),
      lastSuccessAt: latestDate(...states.map((state) => state.lastSuccessAt)),
      nextSyncAt: earliestDate(...states.map((state) => state.nextSyncAt)),
      lastErrorCode: error?.lastErrorCode ?? null,
      lastErrorMessage: error?.lastErrorMessage ?? null,
    };
  }
}

async function persistEngagement(tx: any, lease: SocialEngagementSyncLease, engagement: SocialEngagementSnapshot, now: Date) {
  await tx.insert(socialInteractions).values({
    id: crypto.randomUUID(),
    workspaceId: lease.workspaceId,
    socialContentId: lease.socialContentId,
    connectedAccountId: lease.connectedAccountId,
    providerAccountId: lease.providerAccountId,
    syncKind: lease.kind,
    scopeKey: lease.scopeKey,
    type: engagement.type,
    providerInteractionId: engagement.providerInteractionId,
    parentProviderInteractionId: engagement.parentProviderInteractionId,
    direction: directionFor(engagement.actor.providerId, lease.ownerProviderId),
    actorProviderId: engagement.actor.providerId,
    actorName: engagement.actor.name,
    actorHeadline: engagement.actor.headline,
    actorProfileUrl: engagement.actor.profileUrl,
    body: engagement.body,
    reaction: engagement.reaction,
    mentionedProviderId: engagement.mentionedProviderId,
    mentionedName: engagement.mentionedName,
    status: "observed",
    occurredAt: engagement.occurredAt,
    firstSeenAt: engagement.observedAt,
    lastSeenAt: engagement.observedAt,
    removedAt: null,
    lastScanToken: lease.scanToken,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [socialInteractions.workspaceId, socialInteractions.socialContentId, socialInteractions.type, socialInteractions.providerInteractionId],
    set: {
      parentProviderInteractionId: engagement.parentProviderInteractionId,
      direction: directionFor(engagement.actor.providerId, lease.ownerProviderId),
      actorProviderId: engagement.actor.providerId,
      actorName: engagement.actor.name,
      actorHeadline: engagement.actor.headline,
      actorProfileUrl: engagement.actor.profileUrl,
      body: engagement.body,
      reaction: engagement.reaction,
      mentionedProviderId: engagement.mentionedProviderId,
      mentionedName: engagement.mentionedName,
      status: "observed",
      ...(engagement.occurredAt ? { occurredAt: engagement.occurredAt } : {}),
      lastSeenAt: engagement.observedAt,
      removedAt: null,
      lastScanToken: lease.scanToken,
      updatedAt: now,
    },
  });
}

async function seedChildScope(tx: any, lease: SocialEngagementSyncLease, parentId: string, kind: "comments" | "reactions", now: Date) {
  await tx.insert(socialInteractionSyncStates).values({
    id: crypto.randomUUID(),
    workspaceId: lease.workspaceId,
    socialContentId: lease.socialContentId,
    connectedAccountId: lease.connectedAccountId,
    providerAccountId: lease.providerAccountId,
    providerSocialId: lease.providerSocialId,
    ownerProviderId: lease.ownerProviderId,
    kind,
    scopeKey: `comment:${parentId}`,
    parentProviderInteractionId: parentId,
    nextSyncAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({
    target: [socialInteractionSyncStates.workspaceId, socialInteractionSyncStates.socialContentId, socialInteractionSyncStates.kind, socialInteractionSyncStates.scopeKey],
  });
}

function toLease(row: typeof socialInteractionSyncStates.$inferSelect): SocialEngagementSyncLease {
  if (!row.leaseToken || !row.scanToken) throw new Error("SOCIAL_ENGAGEMENT_SYNC_LEASE_MISSING");
  return {
    stateId: row.id,
    leaseToken: row.leaseToken,
    scanToken: row.scanToken,
    workspaceId: row.workspaceId,
    socialContentId: row.socialContentId,
    connectedAccountId: row.connectedAccountId,
    providerAccountId: row.providerAccountId,
    providerSocialId: row.providerSocialId,
    ownerProviderId: row.ownerProviderId,
    kind: row.kind as "comments" | "reactions",
    scopeKey: row.scopeKey,
    parentProviderInteractionId: row.parentProviderInteractionId,
    cursor: row.cursor,
  };
}

function toView(interaction: typeof socialInteractions.$inferSelect, post: typeof socialContentItems.$inferSelect): SocialInteractionView {
  return {
    id: interaction.id,
    socialContentId: interaction.socialContentId,
    publicationId: post.publicationId,
    postText: post.text,
    postUrl: post.url,
    type: interaction.type as SocialInteractionView["type"],
    providerInteractionId: interaction.providerInteractionId,
    parentProviderInteractionId: interaction.parentProviderInteractionId,
    direction: interaction.direction as SocialInteractionView["direction"],
    actorProviderId: interaction.actorProviderId,
    actorName: interaction.actorName,
    actorHeadline: interaction.actorHeadline,
    actorProfileUrl: interaction.actorProfileUrl,
    body: interaction.body,
    reaction: interaction.reaction,
    mentionedProviderId: interaction.mentionedProviderId,
    mentionedName: interaction.mentionedName,
    status: interaction.status as SocialInteractionView["status"],
    occurredAt: interaction.occurredAt,
    firstSeenAt: interaction.firstSeenAt,
    lastSeenAt: interaction.lastSeenAt,
    removedAt: interaction.removedAt,
  };
}

function directionFor(actorProviderId: string | null, ownerProviderId: string | null): "owner" | "incoming" | "unknown" {
  if (!actorProviderId || !ownerProviderId) return "unknown";
  return actorProviderId === ownerProviderId ? "owner" : "incoming";
}
function parseCursor(value: string) { const separator = value.indexOf("|"); const at = new Date(separator > 0 ? value.slice(0, separator) : ""); const id = separator > 0 ? value.slice(separator + 1) : ""; if (Number.isNaN(at.getTime()) || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error("SOCIAL_ENGAGEMENT_CURSOR_INVALID"); return { at, id }; }
function latestDate(...values: (Date | null)[]): Date | null { return values.reduce<Date | null>((latest, value) => !value || latest && latest >= value ? latest : value, null); }
function earliestDate(...values: (Date | null)[]): Date | null { return values.reduce<Date | null>((earliest, value) => !value || earliest && earliest <= value ? earliest : value, null); }
