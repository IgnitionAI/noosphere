import { and, desc, eq, inArray } from "drizzle-orm";
import type { OpportunityStage } from "@outbound/domain/pipeline/opportunity";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  calendarBookings,
  calendarConnections,
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
    start: string;
    now?: Date;
  }): Promise<CalendarBookingResult>;
  reschedule(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    start: string;
    reason: string;
    now?: Date;
  }): Promise<CalendarBookingResult>;
  cancel(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    reason: string;
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
    const timeZone = connection?.timeZone ?? "Europe/Paris";
    const bookingUrl = await this.resolve(input);
    if (!connection?.eventTypeId) {
      return { status: "link_only", bookingUrl, timeZone, canBook: false, slots: [] };
    }
    const attendee = await this.#attendee(input.workspaceId, input.contactId);
    if (!attendee?.email) {
      return { status: "email_required", bookingUrl, timeZone, canBook: false, slots: [] };
    }
    const now = input.now ?? new Date();
    try {
      const apiKey = connection.apiKeyCiphertext
        ? decryptCalendarCredential(connection.apiKeyCiphertext, this.signingKey)
        : null;
      const slots = await this.calcom.listSlots({
        apiKey,
        eventTypeId: connection.eventTypeId,
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
      };
    } catch (error) {
      await this.#recordError(connection.id, calendarErrorCode(error));
      return { status: "unavailable", bookingUrl, timeZone, canBook: false, slots: [] };
    }
  }

  async book(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
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
    const dayStart = new Date(requestedStart.getTime() - 12 * 60 * 60_000);
    const dayEnd = new Date(requestedStart.getTime() + 36 * 60 * 60_000);
    const available = await this.calcom.listSlots({
      apiKey,
      eventTypeId: connection.eventTypeId,
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
        eventTypeId: connection.eventTypeId,
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
      providerBookingId: created.uid,
      contactId: input.contactId,
      campaignId: input.campaignId,
      status: "booked",
      attendeeName: attendee.name,
      attendeeEmail: attendee.email,
      attendeePhone: attendee.phone,
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
    start: string;
    reason: string;
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
    const alreadyMoved = await this.#existingBooking(
      input.workspaceId,
      input.contactId,
      requestedStart,
    );
    if (alreadyMoved) return bookingResult(alreadyMoved, connection.timeZone ?? "Europe/Paris");
    const current = await this.#latestActiveBooking(
      input.workspaceId,
      input.contactId,
      input.campaignId,
    );
    if (!current) throw new CalendarIntegrationError("CALENDAR_ACTIVE_BOOKING_NOT_FOUND", 404);
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
    let moved;
    try {
      moved = await this.calcom.rescheduleBooking({
        apiKey,
        bookingUid: current.providerBookingId,
        start: requestedStart.toISOString(),
        reason: input.reason,
      });
    } catch (error) {
      await this.#recordError(connection.id, calendarErrorCode(error));
      if (error instanceof CalcomApiError) {
        throw new CalendarIntegrationError(error.code, error.status);
      }
      throw error;
    }
    const now = input.now ?? new Date();
    const persisted = await this.database.transaction(async (tx) => {
      if (moved.uid !== current.providerBookingId) {
        await tx.update(calendarBookings).set({ status: "rescheduled", updatedAt: now }).where(and(
          eq(calendarBookings.workspaceId, input.workspaceId),
          eq(calendarBookings.id, current.id),
        ));
      }
      const [booking] = await tx.insert(calendarBookings).values({
        id: moved.uid === current.providerBookingId ? current.id : crypto.randomUUID(),
        workspaceId: input.workspaceId,
        connectionId: connection.id,
        providerBookingId: moved.uid,
        contactId: input.contactId,
        campaignId: input.campaignId,
        status: "booked",
        attendeeName: current.attendeeName,
        attendeeEmail: current.attendeeEmail,
        attendeePhone: current.attendeePhone,
        startAt: new Date(moved.start),
        endAt: new Date(moved.end),
        meetingUrl: moved.meetingUrl,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [
          calendarBookings.workspaceId,
          calendarBookings.connectionId,
          calendarBookings.providerBookingId,
        ],
        set: {
          status: "booked",
          startAt: new Date(moved.start),
          endAt: new Date(moved.end),
          meetingUrl: moved.meetingUrl,
          updatedAt: now,
        },
      }).returning();
      if (!booking) throw new Error("CALENDAR_BOOKING_WRITE_FAILED");
      return booking;
    });
    await this.#applyBookedState({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      bookingId: persisted.id,
      providerBookingId: persisted.providerBookingId,
      startAt: persisted.startAt,
      meetingUrl: persisted.meetingUrl,
      now,
    });
    return bookingResult(persisted, timeZone);
  }

  async cancel(input: {
    workspaceId: string;
    contactId: string;
    campaignId: string | null;
    reason: string;
    now?: Date;
  }): Promise<CalendarBookingResult> {
    const connection = await this.#rawDefaultConnection(input.workspaceId);
    if (!connection?.apiKeyCiphertext) {
      throw new CalendarIntegrationError("CALENDAR_AUTOMATION_NOT_CONFIGURED", 409);
    }
    const current = await this.#latestActiveBooking(
      input.workspaceId,
      input.contactId,
      input.campaignId,
    );
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
    const apiKey = decryptCalendarCredential(connection.apiKeyCiphertext, this.signingKey);
    try {
      await this.calcom.cancelBooking({
        apiKey,
        bookingUid: current.providerBookingId,
        reason: input.reason,
      });
    } catch (error) {
      await this.#recordError(connection.id, calendarErrorCode(error));
      if (error instanceof CalcomApiError) {
        throw new CalendarIntegrationError(error.code, error.status);
      }
      throw error;
    }
    const now = input.now ?? new Date();
    await this.database.transaction(async (tx) => {
      await tx.update(calendarBookings).set({ status: "cancelled", updatedAt: now }).where(and(
        eq(calendarBookings.workspaceId, input.workspaceId),
        eq(calendarBookings.id, current.id),
      ));
      await upsertOpportunityStage(tx, {
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        stage: "qualified",
        nextAction: "Rendez-vous annulé — proposer automatiquement un nouveau créneau.",
        source: "setter:calcom",
        reason: input.reason,
        now,
      });
      await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "CalendarBooking",
        aggregateId: current.id,
        eventType: "CalendarMeetingCancelled",
        payload: {
          contactId: input.contactId,
          campaignId: input.campaignId,
          bookingId: current.providerBookingId,
          source: "setter:calcom",
        },
        createdAt: now,
      });
    });
    return bookingResult({ ...current, status: "cancelled", updatedAt: now }, connection.timeZone ?? "Europe/Paris");
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
      await upsertOpportunityStage(tx, {
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        stage: "meeting_booked",
        nextAction: opportunityNextAction("booked", input.startAt, input.meetingUrl),
        source: "setter:calcom",
        reason: "Le Setter a réservé le créneau choisi via l’API Cal.com.",
        now: input.now,
      });
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
      await tx.insert(outboxEvents).values({
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
        },
        createdAt: input.now,
      });
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
    const now = new Date();
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
      const [persistedBooking] = await tx.insert(calendarBookings).values({
        id: crypto.randomUUID(),
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        providerBookingId: event.bookingId,
        contactId,
        campaignId,
        status: event.status,
        attendeeName: event.attendeeName,
        attendeeEmail: event.attendeeEmail,
        attendeePhone: event.attendeePhone,
        startAt: event.startAt,
        endAt: event.endAt,
        meetingUrl: event.meetingUrl,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [
          calendarBookings.workspaceId,
          calendarBookings.connectionId,
          calendarBookings.providerBookingId,
        ],
        set: {
          contactId,
          campaignId,
          status: event.status,
          attendeeName: event.attendeeName,
          attendeeEmail: event.attendeeEmail,
          attendeePhone: event.attendeePhone,
          startAt: event.startAt,
          endAt: event.endAt,
          meetingUrl: event.meetingUrl,
          updatedAt: now,
        },
      }).returning({ id: calendarBookings.id });
      if (!persistedBooking) throw new Error("CALENDAR_BOOKING_WRITE_FAILED");
      if (contactId) {
        await upsertOpportunityStage(tx, {
          workspaceId: connection.workspaceId,
          contactId,
          campaignId,
          stage: opportunityStage(event.status),
          nextAction: opportunityNextAction(event.status, event.startAt, event.meetingUrl),
          source: "calendar:calcom",
          reason: event.trigger,
          now,
        });
        if (event.status === "requested" || event.status === "booked") {
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
        await tx.insert(outboxEvents).values({
          workspaceId: connection.workspaceId,
          aggregateType: "CalendarBooking",
          aggregateId: persistedBooking.id,
          eventType: calendarOutboxEvent(event.status),
          payload: {
            contactId,
            campaignId,
            bookingId: event.bookingId,
            startAt: event.startAt.toISOString(),
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
