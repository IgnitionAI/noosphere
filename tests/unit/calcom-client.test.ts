import { describe, expect, test } from "bun:test";
import { CalcomApiError, CalcomClient } from "@outbound/infrastructure/calendar/calcom-client";
import {
  decryptCalendarCredential,
  encryptCalendarCredential,
} from "@outbound/infrastructure/calendar/calendar-credential";

describe("Cal.com API client", () => {
  test("encrypts the API credential with authenticated encryption", () => {
    const masterKey = "fixture-master-key-with-more-than-32-characters";
    const secret = "cal_fixture_secret";
    const encrypted = encryptCalendarCredential(secret, masterKey);
    expect(encrypted).not.toContain(secret);
    expect(decryptCalendarCredential(encrypted, masterKey)).toBe(secret);
    expect(() => decryptCalendarCredential(`${encrypted}tampered`, masterKey)).toThrow(
      "CALENDAR_CREDENTIAL_DECRYPTION_FAILED",
    );
  });

  test("reads event types and slots then creates a booking without leaking credentials", async () => {
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const client = new CalcomClient({
      baseUrl: "https://cal.fixture/v2/",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requests.push({ url, init: init ?? {} });
        if (url.pathname.endsWith("/me")) {
          return json({ status: "success", data: { username: "salim", timeZone: "Europe/Paris" } });
        }
        if (url.pathname.endsWith("/event-types")) {
          return json({
            status: "success",
            data: [{ id: 42, slug: "demo", title: "Démo", lengthInMinutes: 30 }],
          });
        }
        if (url.pathname.endsWith("/slots")) {
          return json({
            status: "success",
            data: {
              "2026-08-10": [
                { start: "2026-08-10T09:00:00.000+02:00", end: "2026-08-10T09:30:00.000+02:00" },
              ],
            },
          });
        }
        if (url.pathname.endsWith("/bookings/booking-42/cancel")) {
          return json({
            status: "success",
            data: {
              uid: "booking-42",
              start: "2026-08-10T07:00:00.000Z",
              end: "2026-08-10T07:30:00.000Z",
            },
          });
        }
        if (url.pathname.endsWith("/bookings/booking-42/reschedule")) {
          return json({
            status: "success",
            data: {
              uid: "booking-43",
              start: "2026-08-11T08:00:00.000Z",
              end: "2026-08-11T08:30:00.000Z",
              location: "https://meet.fixture/booking-43",
            },
          }, 201);
        }
        if (url.pathname.endsWith("/bookings")) {
          return json({
            status: "success",
            data: {
              uid: "booking-42",
              start: "2026-08-10T07:00:00.000Z",
              end: "2026-08-10T07:30:00.000Z",
              location: "https://meet.fixture/booking-42",
            },
          }, 201);
        }
        throw new Error(`Unexpected request ${url}`);
      },
    });
    const apiKey = "cal_fixture_never_log";
    expect(await client.getProfile(apiKey)).toEqual({ username: "salim", timeZone: "Europe/Paris" });
    expect(await client.listEventTypes(apiKey)).toEqual([
      { id: 42, slug: "demo", title: "Démo", lengthInMinutes: 30 },
    ]);
    expect(await client.listPublicEventTypes({ username: "salim", eventSlug: "demo" })).toEqual([
      { id: 42, slug: "demo", title: "Démo", lengthInMinutes: 30 },
    ]);
    expect(await client.listSlots({
      apiKey,
      eventTypeId: 42,
      start: "2026-08-10",
      end: "2026-08-17",
      timeZone: "Europe/Paris",
    })).toEqual([
      { start: "2026-08-10T09:00:00.000+02:00", end: "2026-08-10T09:30:00.000+02:00" },
    ]);
    expect(await client.createBooking({
      apiKey,
      eventTypeId: 42,
      start: "2026-08-10T07:00:00.000Z",
      attendee: {
        name: "Marie Dupont",
        email: "marie@example.com",
        phoneNumber: null,
        timeZone: "Europe/Paris",
        language: "fr",
      },
      metadata: { ignitionContact: "signed" },
    })).toMatchObject({ uid: "booking-42", meetingUrl: "https://meet.fixture/booking-42" });
    expect(await client.cancelBooking({
      apiKey,
      bookingUid: "booking-42",
      reason: "Contract test cleanup",
    })).toEqual({ uid: "booking-42" });
    expect(await client.rescheduleBooking({
      apiKey,
      bookingUid: "booking-42",
      start: "2026-08-11T08:00:00.000Z",
      reason: "Prospect requested another slot",
    })).toMatchObject({ uid: "booking-43", meetingUrl: "https://meet.fixture/booking-43" });
    for (const request of requests) {
      expect(request.url.pathname).toStartWith("/v2/");
      if (request.url.searchParams.has("username")) {
        expect(new Headers(request.init.headers).get("authorization")).toBeNull();
      } else {
        expect(new Headers(request.init.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
      }
      expect(request.url.toString()).not.toContain(apiKey);
    }
  });

  test("maps provider authentication errors to a stable code", async () => {
    const client = new CalcomClient({
      fetch: async () => json({ status: "error", message: "Invalid token" }, 401),
    });
    try {
      await client.getProfile("cal_invalid_fixture");
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CalcomApiError);
      expect(error).toMatchObject({ code: "CALCOM_AUTHENTICATION_FAILED", status: 401 });
    }
  });
});

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}
