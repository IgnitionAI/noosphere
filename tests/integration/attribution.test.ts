import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { AttributionReconciler } from "@outbound/application/attribution/attribution";
import { PostgresAttributionRepository } from "@outbound/infrastructure/attribution/postgres-attribution-repository";
import { PostgresCalendarIntegration } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { PostgresSocialProspectSignalReader } from "@outbound/infrastructure/crm/postgres-social-prospect-signal-reader";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresOperationalViews } from "@outbound/infrastructure/workspaces/postgres-operational-views";
import {
  attributionTouches,
  authUsers,
  calendarBookings,
  calendarConnections,
  campaigns,
  connectedAccounts,
  contactIdentities,
  contacts,
  conversations,
  icps,
  icpVersions,
  socialContentItems,
  socialInteractions,
  socialInteractionSyncStates,
  workspaces,
} from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
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
  const socialOnlyInteractionId = crypto.randomUUID();
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
      interaction(socialOnlyInteractionId, "provider-grace", "https://linkedin.com/in/grace", new Date(now.getTime() + 4 * 60 * 60_000)),
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
    expect(await reconciler.reconcile(workspaceId)).toBe(5);
    const journeys = await repository.listJourneys({ workspaceId, limit: 20 });
    expect(journeys.data).toHaveLength(5);
    expect(journeys.data.find((item) => item.interaction.id === firstInteractionId)).toMatchObject({ resolution: "resolved" });
    expect(journeys.data.find((item) => item.interaction.id === ambiguousInteractionId)).toMatchObject({ resolution: "ambiguous" });
    expect(journeys.data.find((item) => item.interaction.id === unknownInteractionId)).toMatchObject({ resolution: "unknown" });
    expect((await database.db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId)))).toHaveLength(2);
    expect((await repository.listJourneys({ workspaceId: otherWorkspaceId, limit: 20 })).data).toEqual([]);

    const activity = await new PostgresOperationalViews(database.db).getActivity({ workspaceId, lens: "symbiosis", limit: 20 });
    expect(activity).toMatchObject({ state: "attention", quality: "partial" });
    expect(Object.fromEntries(activity.counters.map((counter) => [counter.key, counter.value]))).toEqual({
      "explicit-signals": 4,
      "resolved-identities": 3,
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

    const [booking] = await new PostgresCalendarIntegration(database.db, "attribution-test-signing-key-with-32-characters").listBookings({ workspaceId, contactId, limit: 20 });
    expect(booking).toMatchObject({
      id: bookingId,
      source: "inbound",
      attribution: { certainty: "inference" },
    });
    expect(booking?.attribution.touches.map((touch) => ({ interactionId: touch.interactionId, position: touch.position }))).toEqual([
      { interactionId: firstInteractionId, position: "first" },
      { interactionId: lastInteractionId, position: "last" },
    ]);
    expect(booking?.attribution.firstTouch).toMatchObject({ type: "comment", confidence: 0.6, proofHref: `/attribution?interactionId=${firstInteractionId}` });
  });

  test("classifies calls as inbound, outbound, mixed or unknown without changing booking state", async () => {
    const rollback = new Error("ROLLBACK_BOOKING_SOURCES_FIXTURE");
    try {
      await database.db.transaction(async (transaction) => {
        const icpId = crypto.randomUUID();
        const icpVersionId = crypto.randomUUID();
        const campaignId = crypto.randomUUID();
        const outboundBookingId = crypto.randomUUID();
        const unknownBookingId = crypto.randomUUID();
        await transaction.insert(icps).values({ id: icpId, workspaceId, name: "Call sources fixture", currentVersion: 1 });
        await transaction.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "Call sources fixture", confidence: "1.0000", criteria: {}, buyingCommittee: [], problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedBy: userId, publishedAt: now });
        await transaction.insert(campaigns).values({ id: campaignId, workspaceId, name: "Outbound source fixture", icpVersionId, channel: "linkedin", sequenceId: crypto.randomUUID(), createdBy: userId });
        await transaction.update(calendarBookings).set({ campaignId }).where(and(eq(calendarBookings.workspaceId, workspaceId), eq(calendarBookings.id, bookingId)));
        await transaction.insert(calendarBookings).values([
          { id: outboundBookingId, workspaceId, connectionId, providerBookingId: `outbound-${outboundBookingId}`, contactId: secondContactId, campaignId, status: "accepted", startAt: new Date(now.getTime() + 72 * 60 * 60_000) },
          { id: unknownBookingId, workspaceId, connectionId, providerBookingId: `unknown-${unknownBookingId}`, contactId: secondContactId, status: "accepted", startAt: new Date(now.getTime() + 96 * 60 * 60_000) },
        ]);

        const bookings = await new PostgresCalendarIntegration(transaction as never, "attribution-test-signing-key-with-32-characters").listBookings({ workspaceId, limit: 20 });
        expect(bookings.find((booking) => booking.id === bookingId)).toMatchObject({ source: "mixed", campaignId, attribution: { certainty: "inference" } });
        expect(bookings.find((booking) => booking.id === outboundBookingId)).toMatchObject({ source: "outbound", campaignId, attribution: { certainty: "none", touches: [] } });
        expect(bookings.find((booking) => booking.id === unknownBookingId)).toMatchObject({ source: "unknown", campaignId: null, attribution: { certainty: "none", touches: [] } });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  test("projects only exact proved interactions onto the CRM score and isolates workspaces", async () => {
    const reader = new PostgresSocialProspectSignalReader(database.db);
    const assessment = await reader.read({
      workspaceId,
      contactId,
      baseScore: 70,
      now: new Date(now.getTime() + 4 * 60 * 60_000),
    });
    expect(assessment).toMatchObject({
      baseScore: 70,
      socialBoost: 16,
      effectiveScore: 86,
      openLinkedinConversation: true,
      decisionImpact: "conversation_open",
    });
    expect(assessment.eligibleSignals.map((signal) => signal.id).sort()).toEqual([
      firstInteractionId,
      lastInteractionId,
    ].sort());

    expect(await reader.read({
      workspaceId: otherWorkspaceId,
      contactId,
      baseScore: 70,
      now: new Date(now.getTime() + 4 * 60 * 60_000),
    })).toMatchObject({ socialBoost: 0, effectiveScore: 70, openLinkedinConversation: false });
  });

  test("projects proved social interactions into Conversations without inventing messages", async () => {
    const views = new PostgresOperationalViews(database.db);
    const page = await views.listConversations({ workspaceId, page: 1, pageSize: 20 });
    const messageThread = page.data.find((item) => item.id === conversationId);
    expect(messageThread).toMatchObject({
      kind: "message_thread",
      source: "inbound",
      origin: "outside_campaign",
      socialEventCount: 2,
    });
    const socialThread = page.data.find((item) => item.id === socialOnlyInteractionId);
    expect(socialThread).toMatchObject({
      kind: "social_thread",
      source: "inbound",
      contactId: secondContactId,
      origin: "outside_campaign",
      socialEventCount: 1,
    });
    expect(page.data.some((item) => item.id === unknownInteractionId || item.id === ambiguousInteractionId)).toBe(false);

    const messageDetail = await views.getConversation(workspaceId, conversationId);
    expect(messageDetail?.messages).toEqual([]);
    expect(messageDetail?.socialEvents.map((event) => event.id)).toEqual([firstInteractionId, lastInteractionId]);
    const socialDetail = await views.getConversation(workspaceId, socialOnlyInteractionId);
    expect(socialDetail).toMatchObject({ kind: "social_thread", source: "inbound", latestCommand: null, decision: null });
    expect(socialDetail?.messages).toEqual([]);
    expect(socialDetail?.socialEvents).toHaveLength(1);

    const inbound = await views.listConversations({ workspaceId, source: "inbound", page: 1, pageSize: 20 });
    expect(inbound.data.map((item) => item.id).sort()).toEqual([conversationId, socialOnlyInteractionId].sort());
    expect((await views.listConversations({ workspaceId: otherWorkspaceId, source: "inbound", page: 1, pageSize: 20 })).data).toEqual([]);
  });

  test("labels an attributed campaign thread as mixed without rewriting its origin", async () => {
    const rollback = new Error("ROLLBACK_MIXED_SOURCE_FIXTURE");
    try {
      await database.db.transaction(async (transaction) => {
        const icpId = crypto.randomUUID();
        const icpVersionId = crypto.randomUUID();
        const campaignId = crypto.randomUUID();
        await transaction.insert(icps).values({ id: icpId, workspaceId, name: "Mixed source fixture", currentVersion: 1 });
        await transaction.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "Mixed source fixture", confidence: "1.0000", criteria: {}, buyingCommittee: [], problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedBy: userId, publishedAt: now });
        await transaction.insert(campaigns).values({ id: campaignId, workspaceId, name: "Mixed campaign", icpVersionId, channel: "linkedin", sequenceId: crypto.randomUUID(), createdBy: userId });
        await transaction.update(conversations).set({ campaignId }).where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, conversationId)));

        const views = new PostgresOperationalViews(transaction as never);
        const mixed = await views.listConversations({ workspaceId, source: "mixed", page: 1, pageSize: 20 });
        expect(mixed.data.find((item) => item.id === conversationId)).toMatchObject({ source: "mixed", origin: "outside_campaign", campaignId });
        expect((await views.getConversation(workspaceId, conversationId))).toMatchObject({ source: "mixed", origin: "outside_campaign", campaignId });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  test("replays idempotently without duplicating attribution edges", async () => {
    const before = await database.db.select().from(attributionTouches).where(eq(attributionTouches.workspaceId, workspaceId));
    await database.db.update(attributionTouches).set({ nextResolutionAt: now }).where(and(
      eq(attributionTouches.workspaceId, workspaceId),
      eq(attributionTouches.logicalKey, "identity"),
    ));
    expect(await new AttributionReconciler(repository, { now: () => new Date(now.getTime() + 5 * 60 * 60_000) }).reconcile(workspaceId)).toBe(5);
    const after = await database.db.select().from(attributionTouches).where(eq(attributionTouches.workspaceId, workspaceId));
    expect(after).toHaveLength(before.length);
    expect(new Set(after.map((touch) => `${touch.socialInteractionId}:${touch.logicalKey}`)).size).toBe(after.length);
  });

  function interaction(id: string, actorProviderId: string, actorProfileUrl: string | null, observedAt: Date, type: "comment" | "reaction" = "comment") {
    return { id, workspaceId, socialContentId: postId, connectedAccountId: accountId, providerAccountId: "linkedin-account-attribution", syncKind: type === "reaction" ? "reactions" : "comments", scopeKey: "post", type, providerInteractionId: `provider-${id}`, direction: "incoming", actorProviderId, actorName: "LinkedIn actor", actorProfileUrl, body: type === "reaction" ? null : "Je souhaite en savoir plus", reaction: type === "reaction" ? "like" : null, status: "observed", firstSeenAt: observedAt, lastSeenAt: observedAt, lastScanToken: crypto.randomUUID(), createdAt: observedAt, updatedAt: observedAt } as const;
  }
});
