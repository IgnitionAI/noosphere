import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { OpportunityStage } from "@outbound/domain/pipeline/opportunity";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  calendarBookingHistory,
  calendarBookings,
  calendarConnections,
  calendarMeetingTypes,
  campaignProspects,
  contactIdentities,
  contacts,
  conversations,
  integrationEvents,
  outboxEvents,
  outreachActions,
  sequenceEnrollments,
} from "@outbound/infrastructure/database/schema";
import { upsertOpportunityStage } from "@outbound/infrastructure/pipeline/opportunity-stage-writer";
import {
  bookingUrlIdentity,
  bookingUrlEventSlug,
  CalcomApiError,
  CalcomClient,
  type CalcomApi,
} from "@outbound/infrastructure/calendar/calcom-client";
import {
  decryptCalendarCredential,
  encryptCalendarCredential,
} from "@outbound/infrastructure/calendar/calendar-credential";
import {
  createCalendarContactToken,
  deriveCalendarWebhookSecret,
  normalizeCalcomWebhook,
  verifyCalendarContactToken,
} from "@outbound/infrastructure/calendar/calcom-webhook";

export interface CalendarConnectionView {
  readonly id: string;
  readonly provider: "calcom";
  readonly bookingUrl: string;
  readonly apiConfigured: boolean;
  readonly automationReady: boolean;
  readonly eventType: { readonly id: number; readonly slug: string; readonly title: string } | null;
  readonly username: string | null;
  readonly timeZone: string | null;
  readonly webhookRegistered: boolean;
  readonly lastVerifiedAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly status: "active" | "disabled";
  readonly updatedAt: Date;
}

export interface CalendarMeetingTypeView {
  readonly id: string;
  readonly providerEventTypeId: number;
  readonly slug: string;
  readonly title: string;
  readonly lengthMinutes: number;
  readonly bookingUrl: string;
  readonly timeZone: string;
  readonly isDefault: boolean;
  readonly active: boolean;
}

export interface WorkspaceBookingLinkResolver {
  resolve(input: { workspaceId: string; contactId: string }): Promise<string | null>;
}

export interface CalendarSlotView {
  readonly start: string;
  readonly end: string | null;
  readonly label: string;
}

export interface CalendarSchedulingContext {
  readonly status: "ready" | "link_only" | "email_required" | "unavailable";
  readonly bookingUrl: string | null;
  readonly timeZone: string;
  readonly canBook: boolean;
  readonly slots: readonly CalendarSlotView[];
  readonly meetingTypes?: readonly CalendarMeetingTypeView[];
  readonly activeBooking?: {
    readonly bookingId: string;
    readonly start: string;
    readonly label: string;
  };
}

export interface CalendarBookingResult {
  readonly bookingId: string;
  readonly start: string;
  readonly end: string;
  readonly meetingUrl: string | null;
  readonly label: string;
}

export interface CalendarProductBookingView {
  readonly id: string;
  readonly contactId: string | null;
  readonly campaignId: string | null;
  readonly opportunityId: string | null;
  readonly status: string;
  readonly attendeeName: string | null;
  readonly attendeeEmail: string | null;
  readonly attendeePhone: string | null;
  readonly attendeeTimeZone: string;
  readonly organizerTimeZone: string;
  readonly startAt: Date;
  readonly endAt: Date | null;
  readonly meetingUrl: string | null;
  readonly cancellationReason: string | null;
  readonly noShowAt: Date | null;
  readonly rescheduleCount: number;
  readonly meetingType: CalendarMeetingTypeView | null;
  readonly history: readonly {
    readonly id: string;
    readonly action: string;
    readonly fromStatus: string | null;
    readonly toStatus: string;
    readonly previousStartAt: Date | null;
    readonly newStartAt: Date | null;
    readonly reason: string | null;
    readonly source: string;
    readonly createdAt: Date;
  }[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WorkspaceCalendarScheduler extends WorkspaceBookingLinkResolver {
  schedulingContext(input: {
    workspaceId: string;
    contactId: string;
    now?: Date;
  }): Promise<CalendarSchedulingContext>;
  book(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    meetingTypeId?: string;
    start: string;
    now?: Date;
  }): Promise<CalendarBookingResult>;
  reschedule(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    bookingId?: string;
    start: string;
    reason: string;
    idempotencyKey?: string;
    actorUserId?: string | null;
    source?: string;
    now?: Date;
  }): Promise<CalendarBookingResult>;
  cancel(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    bookingId?: string;
    reason: string;
    idempotencyKey?: string;
    actorUserId?: string | null;
    source?: string;
    now?: Date;
  }): Promise<CalendarBookingResult>;
}

export class PostgresCalendarIntegration implements WorkspaceCalendarScheduler {
  constructor(
    private readonly database: Database,
    private readonly signingKey: string,
    private readonly calcom: CalcomApi = new CalcomClient(),
  ) {}

  async getDefaultConnection(workspaceId: string): Promise<CalendarConnectionView | null> {
    const [connection] = await this.database
      .select()
      .from(calendarConnections)
      .where(and(
        eq(calendarConnections.workspaceId, workspaceId),
        eq(calendarConnections.isDefault, true),
      ))
      .orderBy(desc(calendarConnections.updatedAt))
      .limit(1);
    return connection ? connectionView(connection) : null;
  }

  async listMeetingTypes(workspaceId: string): Promise<readonly CalendarMeetingTypeView[]> {
    const rows = await this.database.select().from(calendarMeetingTypes).where(eq(calendarMeetingTypes.workspaceId, workspaceId)).orderBy(desc(calendarMeetingTypes.isDefault), calendarMeetingTypes.title);
    return rows.map(meetingTypeView);
  }

