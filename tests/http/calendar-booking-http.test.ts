import { describe, expect, test } from "bun:test";
import { createCalendarBookingHttpHandler } from "@outbound/interface/http/calendar-booking-handler";

const workspaceId = "00000000-0000-4000-8000-000000000501";
const userId = "00000000-0000-4000-8000-000000000502";
const bookingId = "00000000-0000-4000-8000-000000000503";

describe("F-043 calendar booking HTTP", () => {
  test("lets every member read with viewer redaction", async () => {
    const response = await handler("viewer")(request("/api/v1/calendar-bookings"));
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({ attendeeName: null, attendeeEmail: null, meetingUrl: null, contactId: null });
  });

  test("allows operators to mutate bookings but not meeting type configuration", async () => {
    const operator = handler("operator");
    expect((await operator(request(`/api/v1/calendar-bookings/${bookingId}/actions/reschedule`, "POST", mutation({ start: "2027-01-10T10:00:00.000Z" })))).status).toBe(200);
    expect((await operator(request(`/api/v1/calendar-bookings/${bookingId}/actions/cancel`, "POST", mutation()))).status).toBe(200);
    expect((await operator(request(`/api/v1/calendar-bookings/${bookingId}/actions/no-show`, "POST", mutation()))).status).toBe(200);
    expect((await operator(request("/api/v1/calendar-connection/meeting-types", "PUT", { providerEventTypeIds: [1], defaultProviderEventTypeId: 1 }))).status).toBe(403);
    expect((await handler("owner")(request("/api/v1/calendar-connection/meeting-types", "PUT", { providerEventTypeIds: [1], defaultProviderEventTypeId: 1 }))).status).toBe(200);
  });

  test("refuses booking mutations to reviewers and viewers", async () => {
    for (const role of ["reviewer", "viewer"] as const) {
      expect((await handler(role)(request(`/api/v1/calendar-bookings/${bookingId}/actions/cancel`, "POST", mutation()))).status).toBe(403);
    }
  });
});

function handler(role: "owner" | "operator" | "reviewer" | "viewer") {
  const booking = { id: bookingId, contactId: userId, campaignId: null, opportunityId: null, status: "booked", attendeeName: "Marie", attendeeEmail: "marie@example.com", attendeePhone: "+33123456789", attendeeTimeZone: "Europe/Paris", organizerTimeZone: "Europe/Madrid", startAt: new Date("2027-01-10T10:00:00.000Z"), endAt: new Date("2027-01-10T10:30:00.000Z"), meetingUrl: "https://meet.example/secret", cancellationReason: null, noShowAt: null, rescheduleCount: 0, meetingType: null, history: [], createdAt: new Date(), updatedAt: new Date() };
  const integration = {
    async listBookings() { return [booking]; },
    async listMeetingTypes() { return []; },
    async configureMeetingTypes() { return []; },
    async rescheduleById() { return { bookingId: "provider", start: booking.startAt.toISOString(), end: booking.endAt!.toISOString(), meetingUrl: booking.meetingUrl, label: "créneau" }; },
    async cancelById() { return { bookingId: "provider", start: booking.startAt.toISOString(), end: booking.endAt!.toISOString(), meetingUrl: booking.meetingUrl, label: "créneau" }; },
    async markNoShow() { return { ...booking, status: "no_show", noShowAt: new Date() }; },
  };
  return createCalendarBookingHttpHandler({ contextResolver: { async resolve() { return { workspaceId, userId, role }; } }, integration });
}

function mutation(extra: Record<string, unknown> = {}) { return { requestKey: "calendar-action", reason: "Demande du prospect", ...extra }; }
function request(pathname: string, method = "GET", body?: unknown) { return new Request(`http://localhost${pathname}`, { method, headers: { "content-type": "application/json", "x-workspace-slug": "workspace" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
