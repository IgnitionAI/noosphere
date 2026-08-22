import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { InboundReplyDecision } from "@outbound/application/campaigns/inbound-reply-agent";
import type { CalcomApi } from "@outbound/infrastructure/calendar/calcom-client";
import { PostgresMeetingProposalManager } from "@outbound/infrastructure/calendar/meeting-proposal-manager";
import { PostgresCalendarIntegration } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  calendarBookings,
  calendarConnections,
  contactIdentities,
  contacts,
  conversations,
  meetingProposals,
  opportunities,
  opportunityStageHistory,
  outboxEvents,
  workspaces,
} from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("durable meeting proposals", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  let createBookingCalls = 0;
  let rescheduleBookingCalls = 0;
  let cancelBookingCalls = 0;
  let listSlotCalls = 0;
  const availableSlots = [
    { start: "2026-08-10T09:00:00.000+02:00", end: "2026-08-10T09:30:00.000+02:00" },
    { start: "2026-08-11T10:00:00.000+02:00", end: "2026-08-11T10:30:00.000+02:00" },
    { start: "2026-08-12T14:00:00.000+02:00", end: "2026-08-12T14:30:00.000+02:00" },
  ];
  const calcom: CalcomApi = {
    async getProfile() {
      return { username: "salim", timeZone: "Europe/Paris" };
    },
    async listEventTypes() {
      return [{ id: 42, slug: "demo", title: "Démo", lengthInMinutes: 30 }];
    },
    async listPublicEventTypes() {
      return [{ id: 42, slug: "demo", title: "Démo", lengthInMinutes: 30 }];
    },
    async listSlots() {
      listSlotCalls += 1;
      return availableSlots;
    },
    async createBooking(input) {
      createBookingCalls += 1;
      return {
        uid: `proposal-booking-${Date.parse(input.start)}`,
        start: new Date(input.start).toISOString(),
        end: new Date(Date.parse(input.start) + 30 * 60_000).toISOString(),
        meetingUrl: "https://meet.fixture/proposal",
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
    async createWebhook() {
      return "webhook-proposal";
    },
  };
  const scheduler = new PostgresCalendarIntegration(
    database.db,
    "fixture-calendar-master-key-with-at-least-32-chars",
    calcom,
  );
  const manager = new PostgresMeetingProposalManager(database.db, scheduler);

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values({
      id: workspaceId,
      slug: `meeting-proposal-${workspaceId}`,
      name: "Meeting proposal",
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
    await database.db.insert(conversations).values({
      id: conversationId,
      workspaceId,
      contactId,
      campaignId: null,
      provider: "unipile",
      providerAccountId: "account-proposal",
      providerThreadId: `thread-${conversationId}`,
      channel: "email",
      status: "open",
      lastMessageAt: new Date("2026-08-04T10:00:00.000Z"),
    });
    await scheduler.configure({
      workspaceId,
      provider: "calcom",
      bookingUrl: "https://cal.com/salim/demo",
      apiKey: "fixture-api-key",
      now: new Date("2026-08-04T10:00:00.000Z"),
    });
  });

  afterAll(async () => {
    await database.client`alter table audit_logs disable trigger user`;
    await database.client`delete from audit_logs where workspace_id = ${workspaceId}`;
    await database.client`alter table audit_logs enable trigger user`;
    await database.client`delete from meeting_proposals where workspace_id = ${workspaceId}`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`alter table opportunity_stage_history disable trigger user`;
    await database.client`delete from opportunity_stage_history where workspace_id = ${workspaceId}`;
    await database.client`delete from opportunities where workspace_id = ${workspaceId}`;
    await database.client`alter table opportunity_stage_history enable trigger user`;
    await database.client`delete from calendar_bookings where workspace_id = ${workspaceId}`;
    await database.client`delete from conversations where workspace_id = ${workspaceId}`;
    await database.client`delete from contact_identities where workspace_id = ${workspaceId}`;
    await database.client`delete from contacts where workspace_id = ${workspaceId}`;
    await database.client`delete from calendar_connections where workspace_id = ${workspaceId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.close();
  });

  test("keeps numbered slots stable and books the second one idempotently", async () => {
    const now = new Date("2026-08-04T10:05:00.000Z");
    const initial = await manager.prepare({ workspaceId, conversationId, contactId, campaignId: null, now });
    const offered = await manager.execute({
      workspaceId,
      conversationId,
      contactId,
      campaignId: null,
      idempotencyKey: "incoming-message-1",
      decision: decision("propose_slots", null),
      calendar: initial,
      bookingUrl: initial.bookingUrl,
      now,
    });
    expect(offered.replyBody).toContain("1.");
    expect(offered.replyBody).toContain("2.");
    expect(offered.replyBody).toContain("3.");
    const callsAfterOffer = listSlotCalls;

    const stable = await manager.prepare({
      workspaceId,
      conversationId,
      contactId,
      campaignId: null,
      now: new Date("2026-08-04T10:10:00.000Z"),
    });
    expect(listSlotCalls).toBe(callsAfterOffer);
    expect(stable.slots).toHaveLength(3);
    const second = stable.slots[1]!.start;
    const bookingInput = {
      workspaceId,
      conversationId,
      contactId,
      campaignId: null,
      idempotencyKey: "incoming-message-2",
      decision: decision("book", second),
      calendar: stable,
      bookingUrl: stable.bookingUrl,
      now: new Date("2026-08-04T10:11:00.000Z"),
    } as const;
    const booked = await manager.execute(bookingInput);
    const retried = await manager.execute(bookingInput);
    expect(booked.selectedSlotStart).toBe(second);
    expect(retried.selectedSlotStart).toBe(second);
    expect(booked.replyBody).toContain("réservé");
    expect(createBookingCalls).toBe(1);
    expect(await database.db.select().from(meetingProposals).where(eq(meetingProposals.workspaceId, workspaceId))).toMatchObject([
      { status: "booked", calendarBookingId: expect.any(String) },
    ]);
    expect(await database.db.select().from(calendarBookings).where(eq(calendarBookings.workspaceId, workspaceId))).toHaveLength(1);

    const rescheduleCalendar = await manager.prepare({
      workspaceId,
      conversationId,
      contactId,
      campaignId: null,
      now: new Date("2026-08-04T10:20:00.000Z"),
    });
    expect(rescheduleCalendar.activeBooking?.start).toBe(second);
    await manager.execute({
      workspaceId,
      conversationId,
      contactId,
      campaignId: null,
      idempotencyKey: "incoming-message-3",
      decision: decision("propose_slots", null),
      calendar: rescheduleCalendar,
      bookingUrl: rescheduleCalendar.bookingUrl,
      now: new Date("2026-08-04T10:20:00.000Z"),
    });
    const replacementCalendar = await manager.prepare({
      workspaceId,
      conversationId,
      contactId,
      campaignId: null,
      now: new Date("2026-08-04T10:21:00.000Z"),
    });
    const replacement = replacementCalendar.slots[2]!.start;
    const moved = await manager.execute({
      workspaceId,
      conversationId,
      contactId,
      campaignId: null,
      idempotencyKey: "incoming-message-4",
      decision: decision("reschedule", replacement),
      calendar: replacementCalendar,
      bookingUrl: replacementCalendar.bookingUrl,
      now: new Date("2026-08-04T10:22:00.000Z"),
    });
    expect(moved.replyBody).toContain("déplacé");
    expect(moved.selectedSlotStart).toBe(replacement);
    expect(rescheduleBookingCalls).toBe(1);

    const cancellationCalendar = await manager.prepare({
      workspaceId,
      conversationId,
      contactId,
      campaignId: null,
      now: new Date("2026-08-04T10:30:00.000Z"),
    });
    const cancelled = await manager.execute({
      workspaceId,
      conversationId,
      contactId,
      campaignId: null,
      idempotencyKey: "incoming-message-5",
      decision: decision("cancel", null),
      calendar: cancellationCalendar,
      bookingUrl: cancellationCalendar.bookingUrl,
      now: new Date("2026-08-04T10:31:00.000Z"),
    });
    expect(cancelled.replyBody).toContain("annulé");
    expect(cancelBookingCalls).toBe(1);
    const bookingRows = await database.db.select().from(calendarBookings).where(eq(calendarBookings.workspaceId, workspaceId));
    expect(bookingRows).toHaveLength(1);
    expect(bookingRows[0]).toMatchObject({ status: "cancelled", rescheduleCount: 1 });
    expect(await database.db.select().from(opportunities).where(eq(opportunities.workspaceId, workspaceId))).toMatchObject([
      { stage: "qualified" },
    ]);
  });
});

function decision(
  calendarAction: "propose_slots" | "book" | "reschedule" | "cancel",
  selectedSlotStart: string | null,
): InboundReplyDecision {
  return {
    intent: "meeting_request",
    confidence: 0.99,
    action: "booking",
    calendarAction,
    selectedSlotStart,
    replyBody: "Avec plaisir.",
    rationale: "Le prospect souhaite un rendez-vous.",
    metadata: {
      provider: "fixture",
      model: "k3",
      promptVersion: "fixture",
    },
  };
}
