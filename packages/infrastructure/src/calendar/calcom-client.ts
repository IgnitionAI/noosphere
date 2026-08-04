import { z } from "zod";

export type CalcomFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const profileSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    username: z.string().min(1),
    timeZone: z.string().min(1),
  }),
});

const eventTypesSchema = z.object({
  status: z.literal("success"),
  data: z.array(z.object({
    id: z.number().int().positive(),
    slug: z.string().min(1),
    title: z.string().min(1),
    lengthInMinutes: z.number().int().positive(),
  })),
});

const slotsSchema = z.object({
  status: z.literal("success"),
  data: z.record(z.string(), z.array(z.union([
    z.string().min(1).transform((start) => ({ start, end: null as string | null })),
    z.object({
      start: z.string().min(1),
      end: z.string().min(1).nullable().optional(),
    }).transform((slot) => ({ start: slot.start, end: slot.end ?? null })),
  ]))),
});

const bookingSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    uid: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1),
    location: z.unknown().optional(),
  }),
});

const webhookSchema = z.object({
  status: z.literal("success"),
  data: z.object({ id: z.union([z.number(), z.string()]) }),
});

export interface CalcomEventType {
  readonly id: number;
  readonly slug: string;
  readonly title: string;
  readonly lengthInMinutes: number;
}

export interface CalcomSlot {
  readonly start: string;
  readonly end: string | null;
}

export interface CalcomBooking {
  readonly uid: string;
  readonly start: string;
  readonly end: string;
  readonly meetingUrl: string | null;
}

export interface CalcomApi {
  getProfile(apiKey: string): Promise<{ username: string; timeZone: string }>;
  listEventTypes(apiKey: string): Promise<readonly CalcomEventType[]>;
  listPublicEventTypes(input: {
    username: string;
    eventSlug: string;
  }): Promise<readonly CalcomEventType[]>;
  listSlots(input: {
    apiKey: string | null;
    eventTypeId: number;
    start: string;
    end: string;
    timeZone: string;
  }): Promise<readonly CalcomSlot[]>;
  createBooking(input: {
    apiKey: string | null;
    eventTypeId: number;
    start: string;
    attendee: {
      name: string;
      email: string;
      phoneNumber: string | null;
      timeZone: string;
      language: string;
    };
    metadata: Readonly<Record<string, string>>;
  }): Promise<CalcomBooking>;
  cancelBooking(input: {
    apiKey: string;
    bookingUid: string;
    reason: string;
  }): Promise<{ uid: string }>;
  rescheduleBooking(input: {
    apiKey: string;
    bookingUid: string;
    start: string;
    reason: string;
  }): Promise<CalcomBooking>;
  createWebhook(input: {
    apiKey: string;
    subscriberUrl: string;
    secret: string;
  }): Promise<string>;
}

export class CalcomClient implements CalcomApi {
  constructor(
    private readonly options: {
      baseUrl?: string;
      fetch?: CalcomFetch;
      timeoutMs?: number;
    } = {},
  ) {}

