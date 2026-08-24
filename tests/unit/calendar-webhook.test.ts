import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  createCalendarContactToken,
  deriveCalendarWebhookSecret,
  normalizeCalcomWebhook,
  verifyCalendarContactToken,
  verifyCalcomSignature,
} from "@outbound/infrastructure/calendar/calcom-webhook";

const masterKey = "fixture-calendar-signing-key-with-at-least-32-chars";
const connectionId = "8f29a9b5-aa29-4ad6-acb3-0633177d1e3d";
const contactId = "1341c32c-bb90-4272-93ff-92102513082b";

describe("Cal.com calendar webhook", () => {
  test("derives a connection-scoped secret and verifies the official HMAC header", () => {
    const rawBody = JSON.stringify({ triggerEvent: "BOOKING_CREATED", payload: { uid: "book-1" } });
    const secret = deriveCalendarWebhookSecret(masterKey, connectionId);
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

    expect(verifyCalcomSignature(rawBody, signature, secret)).toBe(true);
    expect(verifyCalcomSignature(`${rawBody} `, signature, secret)).toBe(false);
    expect(deriveCalendarWebhookSecret(masterKey, crypto.randomUUID())).not.toBe(secret);
  });

  test("round-trips a signed contact token without exposing an unsigned contact id", () => {
    const token = createCalendarContactToken(masterKey, connectionId, contactId);

    expect(token).not.toBe(contactId);
    expect(verifyCalendarContactToken(masterKey, connectionId, token)).toBe(contactId);
    expect(verifyCalendarContactToken(masterKey, crypto.randomUUID(), token)).toBeNull();
    expect(verifyCalendarContactToken(masterKey, connectionId, `${token}x`)).toBeNull();
  });

  test("normalizes an official booking payload with attendee and tracking metadata", () => {
    const token = createCalendarContactToken(masterKey, connectionId, contactId);
    const event = normalizeCalcomWebhook({
      triggerEvent: "BOOKING_CREATED",
      createdAt: "2026-08-04T10:00:00.000Z",
      payload: {
        uid: "booking-123",
        startTime: "2026-08-06T13:00:00.000Z",
        endTime: "2026-08-06T13:30:00.000Z",
        attendees: [{ name: "Marie Dupont", email: "Marie@Example.com" }],
        metadata: {
          ignitionContact: token,
          videoCallUrl: "https://meet.example.com/booking-123",
        },
      },
    });

    expect(event).toMatchObject({
      trigger: "BOOKING_CREATED",
      bookingId: "booking-123",
      attendeeEmail: "marie@example.com",
      attendeeName: "Marie Dupont",
      contactToken: token,
      meetingUrl: "https://meet.example.com/booking-123",
      status: "booked",
    });
    expect(event?.startAt.toISOString()).toBe("2026-08-06T13:00:00.000Z");
  });

  test("maps cancellation and no-show lifecycle events without treating malformed payloads as bookings", () => {
    expect(normalizeCalcomWebhook({
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: "2026-08-04T10:00:00.000Z",
      payload: { bookingUid: "booking-1", startTime: "2026-08-06T13:00:00.000Z" },
    })?.status).toBe("cancelled");
    expect(normalizeCalcomWebhook({
      triggerEvent: "BOOKING_NO_SHOW_UPDATED",
      createdAt: "2026-08-04T10:00:00.000Z",
      payload: { bookingUid: "booking-1", startTime: "2026-08-06T13:00:00.000Z" },
    })?.status).toBe("no_show");
    expect(normalizeCalcomWebhook({ triggerEvent: "FORM_SUBMITTED", payload: {} })).toBeNull();
  });
});