  async configureMeetingTypes(input: { workspaceId: string; actorUserId: string; providerEventTypeIds: readonly number[]; defaultProviderEventTypeId: number; now: Date }): Promise<readonly CalendarMeetingTypeView[]> {
    if (!input.providerEventTypeIds.length || !input.providerEventTypeIds.includes(input.defaultProviderEventTypeId)) throw new CalendarIntegrationError("CALENDAR_MEETING_TYPE_SELECTION_INVALID", 422);
    const connection = await this.#rawDefaultConnection(input.workspaceId);
    if (!connection?.apiKeyCiphertext || !connection.username) throw new CalendarIntegrationError("CALENDAR_AUTOMATION_NOT_CONFIGURED", 409);
    const apiKey = decryptCalendarCredential(connection.apiKeyCiphertext, this.signingKey);
    const discovered = await this.calcom.listEventTypes(apiKey);
    const selected = discovered.filter((type) => input.providerEventTypeIds.includes(type.id));
    if (selected.length !== new Set(input.providerEventTypeIds).size) throw new CalendarIntegrationError("CALENDAR_MEETING_TYPE_NOT_FOUND", 422);
    await this.database.transaction(async (tx) => {
      await tx.update(calendarMeetingTypes).set({ active: false, isDefault: false, updatedAt: input.now }).where(and(eq(calendarMeetingTypes.workspaceId, input.workspaceId), eq(calendarMeetingTypes.connectionId, connection.id)));
      for (const type of selected) {
        await tx.insert(calendarMeetingTypes).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, connectionId: connection.id, providerEventTypeId: type.id, slug: type.slug, title: type.title, lengthMinutes: type.lengthInMinutes, bookingUrl: meetingTypeBookingUrl(connection.bookingUrl, connection.username, type.slug), timeZone: connection.timeZone ?? "Europe/Paris", isDefault: type.id === input.defaultProviderEventTypeId, active: true, createdAt: input.now, updatedAt: input.now }).onConflictDoUpdate({ target: [calendarMeetingTypes.workspaceId, calendarMeetingTypes.connectionId, calendarMeetingTypes.providerEventTypeId], set: { slug: type.slug, title: type.title, lengthMinutes: type.lengthInMinutes, bookingUrl: meetingTypeBookingUrl(connection.bookingUrl, connection.username, type.slug), timeZone: connection.timeZone ?? "Europe/Paris", isDefault: type.id === input.defaultProviderEventTypeId, active: true, updatedAt: input.now } });
      }
      const defaultType = selected.find((type) => type.id === input.defaultProviderEventTypeId)!;
      await tx.update(calendarConnections).set({ eventTypeId: defaultType.id, eventTypeSlug: defaultType.slug, eventTypeTitle: defaultType.title, bookingUrl: meetingTypeBookingUrl(connection.bookingUrl, connection.username!, defaultType.slug), updatedAt: input.now }).where(and(eq(calendarConnections.workspaceId, input.workspaceId), eq(calendarConnections.id, connection.id)));
      const eventId = crypto.randomUUID();
      await tx.insert(outboxEvents).values({ id: eventId, workspaceId: input.workspaceId, aggregateType: "CalendarConnection", aggregateId: connection.id, eventType: "CalendarMeetingTypesConfigured", payload: { providerEventTypeIds: selected.map((type) => type.id), defaultProviderEventTypeId: defaultType.id }, createdAt: input.now });
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "CalendarMeetingTypesConfigured", subjectType: "calendar_connection", subjectId: connection.id, changes: { providerEventTypeIds: selected.map((type) => type.id), defaultProviderEventTypeId: defaultType.id }, correlationId: `calendar-connection:${connection.id}`, sourceEventId: eventId, createdAt: input.now });
    });
    return this.listMeetingTypes(input.workspaceId);
  }

  async configure(input: {
    workspaceId: string;
    provider: "calcom";
    bookingUrl: string;
    apiKey?: string;
    publicWebhookBaseUrl?: string;
    now: Date;
  }): Promise<CalendarConnectionView> {
    const [existing] = await this.database
      .select()
      .from(calendarConnections)
      .where(and(
        eq(calendarConnections.workspaceId, input.workspaceId),
        eq(calendarConnections.isDefault, true),
      ))
      .orderBy(desc(calendarConnections.updatedAt))
      .limit(1);
    const connectionId = existing?.id ?? crypto.randomUUID();
    let discoveredEventTypes: readonly import("@outbound/infrastructure/calendar/calcom-client").CalcomEventType[] = [];
    let resolvedConfiguration: {
      apiKeyCiphertext?: string;
      eventTypeId: number;
      eventTypeSlug: string;
      eventTypeTitle: string;
      username: string;
      timeZone: string;
      webhookId: string | null;
      lastVerifiedAt: Date;
      lastErrorCode: string | null;
    } | null = null;
    if (input.apiKey) {
      const profile = await this.calcom.getProfile(input.apiKey);
      const eventTypes = await this.calcom.listEventTypes(input.apiKey);
      discoveredEventTypes = eventTypes;
      const requestedSlug = bookingUrlEventSlug(input.bookingUrl);
      const eventType = eventTypes.find((item) => item.slug === requestedSlug);
      if (!eventType) {
        throw new CalendarIntegrationError("CALCOM_EVENT_TYPE_NOT_FOUND", 422);
      }
      await this.calcom.listSlots({
        apiKey: input.apiKey,
        eventTypeId: eventType.id,
        start: isoDate(input.now),
        end: isoDate(new Date(input.now.getTime() + 14 * 24 * 60 * 60_000)),
        timeZone: profile.timeZone,
      });
      let webhookId = existing?.webhookId ?? null;
      let webhookError: string | null = null;
      if (!webhookId && input.publicWebhookBaseUrl) {
        const webhookUrl = new URL("/api/v1/webhooks/calendar/calcom", input.publicWebhookBaseUrl);
        webhookUrl.searchParams.set("connection", connectionId);
        try {
          webhookId = await this.calcom.createWebhook({
            apiKey: input.apiKey,
            subscriberUrl: webhookUrl.toString(),
            secret: deriveCalendarWebhookSecret(this.signingKey, connectionId),
          });
        } catch (error) {
          webhookError = calendarErrorCode(error);
        }
      }
      resolvedConfiguration = {
        apiKeyCiphertext: encryptCalendarCredential(input.apiKey, this.signingKey),
        eventTypeId: eventType.id,
        eventTypeSlug: eventType.slug,
        eventTypeTitle: eventType.title,
        username: profile.username,
        timeZone: profile.timeZone,
        webhookId,
        lastVerifiedAt: input.now,
        lastErrorCode: webhookError,
      };
    } else {
      const identity = bookingUrlIdentity(input.bookingUrl);
      if (identity) {
        const eventTypes = await this.calcom.listPublicEventTypes(identity);
        discoveredEventTypes = eventTypes;
        const eventType = eventTypes.find((item) => item.slug === identity.eventSlug);
        if (!eventType) throw new CalendarIntegrationError("CALCOM_EVENT_TYPE_NOT_FOUND", 422);
        const timeZone = existing?.timeZone ?? "Europe/Paris";
        await this.calcom.listSlots({
          apiKey: null,
          eventTypeId: eventType.id,
          start: isoDate(input.now),
          end: isoDate(new Date(input.now.getTime() + 14 * 24 * 60 * 60_000)),
          timeZone,
        });
        resolvedConfiguration = {
          eventTypeId: eventType.id,
          eventTypeSlug: eventType.slug,
          eventTypeTitle: eventType.title,
          username: identity.username,
          timeZone,
          webhookId: existing?.webhookId ?? null,
          lastVerifiedAt: input.now,
          lastErrorCode: existing?.lastErrorCode ?? null,
        };
      }
    }
    if (existing) {
      const [updated] = await this.database
        .update(calendarConnections)
        .set({
          provider: input.provider,
          bookingUrl: input.bookingUrl,
          ...(resolvedConfiguration ?? {}),
          status: "active",
          updatedAt: input.now,
        })
        .where(and(
          eq(calendarConnections.workspaceId, input.workspaceId),
          eq(calendarConnections.id, existing.id),
        ))
        .returning();
      if (!updated) throw new Error("CALENDAR_CONNECTION_WRITE_FAILED");
      await this.#syncMeetingTypes(updated, discoveredEventTypes, input.now);
      return connectionView(updated);
    }
    const [created] = await this.database
      .insert(calendarConnections)
      .values({
        id: connectionId,
        workspaceId: input.workspaceId,
        provider: input.provider,
        bookingUrl: input.bookingUrl,
        ...(resolvedConfiguration ?? {}),
        status: "active",
        isDefault: true,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    if (!created) throw new Error("CALENDAR_CONNECTION_WRITE_FAILED");
    await this.#syncMeetingTypes(created, discoveredEventTypes, input.now);
    return connectionView(created);
  }

  async disable(input: { workspaceId: string; now: Date }): Promise<void> {
    await this.database
      .update(calendarConnections)
      .set({
        status: "disabled",
        isDefault: false,
        apiKeyCiphertext: null,
        eventTypeId: null,
        eventTypeSlug: null,
        eventTypeTitle: null,
        username: null,
        timeZone: null,
        webhookId: null,
        lastErrorCode: null,
        updatedAt: input.now,
      })
      .where(and(
        eq(calendarConnections.workspaceId, input.workspaceId),
        eq(calendarConnections.isDefault, true),
      ));
  }

  async resolve(input: { workspaceId: string; contactId: string }): Promise<string | null> {
    const connection = await this.getDefaultConnection(input.workspaceId);
    if (!connection || connection.status !== "active") return null;
    const [contact] = await this.database
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, input.contactId)))
      .limit(1);
    if (!contact) return null;
    const url = new URL(connection.bookingUrl);
    url.searchParams.set(
      "metadata[ignitionContact]",
      createCalendarContactToken(this.signingKey, connection.id, input.contactId),
    );
    url.searchParams.set("utm_source", "ignition-outbound");
    url.searchParams.set("utm_medium", "setter");
    return url.toString();
  }

  async schedulingContext(input: {
    workspaceId: string;
    contactId: string;
    now?: Date;
  }): Promise<CalendarSchedulingContext> {
    const connection = await this.#rawDefaultConnection(input.workspaceId);
    const meetingTypes = await this.listMeetingTypes(input.workspaceId);
    const selectedType = meetingTypes.find((type) => type.active && type.isDefault) ?? meetingTypes.find((type) => type.active) ?? null;
    const timeZone = connection?.timeZone ?? "Europe/Paris";
    const bookingUrl = await this.resolve(input);
    if (!connection?.eventTypeId) {
      return { status: "link_only", bookingUrl, timeZone, canBook: false, slots: [], meetingTypes };
    }
    const attendee = await this.#attendee(input.workspaceId, input.contactId);
    if (!attendee?.email) {
      return { status: "email_required", bookingUrl, timeZone, canBook: false, slots: [], meetingTypes };
    }
    const now = input.now ?? new Date();
    try {
      const apiKey = connection.apiKeyCiphertext
        ? decryptCalendarCredential(connection.apiKeyCiphertext, this.signingKey)
        : null;
      const slots = await this.calcom.listSlots({
        apiKey,
        eventTypeId: selectedType?.providerEventTypeId ?? connection.eventTypeId,
        start: isoDate(now),
        end: isoDate(new Date(now.getTime() + 14 * 24 * 60 * 60_000)),
        timeZone,
      });
      return {
        status: "ready",
        bookingUrl,
        timeZone,
        canBook: true,
        slots: slots
          .filter((slot) => Date.parse(slot.start) > now.getTime() + 30 * 60_000)
          .slice(0, 6)
          .map((slot) => ({ ...slot, label: slotLabel(slot.start, timeZone) })),
        meetingTypes,
      };
    } catch (error) {
      await this.#recordError(connection.id, calendarErrorCode(error));
      return { status: "unavailable", bookingUrl, timeZone, canBook: false, slots: [], meetingTypes };
    }
  }

  async book(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    meetingTypeId?: string;
    start: string;
    now?: Date;
  }): Promise<CalendarBookingResult> {
    const requestedStart = new Date(input.start);
    if (!Number.isFinite(requestedStart.getTime())) {
      throw new CalendarIntegrationError("CALENDAR_SLOT_INVALID", 422);
    }
    const connection = await this.#rawDefaultConnection(input.workspaceId);
    if (!connection?.eventTypeId) {
      throw new CalendarIntegrationError("CALENDAR_EVENT_TYPE_NOT_CONFIGURED", 409);
    }
    const attendee = await this.#attendee(input.workspaceId, input.contactId);
    if (!attendee?.email) {
      throw new CalendarIntegrationError("CALENDAR_ATTENDEE_EMAIL_MISSING", 422);
    }
    const apiKey = connection.apiKeyCiphertext
      ? decryptCalendarCredential(connection.apiKeyCiphertext, this.signingKey)
      : null;
    const timeZone = connection.timeZone ?? "Europe/Paris";
    const meetingType = input.meetingTypeId
      ? (await this.listMeetingTypes(input.workspaceId)).find((type) => type.id === input.meetingTypeId && type.active)
      : (await this.listMeetingTypes(input.workspaceId)).find((type) => type.active && type.isDefault);
    if (input.meetingTypeId && !meetingType) throw new CalendarIntegrationError("CALENDAR_MEETING_TYPE_NOT_FOUND", 422);
    const eventTypeId = meetingType?.providerEventTypeId ?? connection.eventTypeId;
    const dayStart = new Date(requestedStart.getTime() - 12 * 60 * 60_000);
    const dayEnd = new Date(requestedStart.getTime() + 36 * 60 * 60_000);
    const available = await this.calcom.listSlots({
      apiKey,
      eventTypeId,
      start: isoDate(dayStart),
      end: isoDate(dayEnd),
      timeZone,
    });
    const selected = available.find((slot) => Date.parse(slot.start) === requestedStart.getTime());
    if (!selected) throw new CalendarIntegrationError("CALCOM_SLOT_UNAVAILABLE", 409);
    const existing = await this.#existingBooking(input.workspaceId, input.contactId, requestedStart);
    if (existing) return bookingResult(existing, timeZone);
    let created;
    try {
      created = await this.calcom.createBooking({
        apiKey,
        eventTypeId,
        start: requestedStart.toISOString(),
        attendee: {
          name: attendee.name,
          email: attendee.email,
          phoneNumber: attendee.phone,
          timeZone,
          language: "fr",
        },
        metadata: {
          ignitionContact: createCalendarContactToken(
            this.signingKey,
            connection.id,
            input.contactId,
          ),
          ignitionSource: "setter",
        },
      });
    } catch (error) {
      await this.#recordError(connection.id, calendarErrorCode(error));
      if (error instanceof CalcomApiError) {
        throw new CalendarIntegrationError(error.code, error.status);
      }
      throw error;
    }
    const now = input.now ?? new Date();
    const [persisted] = await this.database.insert(calendarBookings).values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      connectionId: connection.id,
      meetingTypeId: meetingType?.id ?? null,
      providerBookingId: created.uid,
      contactId: input.contactId,
      campaignId: input.campaignId,
      status: "booked",
      attendeeName: attendee.name,
      attendeeEmail: attendee.email,
      attendeePhone: attendee.phone,
      organizerTimeZone: timeZone,
      startAt: new Date(created.start),
      endAt: new Date(created.end),
      meetingUrl: created.meetingUrl,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        calendarBookings.workspaceId,
        calendarBookings.connectionId,
        calendarBookings.providerBookingId,
      ],
      set: { status: "booked", updatedAt: now },
    }).returning();
    if (!persisted) throw new Error("CALENDAR_BOOKING_WRITE_FAILED");
    await this.#applyBookedState({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      bookingId: persisted.id,
      providerBookingId: created.uid,
      startAt: persisted.startAt,
      meetingUrl: persisted.meetingUrl,
      now,
    });
    return bookingResult(persisted, timeZone);
  }

  async reschedule(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    bookingId?: string;
    start: string;
    reason: string;
    idempotencyKey?: string;
    actorUserId?: string | null;
    source?: string;
    now?: Date;
  }): Promise<CalendarBookingResult> {
    const requestedStart = new Date(input.start);
    if (!Number.isFinite(requestedStart.getTime())) {
      throw new CalendarIntegrationError("CALENDAR_SLOT_INVALID", 422);
    }
    const connection = await this.#rawDefaultConnection(input.workspaceId);
    if (!connection?.eventTypeId || !connection.apiKeyCiphertext) {
      throw new CalendarIntegrationError("CALENDAR_AUTOMATION_NOT_CONFIGURED", 409);
    }
    const current = input.bookingId
      ? await this.#bookingById(input.workspaceId, input.bookingId)
      : await this.#latestActiveBooking(input.workspaceId, input.contactId, input.campaignId);
    if (!current) throw new CalendarIntegrationError("CALENDAR_ACTIVE_BOOKING_NOT_FOUND", 404);
    if (current.status === "cancelled" || current.status === "no_show" || current.status === "completed") throw new CalendarIntegrationError("CALENDAR_BOOKING_NOT_MUTABLE", 409);
    const apiKey = decryptCalendarCredential(connection.apiKeyCiphertext, this.signingKey);
    const timeZone = connection.timeZone ?? "Europe/Paris";
    const available = await this.calcom.listSlots({
      apiKey,
      eventTypeId: connection.eventTypeId,
      start: isoDate(new Date(requestedStart.getTime() - 12 * 60 * 60_000)),
      end: isoDate(new Date(requestedStart.getTime() + 36 * 60 * 60_000)),
      timeZone,
    });
    if (!available.some((slot) => Date.parse(slot.start) === requestedStart.getTime())) {
      throw new CalendarIntegrationError("CALCOM_SLOT_UNAVAILABLE", 409);
    }
    const now = input.now ?? new Date();
    const idempotencyKey = input.idempotencyKey ?? `reschedule:${current.id}:${requestedStart.toISOString()}`;
    const source = input.source ?? "setter:calcom";
    const persisted = await this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${current.id}`}, 0))`);
      const [locked] = await tx.select().from(calendarBookings).where(and(eq(calendarBookings.workspaceId, input.workspaceId), eq(calendarBookings.id, current.id))).limit(1).for("update");
      if (!locked) throw new CalendarIntegrationError("CALENDAR_ACTIVE_BOOKING_NOT_FOUND", 404);
      const [completed] = await tx.select({ id: calendarBookingHistory.id }).from(calendarBookingHistory).where(and(eq(calendarBookingHistory.workspaceId, input.workspaceId), eq(calendarBookingHistory.bookingId, current.id), eq(calendarBookingHistory.idempotencyKey, idempotencyKey))).limit(1);
      if (completed) return locked;
      let moved;
      try {
        moved = await this.calcom.rescheduleBooking({ apiKey, bookingUid: locked.providerBookingId, start: requestedStart.toISOString(), reason: input.reason });
      } catch (error) {
        if (error instanceof CalcomApiError) throw new CalendarIntegrationError(error.code, error.status);
        throw error;
      }
      const opportunity = await upsertOpportunityStage(tx, { workspaceId: input.workspaceId, contactId: input.contactId, campaignId: input.campaignId, stage: "meeting_booked", nextAction: opportunityNextAction("booked", new Date(moved.start), moved.meetingUrl), source, reason: input.reason, now });
      const [booking] = await tx.update(calendarBookings).set({
        providerBookingId: moved.uid,
        opportunityId: opportunity.id,
        status: "booked",
        startAt: new Date(moved.start),
        endAt: new Date(moved.end),
        meetingUrl: moved.meetingUrl,
        organizerTimeZone: timeZone,
        rescheduleCount: locked.rescheduleCount + 1,
        updatedAt: now,
      }).where(and(eq(calendarBookings.workspaceId, input.workspaceId), eq(calendarBookings.id, locked.id))).returning();
      if (!booking) throw new Error("CALENDAR_BOOKING_WRITE_FAILED");
      await tx.insert(calendarBookingHistory).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, bookingId: booking.id, action: "rescheduled", idempotencyKey, fromStatus: locked.status, toStatus: "booked", previousProviderBookingId: locked.providerBookingId, newProviderBookingId: moved.uid, previousStartAt: locked.startAt, newStartAt: new Date(moved.start), reason: input.reason, actorUserId: input.actorUserId ?? null, source, createdAt: now });
      const eventId = crypto.randomUUID();
      await tx.insert(outboxEvents).values({ id: eventId, workspaceId: input.workspaceId, aggregateType: "CalendarBooking", aggregateId: booking.id, eventType: "CalendarMeetingRescheduled", payload: { contactId: input.contactId, campaignId: input.campaignId, bookingId: booking.id, providerBookingId: moved.uid, startAt: moved.start, correlationId: `calendar-booking:${booking.id}` }, createdAt: now });
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, actorUserId: input.actorUserId ?? null, action: "CalendarMeetingRescheduled", subjectType: "calendar_booking", subjectId: booking.id, changes: { previousStartAt: locked.startAt.toISOString(), newStartAt: moved.start, reason: input.reason, source }, correlationId: `calendar-booking:${booking.id}`, sourceEventId: eventId, createdAt: now });
      return booking;
    });
    return bookingResult(persisted, timeZone);
  }

  async cancel(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    bookingId?: string;
    reason: string;
    idempotencyKey?: string;
    actorUserId?: string | null;
    source?: string;
    now?: Date;
  }): Promise<CalendarBookingResult> {
    const connection = await this.#rawDefaultConnection(input.workspaceId);
    if (!connection?.apiKeyCiphertext) {
      throw new CalendarIntegrationError("CALENDAR_AUTOMATION_NOT_CONFIGURED", 409);
    }
    const current = input.bookingId
      ? await this.#bookingById(input.workspaceId, input.bookingId)
      : await this.#latestActiveBooking(input.workspaceId, input.contactId, input.campaignId);
    if (!current) {
      const cancelled = await this.#latestBookingByStatus(
        input.workspaceId,
        input.contactId,
        input.campaignId,
        "cancelled",
      );
      if (cancelled) return bookingResult(cancelled, connection.timeZone ?? "Europe/Paris");
      throw new CalendarIntegrationError("CALENDAR_ACTIVE_BOOKING_NOT_FOUND", 404);
    }
    const now = input.now ?? new Date();
    const apiKey = decryptCalendarCredential(connection.apiKeyCiphertext, this.signingKey);
    const idempotencyKey = input.idempotencyKey ?? `cancel:${current.id}`;
    const source = input.source ?? "setter:calcom";
    const persisted = await this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${current.id}`}, 0))`);
      const [locked] = await tx.select().from(calendarBookings).where(and(eq(calendarBookings.workspaceId, input.workspaceId), eq(calendarBookings.id, current.id))).limit(1).for("update");
      if (!locked) throw new CalendarIntegrationError("CALENDAR_ACTIVE_BOOKING_NOT_FOUND", 404);
      const [completed] = await tx.select({ id: calendarBookingHistory.id }).from(calendarBookingHistory).where(and(eq(calendarBookingHistory.workspaceId, input.workspaceId), eq(calendarBookingHistory.bookingId, current.id), eq(calendarBookingHistory.idempotencyKey, idempotencyKey))).limit(1);
      if (completed || locked.status === "cancelled") return locked;
      try { await this.calcom.cancelBooking({ apiKey, bookingUid: locked.providerBookingId, reason: input.reason }); }
      catch (error) { if (error instanceof CalcomApiError) throw new CalendarIntegrationError(error.code, error.status); throw error; }
      const opportunity = await upsertOpportunityStage(tx, {
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        stage: "qualified",
        nextAction: "Rendez-vous annulé — proposer automatiquement un nouveau créneau.",
        source,
        reason: input.reason,
        now,
      });
      const [booking] = await tx.update(calendarBookings).set({ status: "cancelled", opportunityId: opportunity.id, cancellationReason: input.reason, updatedAt: now }).where(and(eq(calendarBookings.workspaceId, input.workspaceId), eq(calendarBookings.id, locked.id))).returning();
      if (!booking) throw new Error("CALENDAR_BOOKING_WRITE_FAILED");
      await tx.insert(calendarBookingHistory).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, bookingId: booking.id, action: "cancelled", idempotencyKey, fromStatus: locked.status, toStatus: "cancelled", previousProviderBookingId: locked.providerBookingId, newProviderBookingId: locked.providerBookingId, previousStartAt: locked.startAt, newStartAt: locked.startAt, reason: input.reason, actorUserId: input.actorUserId ?? null, source, createdAt: now });
      const eventId = crypto.randomUUID();
      await tx.insert(outboxEvents).values({
        id: eventId,
        workspaceId: input.workspaceId,
        aggregateType: "CalendarBooking",
        aggregateId: current.id,
        eventType: "CalendarMeetingCancelled",
        payload: {
          contactId: input.contactId,
          campaignId: input.campaignId,
          bookingId: booking.id,
          providerBookingId: booking.providerBookingId,
          source,
          correlationId: `calendar-booking:${booking.id}`,
        },
        createdAt: now,
      });
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, actorUserId: input.actorUserId ?? null, action: "CalendarMeetingCancelled", subjectType: "calendar_booking", subjectId: booking.id, changes: { reason: input.reason, source }, correlationId: `calendar-booking:${booking.id}`, sourceEventId: eventId, createdAt: now });
      return booking;
    });
    return bookingResult(persisted, connection.timeZone ?? "Europe/Paris");
  }

  async listBookings(input: { workspaceId: string; contactId?: string; opportunityId?: string; limit: number }): Promise<readonly CalendarProductBookingView[]> {
    const predicates = [eq(calendarBookings.workspaceId, input.workspaceId)];
    if (input.contactId) predicates.push(eq(calendarBookings.contactId, input.contactId));
    if (input.opportunityId) predicates.push(eq(calendarBookings.opportunityId, input.opportunityId));
    const rows = await this.database.select({ booking: calendarBookings, meetingType: calendarMeetingTypes }).from(calendarBookings).leftJoin(calendarMeetingTypes, and(eq(calendarMeetingTypes.workspaceId, calendarBookings.workspaceId), eq(calendarMeetingTypes.id, calendarBookings.meetingTypeId))).where(and(...predicates)).orderBy(desc(calendarBookings.startAt)).limit(input.limit);
    const ids = rows.map((row) => row.booking.id);
    const history = ids.length ? await this.database.select().from(calendarBookingHistory).where(and(eq(calendarBookingHistory.workspaceId, input.workspaceId), inArray(calendarBookingHistory.bookingId, ids))).orderBy(calendarBookingHistory.createdAt) : [];
    return rows.map(({ booking, meetingType }) => productBookingView(booking, meetingType, history.filter((entry) => entry.bookingId === booking.id)));
  }

  async rescheduleById(input: { workspaceId: string; bookingId: string; start: string; reason: string; requestKey: string; actorUserId: string; now: Date }): Promise<CalendarBookingResult> {
    const booking = await this.#bookingById(input.workspaceId, input.bookingId);
    if (!booking?.contactId) throw new CalendarIntegrationError("CALENDAR_BOOKING_NOT_FOUND", 404);
    return this.reschedule({ workspaceId: input.workspaceId, bookingId: booking.id, contactId: booking.contactId, campaignId: booking.campaignId, start: input.start, reason: input.reason, idempotencyKey: input.requestKey, actorUserId: input.actorUserId, source: "operator", now: input.now });
  }

  async cancelById(input: { workspaceId: string; bookingId: string; reason: string; requestKey: string; actorUserId: string; now: Date }): Promise<CalendarBookingResult> {
    const booking = await this.#bookingById(input.workspaceId, input.bookingId);
    if (!booking?.contactId) throw new CalendarIntegrationError("CALENDAR_BOOKING_NOT_FOUND", 404);
    return this.cancel({ workspaceId: input.workspaceId, bookingId: booking.id, contactId: booking.contactId, campaignId: booking.campaignId, reason: input.reason, idempotencyKey: input.requestKey, actorUserId: input.actorUserId, source: "operator", now: input.now });
  }

  async markNoShow(input: { workspaceId: string; bookingId: string; reason: string; requestKey: string; actorUserId: string; now: Date }): Promise<CalendarProductBookingView> {
    const persisted = await this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.bookingId}`}, 0))`);
      const [booking] = await tx.select().from(calendarBookings).where(and(eq(calendarBookings.workspaceId, input.workspaceId), eq(calendarBookings.id, input.bookingId))).limit(1).for("update");
      if (!booking?.contactId) throw new CalendarIntegrationError("CALENDAR_BOOKING_NOT_FOUND", 404);
      const [completed] = await tx.select({ id: calendarBookingHistory.id }).from(calendarBookingHistory).where(and(eq(calendarBookingHistory.workspaceId, input.workspaceId), eq(calendarBookingHistory.bookingId, booking.id), eq(calendarBookingHistory.idempotencyKey, input.requestKey))).limit(1);
      if (completed || booking.status === "no_show") return booking;
      if (booking.status === "cancelled" || booking.status === "completed") throw new CalendarIntegrationError("CALENDAR_BOOKING_NOT_MUTABLE", 409);
      const opportunity = await upsertOpportunityStage(tx, { workspaceId: input.workspaceId, contactId: booking.contactId, campaignId: booking.campaignId, stage: "meeting_no_show", nextAction: "Absent au rendez-vous — proposer immédiatement une replanification.", source: "operator", reason: input.reason, now: input.now });
      const [updated] = await tx.update(calendarBookings).set({ status: "no_show", opportunityId: opportunity.id, noShowAt: input.now, updatedAt: input.now }).where(and(eq(calendarBookings.workspaceId, input.workspaceId), eq(calendarBookings.id, booking.id))).returning();
      if (!updated) throw new Error("CALENDAR_BOOKING_WRITE_FAILED");
      await tx.update(sequenceEnrollments).set({ status: "suspended", suspensionReason: "MEETING_NO_SHOW", suspendedAt: input.now, updatedAt: input.now }).where(and(eq(sequenceEnrollments.workspaceId, input.workspaceId), eq(sequenceEnrollments.contactId, booking.contactId), eq(sequenceEnrollments.status, "active")));
      await tx.update(outreachActions).set({ status: "cancelled", lastErrorCode: "MEETING_NO_SHOW", lastErrorMessage: "Relances arrêtées ; une replanification dédiée doit être proposée.", updatedAt: input.now }).where(and(eq(outreachActions.workspaceId, input.workspaceId), eq(outreachActions.contactId, booking.contactId), eq(outreachActions.status, "scheduled")));
      await tx.insert(calendarBookingHistory).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, bookingId: booking.id, action: "no_show", idempotencyKey: input.requestKey, fromStatus: booking.status, toStatus: "no_show", previousProviderBookingId: booking.providerBookingId, newProviderBookingId: booking.providerBookingId, previousStartAt: booking.startAt, newStartAt: booking.startAt, reason: input.reason, actorUserId: input.actorUserId, source: "operator", createdAt: input.now });
      const eventId = crypto.randomUUID();
      await tx.insert(outboxEvents).values({ id: eventId, workspaceId: input.workspaceId, aggregateType: "CalendarBooking", aggregateId: booking.id, eventType: "CalendarMeetingNoShow", payload: { contactId: booking.contactId, campaignId: booking.campaignId, bookingId: booking.id, correlationId: `calendar-booking:${booking.id}` }, createdAt: input.now });
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "CalendarMeetingNoShow", subjectType: "calendar_booking", subjectId: booking.id, changes: { reason: input.reason }, correlationId: `calendar-booking:${booking.id}`, sourceEventId: eventId, createdAt: input.now });
      return updated;
    });
    const [meetingType] = persisted.meetingTypeId ? await this.database.select().from(calendarMeetingTypes).where(and(eq(calendarMeetingTypes.workspaceId, input.workspaceId), eq(calendarMeetingTypes.id, persisted.meetingTypeId))).limit(1) : [];
    const history = await this.database.select().from(calendarBookingHistory).where(and(eq(calendarBookingHistory.workspaceId, input.workspaceId), eq(calendarBookingHistory.bookingId, persisted.id))).orderBy(calendarBookingHistory.createdAt);
    return productBookingView(persisted, meetingType ?? null, history);
  }

  async #syncMeetingTypes(connection: typeof calendarConnections.$inferSelect, discovered: readonly import("@outbound/infrastructure/calendar/calcom-client").CalcomEventType[], now: Date): Promise<void> {
    if (!discovered.length || !connection.eventTypeId) return;
    await this.database.transaction(async (tx) => {
      const existing = await tx.select().from(calendarMeetingTypes).where(and(eq(calendarMeetingTypes.workspaceId, connection.workspaceId), eq(calendarMeetingTypes.connectionId, connection.id)));
      const byProviderId = new Map(existing.map((type) => [type.providerEventTypeId, type]));
      await tx.update(calendarMeetingTypes).set({ isDefault: false, updatedAt: now }).where(and(eq(calendarMeetingTypes.workspaceId, connection.workspaceId), eq(calendarMeetingTypes.connectionId, connection.id)));
      for (const type of discovered) {
        const previous = byProviderId.get(type.id);
        await tx.insert(calendarMeetingTypes).values({ id: crypto.randomUUID(), workspaceId: connection.workspaceId, connectionId: connection.id, providerEventTypeId: type.id, slug: type.slug, title: type.title, lengthMinutes: type.lengthInMinutes, bookingUrl: meetingTypeBookingUrl(connection.bookingUrl, connection.username, type.slug), timeZone: connection.timeZone ?? "Europe/Paris", isDefault: type.id === connection.eventTypeId, active: previous?.active ?? true, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [calendarMeetingTypes.workspaceId, calendarMeetingTypes.connectionId, calendarMeetingTypes.providerEventTypeId], set: { slug: type.slug, title: type.title, lengthMinutes: type.lengthInMinutes, bookingUrl: meetingTypeBookingUrl(connection.bookingUrl, connection.username, type.slug), timeZone: connection.timeZone ?? "Europe/Paris", isDefault: type.id === connection.eventTypeId, active: previous?.active ?? true, updatedAt: now } });
      }
      for (const stale of existing.filter((type) => !discovered.some((candidate) => candidate.id === type.providerEventTypeId))) {
        await tx.update(calendarMeetingTypes).set({ active: false, isDefault: false, updatedAt: now }).where(eq(calendarMeetingTypes.id, stale.id));
      }
    });
  }

  async #rawDefaultConnection(workspaceId: string) {
    const [connection] = await this.database
      .select()
      .from(calendarConnections)
      .where(and(
        eq(calendarConnections.workspaceId, workspaceId),
        eq(calendarConnections.isDefault, true),
        eq(calendarConnections.status, "active"),
      ))
      .orderBy(desc(calendarConnections.updatedAt))
      .limit(1);
    return connection ?? null;
  }

  async #bookingById(workspaceId: string, bookingId: string) {
    const [booking] = await this.database.select().from(calendarBookings).where(and(eq(calendarBookings.workspaceId, workspaceId), eq(calendarBookings.id, bookingId))).limit(1);
    return booking ?? null;
  }

  async #attendee(workspaceId: string, contactId: string) {
    const [contact] = await this.database
      .select({ firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)))
      .limit(1);
    if (!contact) return null;
    const identities = await this.database
      .select({ type: contactIdentities.type, value: contactIdentities.normalizedValue })
      .from(contactIdentities)
      .where(and(
        eq(contactIdentities.workspaceId, workspaceId),
        eq(contactIdentities.contactId, contactId),
      ));
    return {
      name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: identities.find((identity) => identity.type === "email")?.value ?? null,
      phone: identities.find((identity) => identity.type === "phone")?.value
        ?? identities.find((identity) => identity.type === "whatsapp")?.value
        ?? null,
    };
  }

  async #existingBooking(workspaceId: string, contactId: string, startAt: Date) {
    const [booking] = await this.database
      .select()
      .from(calendarBookings)
      .where(and(
        eq(calendarBookings.workspaceId, workspaceId),
        eq(calendarBookings.contactId, contactId),
        eq(calendarBookings.startAt, startAt),
        inArray(calendarBookings.status, ["requested", "booked"]),
      ))
      .limit(1);
    return booking ?? null;
  }

  async #latestActiveBooking(
    workspaceId: string,
    contactId: string,
    campaignId: string | null,
  ) {
    const predicates = [
      eq(calendarBookings.workspaceId, workspaceId),
      eq(calendarBookings.contactId, contactId),
      inArray(calendarBookings.status, ["requested", "booked"]),
    ];
    if (campaignId) predicates.push(eq(calendarBookings.campaignId, campaignId));
    const [booking] = await this.database
      .select()
      .from(calendarBookings)
      .where(and(...predicates))
      .orderBy(desc(calendarBookings.updatedAt))
      .limit(1);
    return booking ?? null;
  }

  async #latestBookingByStatus(
    workspaceId: string,
    contactId: string,
    campaignId: string | null,
    status: string,
  ) {
    const predicates = [
      eq(calendarBookings.workspaceId, workspaceId),
      eq(calendarBookings.contactId, contactId),
      eq(calendarBookings.status, status),
    ];
    if (campaignId) predicates.push(eq(calendarBookings.campaignId, campaignId));
    const [booking] = await this.database
      .select()
      .from(calendarBookings)
      .where(and(...predicates))
      .orderBy(desc(calendarBookings.updatedAt))
      .limit(1);
    return booking ?? null;
  }

  async #applyBookedState(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    bookingId: string;
    providerBookingId: string;
    startAt: Date;
    meetingUrl: string | null;
    now: Date;
  }) {
    await this.database.transaction(async (tx) => {
      const opportunity = await upsertOpportunityStage(tx, {
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        stage: "meeting_booked",
        nextAction: opportunityNextAction("booked", input.startAt, input.meetingUrl),
        source: "setter:calcom",
        reason: "Le Setter a réservé le créneau choisi via l’API Cal.com.",
        now: input.now,
      });
      await tx.update(calendarBookings).set({ opportunityId: opportunity.id, organizerTimeZone: sql`coalesce(${calendarBookings.organizerTimeZone}, 'Europe/Paris')`, updatedAt: input.now }).where(and(eq(calendarBookings.workspaceId, input.workspaceId), eq(calendarBookings.id, input.bookingId)));
      await tx.update(sequenceEnrollments).set({
        status: "suspended",
        suspensionReason: "MEETING_BOOKED",
        suspendedAt: input.now,
        updatedAt: input.now,
      }).where(and(
        eq(sequenceEnrollments.workspaceId, input.workspaceId),
        eq(sequenceEnrollments.contactId, input.contactId),
        eq(sequenceEnrollments.status, "active"),
      ));
      await tx.update(outreachActions).set({
        status: "cancelled",
        lastErrorCode: "MEETING_BOOKED",
        lastErrorMessage: "Les relances sont arrêtées après la réservation du rendez-vous.",
        updatedAt: input.now,
      }).where(and(
        eq(outreachActions.workspaceId, input.workspaceId),
        eq(outreachActions.contactId, input.contactId),
        eq(outreachActions.status, "scheduled"),
      ));
      await tx.insert(calendarBookingHistory).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, bookingId: input.bookingId, action: "booked", idempotencyKey: `book:${input.providerBookingId}`, fromStatus: null, toStatus: "booked", newProviderBookingId: input.providerBookingId, newStartAt: input.startAt, source: "setter:calcom", createdAt: input.now }).onConflictDoNothing();
      const eventId = crypto.randomUUID();
      await tx.insert(outboxEvents).values({
        id: eventId,
        workspaceId: input.workspaceId,
        aggregateType: "CalendarBooking",
        aggregateId: input.bookingId,
        eventType: "CalendarMeetingBooked",
        payload: {
          contactId: input.contactId,
          campaignId: input.campaignId,
          bookingId: input.providerBookingId,
          startAt: input.startAt.toISOString(),
          source: "setter:calcom",
          correlationId: `calendar-booking:${input.bookingId}`,
        },
        createdAt: input.now,
      });
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, actorUserId: null, action: "CalendarMeetingBooked", subjectType: "calendar_booking", subjectId: input.bookingId, changes: { startAt: input.startAt.toISOString(), source: "setter:calcom" }, correlationId: `calendar-booking:${input.bookingId}`, sourceEventId: eventId, createdAt: input.now });
    });
  }

  async #recordError(connectionId: string, errorCode: string): Promise<void> {
    await this.database
      .update(calendarConnections)
      .set({ lastErrorCode: errorCode, updatedAt: new Date() })
      .where(eq(calendarConnections.id, connectionId));
  }

  async ingestCalcom(input: {
    connectionId: string;
    rawBody: string;
  }): Promise<{ duplicate: boolean; matched: boolean; eventId: string }> {
    const [connection] = await this.database
      .select()
      .from(calendarConnections)
      .where(and(
        eq(calendarConnections.id, input.connectionId),
        eq(calendarConnections.provider, "calcom"),
        eq(calendarConnections.status, "active"),
      ))
      .limit(1);
    if (!connection) throw new CalendarIntegrationError("CALENDAR_CONNECTION_NOT_FOUND", 404);
    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      throw new CalendarIntegrationError("CALENDAR_WEBHOOK_JSON_INVALID", 400);
    }
    const event = normalizeCalcomWebhook(payload);
    if (!event) throw new CalendarIntegrationError("CALENDAR_WEBHOOK_EVENT_UNSUPPORTED", 422);
    const providerEventId = `${connection.id}:${event.eventId}`;
    const existing = await this.#existingEvent(connection.workspaceId, providerEventId);
    if (existing) return { duplicate: true, matched: existing.status !== "unmatched", eventId: existing.id };
    const contactId = await this.#matchContact({
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      contactToken: event.contactToken,
      attendeeEmail: event.attendeeEmail,
      attendeePhone: event.attendeePhone,
    });
    const campaignId = contactId
      ? await this.#latestCampaign(connection.workspaceId, contactId)
      : null;
    const eventId = crypto.randomUUID();
    // The provider occurrence time is the business clock for stage history.
    // Using wall-clock receipt time can reorder a cancellation that happened
    // before a later operator transition when webhooks arrive asynchronously.
    const now = event.occurredAt;
    return this.database.transaction(async (tx) => {
      const [insertedEvent] = await tx.insert(integrationEvents).values({
        id: eventId,
        workspaceId: connection.workspaceId,
        provider: "calendar:calcom",
        providerEventId,
        eventType: event.trigger,
        payload: {
          connectionId: connection.id,
          bookingId: event.bookingId,
          status: event.status,
          startAt: event.startAt.toISOString(),
        },
        status: contactId ? "processed" : "unmatched",
        receivedAt: now,
        processedAt: now,
      }).onConflictDoNothing().returning({ id: integrationEvents.id });
      if (!insertedEvent) {
        const duplicate = await this.#existingEvent(connection.workspaceId, providerEventId);
        return {
          duplicate: true,
          matched: duplicate?.status !== "unmatched",
          eventId: duplicate?.id ?? eventId,
        };
      }
      const [meetingType] = event.eventTypeId
        ? await tx.select().from(calendarMeetingTypes).where(and(eq(calendarMeetingTypes.workspaceId, connection.workspaceId), eq(calendarMeetingTypes.connectionId, connection.id), eq(calendarMeetingTypes.providerEventTypeId, event.eventTypeId))).limit(1)
        : await tx.select().from(calendarMeetingTypes).where(and(eq(calendarMeetingTypes.workspaceId, connection.workspaceId), eq(calendarMeetingTypes.connectionId, connection.id), eq(calendarMeetingTypes.isDefault, true), eq(calendarMeetingTypes.active, true))).limit(1);
      const [providerMatch] = await tx.select().from(calendarBookings).where(and(eq(calendarBookings.workspaceId, connection.workspaceId), eq(calendarBookings.connectionId, connection.id), eq(calendarBookings.providerBookingId, event.bookingId))).limit(1);
      const [rescheduleTarget] = !providerMatch && event.trigger === "BOOKING_RESCHEDULED" && contactId
        ? await tx.select().from(calendarBookings).where(and(eq(calendarBookings.workspaceId, connection.workspaceId), eq(calendarBookings.contactId, contactId), inArray(calendarBookings.status, ["requested", "booked", "rescheduled"]))).orderBy(desc(calendarBookings.updatedAt)).limit(1).for("update")
        : [];
      const target = providerMatch ?? rescheduleTarget;
      const values = { meetingTypeId: meetingType?.id ?? null, contactId, campaignId, status: event.status, attendeeName: event.attendeeName, attendeeEmail: event.attendeeEmail, attendeePhone: event.attendeePhone, attendeeTimeZone: event.attendeeTimeZone, organizerTimeZone: connection.timeZone ?? "Europe/Paris", startAt: event.startAt, endAt: event.endAt, meetingUrl: event.meetingUrl, cancellationReason: event.status === "cancelled" ? event.reason : null, noShowAt: event.status === "no_show" ? now : null, updatedAt: now };
      const [persistedBooking] = target
        ? await tx.update(calendarBookings).set({ ...values, providerBookingId: event.bookingId, rescheduleCount: event.trigger === "BOOKING_RESCHEDULED" ? target.rescheduleCount + 1 : target.rescheduleCount }).where(and(eq(calendarBookings.workspaceId, connection.workspaceId), eq(calendarBookings.id, target.id))).returning()
        : await tx.insert(calendarBookings).values({ id: crypto.randomUUID(), workspaceId: connection.workspaceId, connectionId: connection.id, providerBookingId: event.bookingId, ...values, createdAt: now }).returning();
      if (!persistedBooking) throw new Error("CALENDAR_BOOKING_WRITE_FAILED");
      if (contactId) {
        const opportunity = await upsertOpportunityStage(tx, {
          workspaceId: connection.workspaceId,
          contactId,
          campaignId,
          stage: opportunityStage(event.status),
          nextAction: opportunityNextAction(event.status, event.startAt, event.meetingUrl),
          source: "calendar:calcom",
          reason: event.trigger,
          now,
        });
        await tx.update(calendarBookings).set({ opportunityId: opportunity.id }).where(and(eq(calendarBookings.workspaceId, connection.workspaceId), eq(calendarBookings.id, persistedBooking.id)));
        if (event.status === "requested" || event.status === "booked" || event.status === "no_show") {
          await tx.update(sequenceEnrollments).set({
            status: "suspended",
            suspensionReason: "MEETING_BOOKED",
            suspendedAt: now,
            updatedAt: now,
          }).where(and(
            eq(sequenceEnrollments.workspaceId, connection.workspaceId),
            eq(sequenceEnrollments.contactId, contactId),
            eq(sequenceEnrollments.status, "active"),
          ));
          await tx.update(outreachActions).set({
            status: "cancelled",
            lastErrorCode: "MEETING_BOOKED",
            lastErrorMessage: "Les relances sont arrêtées après la réservation du rendez-vous.",
            updatedAt: now,
          }).where(and(
            eq(outreachActions.workspaceId, connection.workspaceId),
            eq(outreachActions.contactId, contactId),
            eq(outreachActions.status, "scheduled"),
          ));
        }
        await tx.insert(calendarBookingHistory).values({ id: crypto.randomUUID(), workspaceId: connection.workspaceId, bookingId: persistedBooking.id, action: webhookHistoryAction(event.trigger, event.status), idempotencyKey: `webhook:${providerEventId}`, fromStatus: target?.status ?? null, toStatus: event.status, previousProviderBookingId: target?.providerBookingId ?? null, newProviderBookingId: event.bookingId, previousStartAt: target?.startAt ?? null, newStartAt: event.startAt, reason: event.reason ?? event.trigger, actorUserId: null, source: "calendar:calcom", createdAt: now }).onConflictDoNothing();
        await tx.insert(outboxEvents).values({
          workspaceId: connection.workspaceId,
          aggregateType: "CalendarBooking",
          aggregateId: persistedBooking.id,
          eventType: event.trigger === "BOOKING_RESCHEDULED" ? "CalendarMeetingRescheduled" : calendarOutboxEvent(event.status),
          payload: {
            contactId,
            campaignId,
            bookingId: event.bookingId,
            startAt: event.startAt.toISOString(),
            correlationId: `calendar-booking:${persistedBooking.id}`,
          },
          createdAt: now,
        });
      }
      return { duplicate: false, matched: Boolean(contactId), eventId };
    });
  }

  async #existingEvent(workspaceId: string, providerEventId: string) {
    const [event] = await this.database
      .select({ id: integrationEvents.id, status: integrationEvents.status })
      .from(integrationEvents)
      .where(and(
        eq(integrationEvents.workspaceId, workspaceId),
        eq(integrationEvents.provider, "calendar:calcom"),
        eq(integrationEvents.providerEventId, providerEventId),
      ))
      .limit(1);
    return event ?? null;
  }

  async #matchContact(input: {
    workspaceId: string;
    connectionId: string;
    contactToken: string | null;
    attendeeEmail: string | null;
    attendeePhone: string | null;
  }): Promise<string | null> {
    if (input.contactToken) {
      const contactId = verifyCalendarContactToken(
        this.signingKey,
        input.connectionId,
        input.contactToken,
      );
      if (contactId) {
        const [contact] = await this.database
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, contactId)))
          .limit(1);
        if (contact) return contact.id;
      }
    }
    for (const candidate of [
      input.attendeeEmail ? { type: "email" as const, value: input.attendeeEmail } : null,
      input.attendeePhone ? { type: "phone" as const, value: input.attendeePhone } : null,
      input.attendeePhone ? { type: "whatsapp" as const, value: input.attendeePhone } : null,
    ]) {
      if (!candidate) continue;
      const [identity] = await this.database
        .select({ contactId: contactIdentities.contactId })
        .from(contactIdentities)
        .where(and(
          eq(contactIdentities.workspaceId, input.workspaceId),
          eq(contactIdentities.type, candidate.type),
          eq(contactIdentities.normalizedValue, candidate.value),
        ))
        .limit(1);
      if (identity) return identity.contactId;
    }
    return null;
  }

  async #latestCampaign(workspaceId: string, contactId: string): Promise<string | null> {
    const [conversation] = await this.database
      .select({ campaignId: conversations.campaignId })
      .from(conversations)
      .where(and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.contactId, contactId),
      ))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    if (conversation?.campaignId) return conversation.campaignId;
    const [campaignProspect] = await this.database
      .select({ campaignId: campaignProspects.campaignId })
      .from(campaignProspects)
      .where(and(
        eq(campaignProspects.workspaceId, workspaceId),
        eq(campaignProspects.contactId, contactId),
      ))
      .orderBy(desc(campaignProspects.updatedAt))
      .limit(1);
    return campaignProspect?.campaignId ?? null;
  }
}

