import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { deriveCalendarWebhookSecret } from "@outbound/infrastructure/calendar/calcom-webhook";
import { PostgresCalendarIntegration } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { PostgresOpportunityRepository } from "@outbound/infrastructure/pipeline/postgres-opportunity-repository";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  calendarBookings,
  contactIdentities,
  contacts,
  integrationEvents,
  opportunities,
  opportunityStageHistory,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { createCalendarWebhookHttpHandler } from "@outbound/interface/http/calendar-webhook-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("calendar booking automation", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const signingKey = "fixture-calendar-signing-key-with-at-least-32-chars";
  const integration = new PostgresCalendarIntegration(database.db, signingKey);
  const handler = createCalendarWebhookHttpHandler({ integration, signingKey });
  let connectionId = "";

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values({
      id: workspaceId,
      slug: `calendar-${workspaceId}`,
      name: "Calendar automation",
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
    const connection = await integration.configure({
      workspaceId,
      provider: "calcom",
      bookingUrl: "https://cal.example.com/ignition/30min",
      now: new Date("2026-08-04T10:00:00.000Z"),
    });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await database.client`alter table audit_logs disable trigger user`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`delete from integration_events where workspace_id = ${workspaceId}`;
    await database.client`delete from calendar_bookings where workspace_id = ${workspaceId}`;
    await database.client`alter table opportunity_stage_history disable trigger user`;
    await database.client`delete from opportunities where workspace_id = ${workspaceId}`;
    await database.client`delete from opportunity_stage_history where workspace_id = ${workspaceId}`;
    await database.client`alter table opportunity_stage_history enable trigger user`;
    await database.client`delete from contact_identities where workspace_id = ${workspaceId}`;
    await database.client`delete from contacts where workspace_id = ${workspaceId}`;
    await database.client`delete from calendar_connections where workspace_id = ${workspaceId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.client`alter table audit_logs enable trigger user`;
    await database.close();
  });

  test("signed booking creates a meeting and duplicate delivery is idempotent", async () => {
    const trackedUrl = await integration.resolve({ workspaceId, contactId });
    expect(trackedUrl).toContain("metadata%5BignitionContact%5D=");
    const contactToken = new URL(trackedUrl!).searchParams.get("metadata[ignitionContact]");
    const rawBody = JSON.stringify({
      triggerEvent: "BOOKING_CREATED",
      createdAt: "2026-08-04T10:10:00.000Z",
      payload: {
        uid: "fixture-booking-1",
        startTime: "2026-08-06T13:00:00.000Z",
        endTime: "2026-08-06T13:30:00.000Z",
        attendees: [{ name: "Marie Dupont", email: "marie@example.com" }],
        metadata: { ignitionContact: contactToken, videoCallUrl: "https://meet.example.com/fixture" },
      },
    });
    const unauthorized = await handler(request(rawBody, "invalid"));
    expect(unauthorized.status).toBe(401);

    const first = await handler(request(rawBody, signature(rawBody)));
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ duplicate: false, matched: true });
    const duplicate = await handler(request(rawBody, signature(rawBody)));
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicate: true, matched: true });

    const persistedBookings = await database.db
      .select()
      .from(calendarBookings)
      .where(eq(calendarBookings.workspaceId, workspaceId));
    expect(persistedBookings).toHaveLength(1);
    expect(persistedBookings[0]).toMatchObject({
      contactId,
      status: "booked",
      providerBookingId: "fixture-booking-1",
    });
    const pipeline = await database.db
      .select()
      .from(opportunities)
      .where(eq(opportunities.workspaceId, workspaceId));
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0]).toMatchObject({ contactId, stage: "meeting_booked" });
    const bookingHistory = await database.db
      .select()
      .from(opportunityStageHistory)
      .where(eq(opportunityStageHistory.workspaceId, workspaceId));
    expect(bookingHistory).toHaveLength(1);
    expect(bookingHistory[0]).toMatchObject({
      fromStage: null,
      toStage: "meeting_booked",
      source: "calendar:calcom",
    });
    const events = await database.db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.workspaceId, workspaceId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: "calendar:calcom", status: "processed" });
  });

  test("cancellation updates the same booking and returns the opportunity to qualified", async () => {
    const rawBody = JSON.stringify({
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: "2026-08-05T10:10:00.000Z",
      payload: {
        bookingUid: "fixture-booking-1",
        startTime: "2026-08-06T13:00:00.000Z",
        attendees: [{ email: "marie@example.com" }],
      },
    });
    const response = await handler(request(rawBody, signature(rawBody)));
    expect(response.status).toBe(202);
    const [booking] = await database.db
      .select()
      .from(calendarBookings)
      .where(eq(calendarBookings.workspaceId, workspaceId));
    expect(booking).toMatchObject({ status: "cancelled", contactId });
    const [opportunity] = await database.db
      .select()
      .from(opportunities)
      .where(eq(opportunities.workspaceId, workspaceId));
    expect(opportunity).toMatchObject({ stage: "qualified" });
    const history = await database.db
      .select()
      .from(opportunityStageHistory)
      .where(eq(opportunityStageHistory.workspaceId, workspaceId));
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      fromStage: "meeting_booked",
      toStage: "qualified",
      source: "calendar:calcom",
    });
    const repository = new PostgresOpportunityRepository(database.db);
    const pipeline = await repository.list(workspaceId);
    expect(pipeline.metrics).toMatchObject({ total: 1, qualified: 1, meetings: 0 });
    expect(pipeline.data[0]).toMatchObject({
      contactId,
      column: "qualified",
      firstName: "Marie",
      lastName: "Dupont",
    });
    await repository.changeStage({
      workspaceId,
      opportunityId: opportunity!.id,
      stage: "won",
      reason: "Contrat signé",
      now: new Date("2026-08-07T10:00:00.000Z"),
    });
    const wonPipeline = await repository.list(workspaceId);
    expect(wonPipeline.data[0]).toMatchObject({ stage: "won", column: "closed" });
    expect(wonPipeline.data[0]?.history.at(-1)).toMatchObject({
      fromStage: "qualified",
      toStage: "won",
      source: "operator",
    });
  });

  function signature(rawBody: string): string {
    const secret = deriveCalendarWebhookSecret(signingKey, connectionId);
    return createHmac("sha256", secret).update(rawBody).digest("hex");
  }

  function request(rawBody: string, webhookSignature: string): Request {
    return new Request(
      `http://localhost/api/v1/webhooks/calendar/calcom?connection=${connectionId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cal-signature-256": webhookSignature,
        },
        body: rawBody,
      },
    );
  }
});