  async getProfile(apiKey: string) {
    const payload = profileSchema.parse(await this.#request("/me", apiKey, {
      version: "2024-08-13",
    }));
    return payload.data;
  }

  async listEventTypes(apiKey: string): Promise<readonly CalcomEventType[]> {
    const payload = eventTypesSchema.parse(await this.#request("/event-types", apiKey, {
      version: "2024-06-14",
    }));
    return payload.data;
  }

  async listPublicEventTypes(input: {
    username: string;
    eventSlug: string;
  }): Promise<readonly CalcomEventType[]> {
    const query = new URLSearchParams({ username: input.username, eventSlug: input.eventSlug });
    const payload = eventTypesSchema.parse(await this.#request(`/event-types?${query}`, null, {
      version: "2024-06-14",
    }));
    return payload.data;
  }

  async listSlots(input: {
    apiKey: string | null;
    eventTypeId: number;
    start: string;
    end: string;
    timeZone: string;
  }): Promise<readonly CalcomSlot[]> {
    const query = new URLSearchParams({
      eventTypeId: String(input.eventTypeId),
      start: input.start,
      end: input.end,
      timeZone: input.timeZone,
      format: "range",
    });
    const payload = slotsSchema.parse(await this.#request(`/slots?${query}`, input.apiKey, {
      version: "2024-09-04",
    }));
    return Object.values(payload.data)
      .flat()
      .filter((slot) => Number.isFinite(Date.parse(slot.start)))
      .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
  }

  async createBooking(input: {
    apiKey: string | null;
    eventTypeId: number;
    start: string;
    attendee: {
      name: string;
      email: string;
      phoneNumber: string | null;
      timeZone: string;
      language: string;
    };
    metadata: Readonly<Record<string, string>>;
  }): Promise<CalcomBooking> {
    const payload = bookingSchema.parse(await this.#request("/bookings", input.apiKey, {
      method: "POST",
      version: "2026-02-25",
      body: {
        eventTypeId: input.eventTypeId,
        start: input.start,
        attendee: {
          name: input.attendee.name,
          email: input.attendee.email,
          timeZone: input.attendee.timeZone,
          language: input.attendee.language,
          ...(input.attendee.phoneNumber ? { phoneNumber: input.attendee.phoneNumber } : {}),
        },
        metadata: input.metadata,
      },
    }));
    return {
      uid: payload.data.uid,
      start: payload.data.start,
      end: payload.data.end,
      meetingUrl: meetingUrl(payload.data.location),
    };
  }

  async cancelBooking(input: {
    apiKey: string;
    bookingUid: string;
    reason: string;
  }): Promise<{ uid: string }> {
    const payload = bookingSchema.parse(await this.#request(
      `/bookings/${encodeURIComponent(input.bookingUid)}/cancel`,
      input.apiKey,
      {
        method: "POST",
        version: "2026-02-25",
        body: { cancellationReason: input.reason },
      },
    ));
    return { uid: payload.data.uid };
  }

  async rescheduleBooking(input: {
    apiKey: string;
    bookingUid: string;
    start: string;
    reason: string;
  }): Promise<CalcomBooking> {
    const payload = bookingSchema.parse(await this.#request(
      `/bookings/${encodeURIComponent(input.bookingUid)}/reschedule`,
      input.apiKey,
      {
        method: "POST",
        version: "2026-02-25",
        body: {
          start: new Date(input.start).toISOString(),
          reschedulingReason: input.reason,
        },
      },
    ));
    return {
      uid: payload.data.uid,
      start: payload.data.start,
      end: payload.data.end,
      meetingUrl: meetingUrl(payload.data.location),
    };
  }

  async createWebhook(input: {
    apiKey: string;
    subscriberUrl: string;
    secret: string;
  }): Promise<string> {
    const payload = webhookSchema.parse(await this.#request("/webhooks", input.apiKey, {
      method: "POST",
      version: "2024-08-13",
      body: {
        subscriberUrl: input.subscriberUrl,
        triggers: [
          "BOOKING_CREATED",
          "BOOKING_RESCHEDULED",
          "BOOKING_CANCELLED",
          "BOOKING_NO_SHOW_UPDATED",
        ],
        active: true,
        secret: input.secret,
      },
    }));
    return String(payload.data.id);
  }

  async #request(
    pathname: string,
    apiKey: string | null,
    input: {
      version: string;
      method?: "GET" | "POST";
      body?: unknown;
    },
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(
        new URL(pathname.replace(/^\/+/, ""), this.options.baseUrl ?? "https://api.cal.com/v2/"),
        {
          method: input.method ?? "GET",
          headers: {
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            "cal-api-version": input.version,
            ...(input.body ? { "content-type": "application/json" } : {}),
          },
          ...(input.body ? { body: JSON.stringify(input.body) } : {}),
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CalcomApiError("CALCOM_TIMEOUT", 504);
      }
      throw new CalcomApiError("CALCOM_UNREACHABLE", 502);
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new CalcomApiError(calcomErrorCode(response.status), response.status, safeProviderMessage(payload));
    }
    return payload;
  }
}

export class CalcomApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly providerMessage: string | null = null,
  ) {
    super(code);
  }
}

export function bookingUrlEventSlug(value: string): string | null {
  const url = new URL(value);
  if (url.hostname !== "cal.com" && url.hostname !== "www.cal.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  return segments.at(-1) ?? null;
}

export function bookingUrlIdentity(value: string): {
  username: string;
  eventSlug: string;
} | null {
  const url = new URL(value);
  if (url.hostname !== "cal.com" && url.hostname !== "www.cal.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return { username: segments.at(-2)!, eventSlug: segments.at(-1)! };
}

function calcomErrorCode(status: number): string {
  if (status === 401 || status === 403) return "CALCOM_AUTHENTICATION_FAILED";
  if (status === 404) return "CALCOM_RESOURCE_NOT_FOUND";
  if (status === 409) return "CALCOM_SLOT_UNAVAILABLE";
  if (status === 429) return "CALCOM_RATE_LIMITED";
  if (status >= 500) return "CALCOM_PROVIDER_UNAVAILABLE";
  return "CALCOM_REQUEST_REJECTED";
}

function safeProviderMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  for (const value of [record.message, record.error]) {
    if (typeof value === "string") return value.slice(0, 500);
  }
  return null;
}

function meetingUrl(value: unknown): string | null {
  if (typeof value === "string" && /^https:\/\//.test(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const candidate of [record.link, record.url, record.meetingUrl]) {
    if (typeof candidate === "string" && /^https:\/\//.test(candidate)) return candidate;
  }
  return null;
}
