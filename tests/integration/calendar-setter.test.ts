import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { CalcomApi } from "@outbound/infrastructure/calendar/calcom-client";
import { PostgresCalendarIntegration } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  calendarBookings,
  calendarConnections,
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
  const apiKey = "cal_fixture_api_key";
  let createBookingCalls = 0;
  const calcom: CalcomApi = {
    async getProfile(received) {
      expect(received).toBe(apiKey);
      return { username: "salim", timeZone: "Europe/Paris" };
    },
    async listEventTypes(received) {
      expect(received).toBe(apiKey);
      return [{ id: 42, slug: "demo", title: "Démo IgnitionAI", lengthInMinutes: 30 }];
    },
    async listPublicEventTypes() {
      return [{ id: 42, slug: "demo", title: "Démo IgnitionAI", lengthInMinutes: 30 }];
    },
    async listSlots() {
      return [{ start: "2026-08-10T09:00:00.000+02:00", end: "2026-08-10T09:30:00.000+02:00" }];
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
      return { uid: input.bookingUid };
    },
    async rescheduleBooking(input) {
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
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`delete from opportunity_stage_history where workspace_id = ${workspaceId}`;
    await database.client`delete from opportunities where workspace_id = ${workspaceId}`;
    await database.client`delete from calendar_bookings where workspace_id = ${workspaceId}`;
    await database.client`delete from contact_identities where workspace_id = ${workspaceId}`;
    await database.client`delete from contacts where workspace_id = ${workspaceId}`;
    await database.client`delete from calendar_connections where workspace_id = ${workspaceId}`;
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
});
