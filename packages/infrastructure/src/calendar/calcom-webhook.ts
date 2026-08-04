import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeEmail, normalizePhone } from "@outbound/domain/crm/normalization";

export type CalendarBookingStatus =
  | "requested"
  | "booked"
  | "cancelled"
  | "no_show"
  | "completed";

export interface NormalizedCalcomWebhook {
  readonly trigger: string;
  readonly bookingId: string;
  readonly eventId: string;
  readonly status: CalendarBookingStatus;
  readonly attendeeName: string | null;
  readonly attendeeEmail: string | null;
  readonly attendeePhone: string | null;
  readonly contactToken: string | null;
  readonly startAt: Date;
  readonly endAt: Date | null;
  readonly meetingUrl: string | null;
  readonly occurredAt: Date;
}

const SUPPORTED_TRIGGERS = new Map<string, CalendarBookingStatus>([
  ["BOOKING_REQUESTED", "requested"],
  ["BOOKING_CREATED", "booked"],
  ["BOOKING_CONFIRMED", "booked"],
  ["BOOKING_RESCHEDULED", "booked"],
  ["BOOKING_CANCELLED", "cancelled"],
  ["BOOKING_REJECTED", "cancelled"],
  ["BOOKING_NO_SHOW", "no_show"],
  ["BOOKING_NO_SHOW_UPDATED", "no_show"],
  ["BOOKING_COMPLETED", "completed"],
  ["MEETING_ENDED", "completed"],
]);

export function deriveCalendarWebhookSecret(masterKey: string, connectionId: string): string {
  requireSigningKey(masterKey);
  return createHmac("sha256", masterKey)
    .update(`calendar-webhook:${connectionId}`)
    .digest("base64url");
}

export function verifyCalcomSignature(
  rawBody: string,
  receivedSignature: string,
  secret: string,
): boolean {
  const received = receivedSignature.trim().replace(/^sha256=/i, "");
  if (!received) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return secureEqual(received.toLowerCase(), expected);
}

export function createCalendarContactToken(
  masterKey: string,
  connectionId: string,
  contactId: string,
): string {
  requireSigningKey(masterKey);
  const encodedContact = Buffer.from(contactId, "utf8").toString("base64url");
  const signature = createHmac("sha256", masterKey)
    .update(`calendar-contact:${connectionId}:${encodedContact}`)
    .digest("base64url");
  return `${encodedContact}.${signature}`;
}

export function verifyCalendarContactToken(
  masterKey: string,
  connectionId: string,
  token: string,
): string | null {
  try {
    requireSigningKey(masterKey);
    const [encodedContact, receivedSignature, extra] = token.split(".");
    if (!encodedContact || !receivedSignature || extra !== undefined) return null;
    const expected = createHmac("sha256", masterKey)
      .update(`calendar-contact:${connectionId}:${encodedContact}`)
      .digest("base64url");
    if (!secureEqual(receivedSignature, expected)) return null;
    const contactId = Buffer.from(encodedContact, "base64url").toString("utf8");
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contactId)
      ? contactId
      : null;
  } catch {
    return null;
  }
}

export function normalizeCalcomWebhook(payload: unknown): NormalizedCalcomWebhook | null {
  const root = recordValue(payload);
  if (!root) return null;
  const trigger = stringValue(root.triggerEvent)?.toUpperCase();
  const status = trigger ? SUPPORTED_TRIGGERS.get(trigger) : undefined;
  if (!trigger || !status) return null;
  const data = recordValue(root.payload) ?? root;
  const bookingId = firstString(data, ["bookingUid", "uid", "booking_uid", "id"]);
  const startAt = dateValue(firstString(data, ["startTime", "start", "start_time"]));
  if (!bookingId || !startAt) return null;
  const occurredAt = dateValue(stringValue(root.createdAt)) ?? new Date();
  const attendee = firstRecord(data, ["attendees", "attendee"]);
  const metadata = recordValue(data.metadata);
  const rawEmail = firstString(attendee, ["email"]);
  const rawPhone = firstString(attendee, ["phoneNumber", "phone", "phone_number"]);
  const attendeeEmail = rawEmail ? normalizeEmail(rawEmail) || null : null;
  const attendeePhone = rawPhone ? normalizePhone(rawPhone) || null : null;
  const contactToken = metadata
    ? firstString(metadata, ["ignitionContact", "ignition_contact"])
    : null;
  const endAt = dateValue(firstString(data, ["endTime", "end", "end_time"]));
  const meetingUrl = safeHttpUrl(
    (metadata ? firstString(metadata, ["videoCallUrl", "video_call_url", "meetingUrl"]) : null)
      ?? firstString(data, ["meetingUrl", "videoCallUrl"]),
  );
  const eventSeed = `${trigger}:${bookingId}:${occurredAt.toISOString()}:${startAt.toISOString()}`;
  return {
    trigger,
    bookingId,
    eventId: createHmac("sha256", "calcom-event-v1").update(eventSeed).digest("hex"),
    status,
    attendeeName: firstString(attendee, ["name"]),
    attendeeEmail,
    attendeePhone,
    contactToken,
    startAt,
    endAt,
    meetingUrl,
    occurredAt,
  };
}

function firstRecord(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  for (const key of keys) {
    const item = value[key];
    if (Array.isArray(item)) {
      const first = recordValue(item[0]);
      if (first) return first;
    }
    const record = recordValue(item);
    if (record) return record;
  }
  return {};
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const item = stringValue(value[key]);
    if (item) return item;
  }
  return null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function dateValue(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function requireSigningKey(value: string): void {
  if (value.length < 32) throw new Error("CALENDAR_WEBHOOK_SIGNING_KEY_TOO_SHORT");
}

function secureEqual(leftValue: string, rightValue: string): boolean {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && timingSafeEqual(left, right);
}
