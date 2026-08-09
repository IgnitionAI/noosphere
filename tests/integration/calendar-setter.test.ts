import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { CalcomApi } from "@outbound/infrastructure/calendar/calcom-client";
import { PostgresCalendarIntegration } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  calendarBookings,
  calendarBookingHistory,
  calendarConnections,
  calendarMeetingTypes,
  authUsers,
  contactIdentities,
  contacts,
  opportunities,
  opportunityStageHistory,
  outboxEvents,
  workspaces,
} from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("Setter Cal.com scheduling", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const apiKey = "cal_fixture_api_key";
  let createBookingCalls = 0;
  let rescheduleBookingCalls = 0;
  let cancelBookingCalls = 0;
  const calcom: CalcomApi = {
    async getProfile(received) {
      expect(received).toBe(apiKey);
      return { username: "salim", timeZone: "Europe/Paris" };
    },
    async listEventTypes(received) {
      expect(received).toBe(apiKey);
      return [{ id: 42, slug: "demo", title: "Démo IgnitionAI", lengthInMinutes: 30 }, { id: 43, slug: "discovery", title: "Découverte", lengthInMinutes: 20 }];
    },
    async listPublicEventTypes() {
      return [{ id: 42, slug: "demo", title: "Démo IgnitionAI", lengthInMinutes: 30 }, { id: 43, slug: "discovery", title: "Découverte", lengthInMinutes: 20 }];
    },
    async listSlots() {
      return [{ start: "2026-08-10T09:00:00.000+02:00", end: "2026-08-10T09:30:00.000+02:00" }, { start: "2026-08-11T09:00:00.000+02:00", end: "2026-08-11T09:20:00.000+02:00" }];
    },
    async createBooking(input) {
      createBookingCalls += 1;
      expect(input.attendee).toMatchObject({ email: "marie@example.com", timeZone: "Europe/Paris" });
      expect(input.metadata.ignitionContact).toBeString();
      return {
        uid: "setter-booking-1",
        start: "2026-08-10T07:00:00.000Z",
        end: "2026-08-10T07:30:00.000Z",
        meetingUrl: "https://meet.fixture/setter-booking-1",
      };
    },
    async cancelBooking(input) {
      cancelBookingCalls += 1;
      return { uid: input.bookingUid };
    },
    async rescheduleBooking(input) {
      rescheduleBookingCalls += 1;
      return {
        uid: `${input.bookingUid}-rescheduled`,
        start: input.start,
        end: new Date(Date.parse(input.start) + 30 * 60_000).toISOString(),
        meetingUrl: "https://meet.fixture/rescheduled",
      };
    },
    async createWebhook(input) {
      expect(input.subscriberUrl).toContain("connection=");
      expect(input.secret).toBeString();
      return "webhook-42";
    },
  };
  const integration = new PostgresCalendarIntegration(
    database.db,
    "fixture-calendar-master-key-with-at-least-32-chars",
    calcom,
  );

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values({
      id: workspaceId,
      slug: `setter-calendar-${workspaceId}`,
      name: "Setter calendar",
    });
    await database.db.insert(authUsers).values({ id: ownerId, name: "Calendar Owner", email: `calendar-${ownerId}@example.com` });
    await database.db.insert(contacts).values({
      id: contactId,
      workspaceId,
      firstName: "Marie",
      lastName: "Dupont",
      source: "provider",
    });
    await database.db.insert(contactIdentities).values({
      id: crypto.randomUUID(),
      workspaceId,
      contactId,
      type: "email",
      value: "marie@example.com",
      normalizedValue: "marie@example.com",
      verificationStatus: "verified",
      source: "provider",
    });
  });

  afterAll(async () => {
    await database.client`alter table audit_logs disable trigger user`;
    await database.client`delete from audit_logs where workspace_id = ${workspaceId}`;
    await database.client`alter table audit_logs enable trigger user`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`alter table opportunity_stage_history disable trigger user`;
    await database.client`delete from opportunity_stage_history where workspace_id = ${workspaceId}`;
    await database.client`delete from opportunities where workspace_id = ${workspaceId}`;
    await database.client`alter table opportunity_stage_history enable trigger user`;
    await database.client`delete from calendar_bookings where workspace_id = ${workspaceId}`;
    await database.client`delete from contact_identities where workspace_id = ${workspaceId}`;
    await database.client`delete from contacts where workspace_id = ${workspaceId}`;
    await database.client`delete from calendar_connections where workspace_id = ${workspaceId}`;
    await database.client`delete from auth_users where id = ${ownerId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.close();
  });

  test("validates credentials, proposes live slots and books the selected slot once", async () => {
    const connection = await integration.configure({
      workspaceId,
      provider: "calcom",
      bookingUrl: "https://cal.com/salim/demo",
      apiKey,
      publicWebhookBaseUrl: "https://outbound.fixture",
      now: new Date("2026-08-04T10:00:00.000Z"),
    });
    expect(connection).toMatchObject({
      apiConfigured: true,
      automationReady: true,
      webhookRegistered: true,
      eventType: { id: 42, slug: "demo" },
      timeZone: "Europe/Paris",
    });
    const [stored] = await database.db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.workspaceId, workspaceId));
    expect(stored?.apiKeyCiphertext).not.toContain(apiKey);

    const context = await integration.schedulingContext({
      workspaceId,
      contactId,
      now: new Date("2026-08-04T10:00:00.000Z"),
    });
    expect(context).toMatchObject({ status: "ready", canBook: true, timeZone: "Europe/Paris" });
    expect(context.slots[0]).toMatchObject({ start: "2026-08-10T09:00:00.000+02:00" });

    const first = await integration.book({
      workspaceId,
      contactId,
      campaignId: null,
      start: context.slots[0]!.start,
      now: new Date("2026-08-04T10:05:00.000Z"),
    });
    const duplicate = await integration.book({
      workspaceId,
      contactId,
      campaignId: null,
      start: context.slots[0]!.start,
      now: new Date("2026-08-04T10:06:00.000Z"),
    });
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ bookingId: "setter-booking-1", meetingUrl: "https://meet.fixture/setter-booking-1" });
    expect(createBookingCalls).toBe(1);
    expect(await database.db.select().from(calendarBookings).where(eq(calendarBookings.workspaceId, workspaceId))).toHaveLength(1);
    expect(await database.db.select().from(opportunities).where(eq(opportunities.workspaceId, workspaceId))).toMatchObject([
      { stage: "meeting_booked", contactId },
    ]);
    expect(await database.db.select().from(opportunityStageHistory).where(eq(opportunityStageHistory.workspaceId, workspaceId))).toHaveLength(1);
    expect(await database.db.select().from(outboxEvents).where(eq(outboxEvents.workspaceId, workspaceId))).toHaveLength(1);
  });

  test("keeps one booking identity through reschedule, no-show and cancellation commands", async () => {
    await integration.configure({ workspaceId, provider: "calcom", bookingUrl: "https://cal.com/salim/demo", apiKey, now: new Date("2026-08-04T11:00:00.000Z") });
    const meetingTypes = await integration.listMeetingTypes(workspaceId);
    expect(meetingTypes).toHaveLength(2);
    await integration.configureMeetingTypes({ workspaceId, actorUserId: ownerId, providerEventTypeIds: [42, 43], defaultProviderEventTypeId: 43, now: new Date("2026-08-04T11:01:00.000Z") });
    const [original] = await database.db.select().from(calendarBookings).where(eq(calendarBookings.workspaceId, workspaceId)).limit(1);
    expect(original).toBeDefined();
    const moved = await integration.rescheduleById({ workspaceId, bookingId: original!.id, start: "2026-08-11T09:00:00.000+02:00", reason: "Décalage demandé", requestKey: "reschedule-once", actorUserId: ownerId, now: new Date("2026-08-04T11:05:00.000Z") });
    const replay = await integration.rescheduleById({ workspaceId, bookingId: original!.id, start: "2026-08-11T09:00:00.000+02:00", reason: "Décalage demandé", requestKey: "reschedule-once", actorUserId: ownerId, now: new Date("2026-08-04T11:06:00.000Z") });
    expect(replay).toEqual(moved);
    expect(rescheduleBookingCalls).toBe(1);
    const rowsAfterMove = await database.db.select().from(calendarBookings).where(eq(calendarBookings.workspaceId, workspaceId));
    expect(rowsAfterMove).toHaveLength(1);
    expect(rowsAfterMove[0]).toMatchObject({ id: original!.id, providerBookingId: "setter-booking-1-rescheduled", rescheduleCount: 1 });
    await integration.markNoShow({ workspaceId, bookingId: original!.id, reason: "Le prospect ne s’est pas présenté", requestKey: "no-show-once", actorUserId: ownerId, now: new Date("2026-08-11T08:30:00.000Z") });
    await integration.markNoShow({ workspaceId, bookingId: original!.id, reason: "Le prospect ne s’est pas présenté", requestKey: "no-show-once", actorUserId: ownerId, now: new Date("2026-08-11T08:31:00.000Z") });
    const [noShow] = await database.db.select().from(calendarBookings).where(eq(calendarBookings.id, original!.id));
    expect(noShow).toMatchObject({ status: "no_show", id: original!.id });
    const [opportunity] = await database.db.select().from(opportunities).where(eq(opportunities.workspaceId, workspaceId));
    expect(opportunity).toMatchObject({ stage: "meeting_no_show" });
    expect(await database.db.select().from(calendarBookingHistory).where(and(eq(calendarBookingHistory.workspaceId, workspaceId), eq(calendarBookingHistory.bookingId, original!.id)))).toHaveLength(3);

    const [connection] = await database.db.select().from(calendarConnections).where(eq(calendarConnections.workspaceId, workspaceId)).limit(1);
    const cancelBookingId = crypto.randomUUID();
    await database.db.insert(calendarBookings).values({ id: cancelBookingId, workspaceId, connectionId: connection!.id, providerBookingId: "cancel-product-booking", contactId, campaignId: null, status: "booked", startAt: new Date("2026-08-12T10:00:00.000Z"), organizerTimeZone: "Europe/Paris" });
    await integration.cancelById({ workspaceId, bookingId: cancelBookingId, reason: "Annulation explicite", requestKey: "cancel-once", actorUserId: ownerId, now: new Date("2026-08-10T10:00:00.000Z") });
    await integration.cancelById({ workspaceId, bookingId: cancelBookingId, reason: "Annulation explicite", requestKey: "cancel-once", actorUserId: ownerId, now: new Date("2026-08-10T10:01:00.000Z") });
    expect(cancelBookingCalls).toBe(1);
    expect((await database.db.select().from(calendarBookings).where(eq(calendarBookings.id, cancelBookingId)))[0]).toMatchObject({ id: cancelBookingId, status: "cancelled", cancellationReason: "Annulation explicite" });
    let immutableError = "";
    try { await database.client`update calendar_booking_history set reason = 'mutation interdite' where workspace_id = ${workspaceId}`; }
    catch (error) { immutableError = error instanceof Error ? error.message : String(error); }
    expect(immutableError).toContain("CALENDAR_BOOKING_HISTORY_IMMUTABLE");
    await integration.disable({ workspaceId, now: new Date("2026-08-10T11:00:00.000Z") });
    const afterDisconnect = await integration.listBookings({ workspaceId, contactId, limit: 20 });
    expect(afterDisconnect).toHaveLength(2);
    expect(afterDisconnect.every((booking) => booking.history.length > 0)).toBe(true);
  });
});