export class CalendarIntegrationError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function connectionView(row: typeof calendarConnections.$inferSelect): CalendarConnectionView {
  if (row.provider !== "calcom") throw new Error("CALENDAR_PROVIDER_UNSUPPORTED");
  return {
    id: row.id,
    provider: row.provider,
    bookingUrl: row.bookingUrl,
    apiConfigured: Boolean(row.apiKeyCiphertext),
    automationReady: Boolean(row.eventTypeId),
    eventType: row.eventTypeId && row.eventTypeSlug && row.eventTypeTitle
      ? { id: row.eventTypeId, slug: row.eventTypeSlug, title: row.eventTypeTitle }
      : null,
    username: row.username,
    timeZone: row.timeZone,
    webhookRegistered: Boolean(row.webhookId),
    lastVerifiedAt: row.lastVerifiedAt,
    lastErrorCode: row.lastErrorCode,
    status: row.status === "active" ? "active" : "disabled",
    updatedAt: row.updatedAt,
  };
}

function meetingTypeView(row: typeof calendarMeetingTypes.$inferSelect): CalendarMeetingTypeView {
  return { id: row.id, providerEventTypeId: row.providerEventTypeId, slug: row.slug, title: row.title, lengthMinutes: row.lengthMinutes, bookingUrl: row.bookingUrl, timeZone: row.timeZone, isDefault: row.isDefault, active: row.active };
}

