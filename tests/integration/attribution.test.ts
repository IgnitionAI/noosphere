import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { AttributionReconciler } from "@outbound/application/attribution/attribution";
import { PostgresAttributionRepository } from "@outbound/infrastructure/attribution/postgres-attribution-repository";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresOperationalViews } from "@outbound/infrastructure/workspaces/postgres-operational-views";
import {
  attributionTouches,
  authUsers,
  calendarBookings,
  calendarConnections,
  connectedAccounts,
  contactIdentities,
  contacts,
  conversations,
  socialContentItems,
  socialInteractions,
  socialInteractionSyncStates,
  workspaces,
} from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("ATT-101 evidence-led attribution", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const repository = new PostgresAttributionRepository(database.db);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const otherAccountId = crypto.randomUUID();
  const postId = crypto.randomUUID();
  const otherPostId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const secondContactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();
  const firstInteractionId = crypto.randomUUID();
  const lastInteractionId = crypto.randomUUID();
  const ambiguousInteractionId = crypto.randomUUID();
  const unknownInteractionId = crypto.randomUUID();
  const now = new Date("2026-08-21T08:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `attribution-a-${workspaceId}`, name: "Attribution A" },
      { id: otherWorkspaceId, slug: `attribution-b-${otherWorkspaceId}`, name: "Attribution B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Attribution Owner", email: `attribution-${userId}@example.com` });
    await database.db.insert(connectedAccounts).values([
      { id: accountId, workspaceId, provider: "unipile", providerAccountId: "linkedin-account-attribution", displayName: "LinkedIn attribution", status: "connected", capabilities: { linkedin: true }, encryptedSecret: "fixture", createdBy: userId },
      { id: otherAccountId, workspaceId: otherWorkspaceId, provider: "unipile", providerAccountId: "linkedin-account-other", displayName: "LinkedIn other", status: "connected", capabilities: { linkedin: true }, encryptedSecret: "fixture", createdBy: userId },
    ]);
    await database.db.insert(contacts).values([
      { id: contactId, workspaceId, firstName: "Ada", lastName: "Lovelace", source: "provider" },
      { id: secondContactId, workspaceId, firstName: "Grace", lastName: "Hopper", source: "discovery" },
    ]);
    await database.db.insert(contactIdentities).values([
      { id: crypto.randomUUID(), workspaceId, contactId, type: "linkedin", value: "provider-ada", normalizedValue: "unipile:linkedin-account-attribution:provider-ada", verificationStatus: "verified", source: "provider" },
      { id: crypto.randomUUID(), workspaceId, contactId: secondContactId, type: "linkedin", value: "https://linkedin.com/in/grace", normalizedValue: "linkedin.com/in/grace", verificationStatus: "verified", source: "discovery" },
    ]);
    await database.db.insert(conversations).values({ id: conversationId, workspaceId, contactId, connectedAccountId: accountId, provider: "unipile", providerAccountId: "linkedin-account-attribution", providerThreadId: "thread-ada", channel: "linkedin", origin: "outside_campaign", automationMode: "human", status: "open", lastMessageAt: new Date(now.getTime() + 30 * 60_000) });
    await database.db.insert(calendarConnections).values({ id: connectionId, workspaceId, provider: "calcom", bookingUrl: "https://cal.com/ada", status: "active", isDefault: true });
    await database.db.insert(calendarBookings).values({ id: bookingId, workspaceId, connectionId, providerBookingId: "booking-ada", contactId, status: "accepted", attendeeName: "Ada Lovelace", startAt: new Date(now.getTime() + 48 * 60 * 60_000) });
    await database.db.insert(socialContentItems).values([
      { id: postId, workspaceId, connectedAccountId: accountId, providerAccountId: "linkedin-account-attribution", origin: "internal", providerPostId: "post-attribution", socialId: "urn:li:activity:attribution", authorProviderId: "owner-id", text: "Preuve et attribution", url: "https://linkedin.com/feed/update/attribution", status: "observed", firstSeenAt: now, lastSeenAt: now },
      { id: otherPostId, workspaceId: otherWorkspaceId, connectedAccountId: otherAccountId, providerAccountId: "linkedin-account-other", origin: "external", providerPostId: "post-other", socialId: "urn:li:activity:other", authorProviderId: "owner-other", text: "Contenu sans signal", url: "https://linkedin.com/feed/update/other", status: "observed", firstSeenAt: now, lastSeenAt: now },
    ]);
    await database.db.insert(socialInteractionSyncStates).values({ id: crypto.randomUUID(), workspaceId: otherWorkspaceId, socialContentId: otherPostId, connectedAccountId: otherAccountId, providerAccountId: "linkedin-account-other", providerSocialId: "urn:li:activity:other", kind: "comments", scopeKey: "post", status: "idle", nextSyncAt: new Date(now.getTime() + 60 * 60_000), lastSuccessAt: new Date(now.getTime() - 48 * 60 * 60_000) });
    await database.db.insert(socialInteractions).values([
      interaction(firstInteractionId, "provider-ada", "https://linkedin.com/in/ada", now),
      interaction(lastInteractionId, "provider-ada", "https://linkedin.com/in/ada", new Date(now.getTime() + 60 * 60_000)),
      interaction(ambiguousInteractionId, "provider-ada", "https://linkedin.com/in/grace", new Date(now.getTime() + 2 * 60 * 60_000)),
      interaction(unknownInteractionId, "provider-unknown", null, new Date(now.getTime() + 3 * 60 * 60_000), "reaction"),
    ]);
  }, 30_000);

  afterAll(async () => {
    await database.db.delete(attributionTouches).where(inArray(attributionTouches.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(calendarBookings).where(inArray(calendarBookings.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(calendarConnections).where(inArray(calendarConnections.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(conversations).where(inArray(conversations.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(contactIdentities).where(inArray(contactIdentities.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(contacts).where(inArray(contacts.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(socialInteractions).where(inArray(socialInteractions.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(socialContentItems).where(inArray(socialContentItems.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(connectedAccounts).where(inArray(connectedAccounts.workspaceId, [workspaceId, otherWorkspaceId]));
    await database.db.delete(authUsers).where(eq(authUsers.id, userId));
    await database.db.delete(workspaces).where(inArray(workspaces.id, [workspaceId, otherWorkspaceId]));
    await database.close();
  }, 30_000);

  test("resolves only exact identities and keeps ambiguous or unknown actors unmerged", async () => {
    const reconciler = new AttributionReconciler(repository, { now: () => new Date(now.getTime() + 4 * 60 * 60_000) });
    expect(await reconciler.reconcile(workspaceId)).toBe(4);
    const journeys = await repository.listJourneys({ workspaceId, limit: 20 });
    expect(journeys.data).toHaveLength(4);
    expect(journeys.data.find((item) => item.interaction.id === firstInteractionId)).toMatchObject({ resolution: "resolved" });
    expect(journeys.data.find((item) => item.interaction.id === ambiguousInteractionId)).toMatchObject({ resolution: "ambiguous" });
    expect(journeys.data.find((item) => item.interaction.id === unknownInteractionId)).toMatchObject({ resolution: "unknown" });
    expect((await database.db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId)))).toHaveLength(2);
    expect((await repository.listJourneys({ workspaceId: otherWorkspaceId, limit: 20 })).data).toEqual([]);

    const activity = await new PostgresOperationalViews(database.db).getActivity({ workspaceId, lens: "symbiosis", limit: 20 });
    expect(activity).toMatchObject({ state: "attention", quality: "partial" });
    expect(Object.fromEntries(activity.counters.map((counter) => [counter.key, counter.value]))).toEqual({
      "explicit-signals": 3,
      "resolved-identities": 2,
      conversations: 1,
      calls: 1,
    });
    expect(activity.items.find((item) => item.id === `symbiosis:${unknownInteractionId}`)).toMatchObject({
      status: "attention",
      href: `/attribution?interactionId=${unknownInteractionId}`,
    });
    expect(activity.items.find((item) => item.id === `symbiosis:${unknownInteractionId}`)?.detail).toContain("Aucun message automatique");
    expect(await new PostgresOperationalViews(database.db).getActivity({ workspaceId: otherWorkspaceId, lens: "symbiosis", limit: 20 })).toMatchObject({ state: "idle", quality: "stale", items: [] });
  });

  test("reproduces first and last touch while labelling the booking link as inference", async () => {
    const byBooking = await repository.listJourneys({ workspaceId, bookingId, limit: 20 });
    expect(byBooking.data.map((journey) => journey.interaction.id)).toEqual([lastInteractionId, firstInteractionId]);
    const firstTouch = byBooking.data.find((journey) => journey.interaction.id === firstInteractionId)!.touches.find((touch) => touch.kind === "booking");
    const lastTouch = byBooking.data.find((journey) => journey.interaction.id === lastInteractionId)!.touches.find((touch) => touch.kind === "booking");
    expect(firstTouch).toMatchObject({ certainty: "inference", confidence: 0.6, position: "first", rule: "same_verified_contact_after_touch_90d_v1" });
    expect(lastTouch).toMatchObject({ certainty: "inference", confidence: 0.6, position: "last", rule: "same_verified_contact_after_touch_90d_v1" });
    expect(firstTouch?.proofHref).toBe(`/appointments?booking=${bookingId}`);
  });

  test("replays idempotently without duplicating attribution edges", async () => {
    const before = await database.db.select().from(attributionTouches).where(eq(attributionTouches.workspaceId, workspaceId));
    await database.db.update(attributionTouches).set({ nextResolutionAt: now }).where(and(
      eq(attributionTouches.workspaceId, workspaceId),
      eq(attributionTouches.logicalKey, "identity"),
    ));
    expect(await new AttributionReconciler(repository, { now: () => new Date(now.getTime() + 5 * 60 * 60_000) }).reconcile(workspaceId)).toBe(4);
    const after = await database.db.select().from(attributionTouches).where(eq(attributionTouches.workspaceId, workspaceId));
    expect(after).toHaveLength(before.length);
    expect(new Set(after.map((touch) => `${touch.socialInteractionId}:${touch.logicalKey}`)).size).toBe(after.length);
  });

  function interaction(id: string, actorProviderId: string, actorProfileUrl: string | null, observedAt: Date, type: "comment" | "reaction" = "comment") {
    return { id, workspaceId, socialContentId: postId, connectedAccountId: accountId, providerAccountId: "linkedin-account-attribution", syncKind: type === "reaction" ? "reactions" : "comments", scopeKey: "post", type, providerInteractionId: `provider-${id}`, direction: "incoming", actorProviderId, actorName: "LinkedIn actor", actorProfileUrl, body: type === "reaction" ? null : "Je souhaite en savoir plus", reaction: type === "reaction" ? "like" : null, status: "observed", firstSeenAt: observedAt, lastSeenAt: observedAt, lastScanToken: crypto.randomUUID(), createdAt: observedAt, updatedAt: observedAt } as const;
  }
});