function productBookingView(booking: typeof calendarBookings.$inferSelect, meetingType: typeof calendarMeetingTypes.$inferSelect | null, history: readonly (typeof calendarBookingHistory.$inferSelect)[]): CalendarProductBookingView {
  return {
    id: booking.id,
    contactId: booking.contactId,
    campaignId: booking.campaignId,
    opportunityId: booking.opportunityId,
    status: booking.status,
    attendeeName: booking.attendeeName,
    attendeeEmail: booking.attendeeEmail,
    attendeePhone: booking.attendeePhone,
    attendeeTimeZone: booking.attendeeTimeZone ?? "Non renseigné",
    organizerTimeZone: booking.organizerTimeZone ?? meetingType?.timeZone ?? "Europe/Paris",
    startAt: booking.startAt,
    endAt: booking.endAt,
    meetingUrl: booking.meetingUrl,
    cancellationReason: booking.cancellationReason,
    noShowAt: booking.noShowAt,
    rescheduleCount: booking.rescheduleCount,
    meetingType: meetingType ? meetingTypeView(meetingType) : null,
    history: history.map((entry) => ({ id: entry.id, action: entry.action, fromStatus: entry.fromStatus, toStatus: entry.toStatus, previousStartAt: entry.previousStartAt, newStartAt: entry.newStartAt, reason: entry.reason, source: entry.source, createdAt: entry.createdAt })),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

function meetingTypeBookingUrl(fallback: string, username: string | null, slug: string): string {
  if (!username) return fallback;
  return `https://cal.com/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function slotLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function bookingResult(
  booking: typeof calendarBookings.$inferSelect,
  timeZone: string,
): CalendarBookingResult {
  return {
    bookingId: booking.providerBookingId,
    start: booking.startAt.toISOString(),
    end: booking.endAt?.toISOString() ?? booking.startAt.toISOString(),
    meetingUrl: booking.meetingUrl,
    label: slotLabel(booking.startAt.toISOString(), timeZone),
  };
}

function calendarErrorCode(error: unknown): string {
  if (error instanceof CalcomApiError || error instanceof CalendarIntegrationError) return error.code;
  if (error instanceof Error && error.message.startsWith("CALENDAR_")) return error.message;
  return "CALCOM_UNKNOWN_ERROR";
}

function opportunityStage(status: string): OpportunityStage {
  if (status === "cancelled") return "qualified";
  if (status === "no_show") return "meeting_no_show";
  if (status === "completed") return "meeting_completed";
  return status === "requested" ? "meeting_requested" : "meeting_booked";
}

function opportunityNextAction(status: string, startAt: Date, meetingUrl: string | null): string {
  if (status === "cancelled") return "Rendez-vous annulé — proposer automatiquement un nouveau créneau.";
  if (status === "no_show") return "Absent au rendez-vous — déclencher une relance de replanification.";
  if (status === "completed") return "Rendez-vous terminé — préparer le compte-rendu et la prochaine étape commerciale.";
  return `Rendez-vous réservé le ${startAt.toISOString()}${meetingUrl ? ` · ${meetingUrl}` : ""}`;
}

function calendarOutboxEvent(status: string): string {
  if (status === "cancelled") return "CalendarMeetingCancelled";
  if (status === "no_show") return "CalendarMeetingNoShow";
  if (status === "completed") return "CalendarMeetingCompleted";
  return "CalendarMeetingBooked";
}

function webhookHistoryAction(trigger: string, status: string): string {
  if (trigger === "BOOKING_RESCHEDULED") return "rescheduled";
  if (status === "cancelled") return "cancelled";
  if (status === "no_show") return "no_show";
  if (status === "completed") return "completed";
  return "booked";
}
