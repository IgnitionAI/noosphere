import { and, desc, eq, lte } from "drizzle-orm";
import type { InboundReplyDecision } from "@outbound/application/campaigns/inbound-reply-agent";
import type { Database } from "@outbound/infrastructure/database/client";
import { calendarBookings, meetingProposals } from "@outbound/infrastructure/database/schema";
import {
  CalendarIntegrationError,
  type CalendarSchedulingContext,
  type WorkspaceCalendarScheduler,
} from "@outbound/infrastructure/calendar/postgres-calendar-integration";

const OFFER_TTL_MS = 24 * 60 * 60_000;

interface PersistedMeetingSlot {
  readonly position: number;
  readonly start: string;
  readonly end: string | null;
  readonly label: string;
}

export interface MeetingProposalExecutionInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly campaignId: string | null;
  readonly idempotencyKey: string;
  readonly decision: InboundReplyDecision;
  readonly calendar: CalendarSchedulingContext | null;
  readonly bookingUrl: string | null;
  readonly now: Date;
}

/**
 * Owns the durable contract between a conversational choice ("the second slot")
 * and the exact Cal.com slot that was shown to the prospect.
 */
export class PostgresMeetingProposalManager {
  constructor(
    private readonly database: Database,
    private readonly scheduler: WorkspaceCalendarScheduler,
  ) {}

  async prepare(input: {
    workspaceId: string;
    conversationId: string;
    contactId: string;
    campaignId: string | null;
    now: Date;
  }): Promise<CalendarSchedulingContext> {
    await this.#expire(input.workspaceId, input.conversationId, input.now);
    const activeBooking = await this.#activeBooking(
      input.workspaceId,
      input.contactId,
      input.campaignId,
    );
    const active = await this.#active(input.workspaceId, input.conversationId);
    if (active) {
      const slots = persistedSlots(active.slots);
      if (slots.length) {
        return {
          status: "ready",
          bookingUrl: await this.scheduler.resolve({
            workspaceId: input.workspaceId,
            contactId: input.contactId,
          }),
          timeZone: active.timeZone,
          canBook: true,
          slots: slots.map(({ start, end, label }) => ({ start, end, label })),
          ...(activeBooking ? { activeBooking } : {}),
        };
      }
    }
    const calendar = await this.scheduler.schedulingContext({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      now: input.now,
    });
    return activeBooking ? { ...calendar, activeBooking } : calendar;
  }

  async execute(input: MeetingProposalExecutionInput): Promise<InboundReplyDecision> {
    if (input.decision.action !== "booking") return input.decision;
    if (input.decision.calendarAction === "cancel") return this.#cancel(input);
    if (
      input.decision.calendarAction === "reschedule"
      && input.decision.selectedSlotStart
      && input.calendar?.canBook
    ) {
      return this.#reschedule(input, input.decision.selectedSlotStart);
    }
    if (
      input.decision.calendarAction === "book"
      && input.decision.selectedSlotStart
      && input.calendar?.canBook
    ) {
      return this.#book(input, input.decision.selectedSlotStart);
    }
    return this.#offer(input, input.calendar);
  }

  async #cancel(input: MeetingProposalExecutionInput): Promise<InboundReplyDecision> {
    const cancelled = await this.scheduler.cancel({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      reason: "Annulation demandée par le prospect dans la conversation.",
      now: input.now,
    });
    await this.database
      .update(meetingProposals)
      .set({ status: "cancelled", updatedAt: input.now })
      .where(and(
        eq(meetingProposals.workspaceId, input.workspaceId),
        eq(meetingProposals.conversationId, input.conversationId),
        eq(meetingProposals.status, "offered"),
      ));
    return {
      ...input.decision,
      calendarAction: "cancel",
      selectedSlotStart: null,
      replyBody: `C’est bien annulé pour ${cancelled.label}. Si vous le souhaitez, je peux vous proposer d’autres créneaux.`,
      metadata: { ...input.decision.metadata, calendarAction: "cancel" },
    };
  }

  async #reschedule(
    input: MeetingProposalExecutionInput,
    selectedSlotStart: string,
  ): Promise<InboundReplyDecision> {
    const operationKey = `${input.idempotencyKey}:reschedule`;
    const completed = await this.#byIdempotency(input.workspaceId, operationKey);
    if (completed?.status === "rescheduled") {
      const selected = persistedSlots(completed.slots).find(
        (slot) => slot.start === completed.selectedSlotStart?.toISOString(),
      );
      const booking = completed.calendarBookingId
        ? await this.#booking(input.workspaceId, completed.calendarBookingId)
        : null;
      return rescheduleDecision(
        input.decision,
        completed.id,
        selected?.start ?? selectedSlotStart,
        selected?.label ?? "au nouveau créneau",
        booking?.meetingUrl ?? null,
        completed.calendarBookingId,
      );
    }
    let proposal = await this.#active(input.workspaceId, input.conversationId);
    if (!proposal && input.calendar?.slots.length) {
      proposal = await this.#recordOffer(input, input.calendar, `${input.idempotencyKey}:reschedule-selection`);
    }
    const selected = proposal
      ? persistedSlots(proposal.slots).find((slot) => slot.start === selectedSlotStart)
      : null;
    if (!proposal || !selected) {
      const refreshed = await this.scheduler.schedulingContext({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        now: input.now,
      });
      return this.#offer(input, refreshed, `${input.idempotencyKey}:reschedule-invalid`);
    }
    try {
      const booking = await this.scheduler.reschedule({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        start: selected.start,
        reason: "Nouveau créneau choisi par le prospect dans la conversation.",
        now: input.now,
      });
      const persistedBooking = await this.#bookingByProviderId(input.workspaceId, booking.bookingId);
      if (!persistedBooking) throw new Error("CALENDAR_BOOKING_NOT_PERSISTED");
      await this.database.update(meetingProposals).set({
        status: "rescheduled",
        selectedSlotStart: new Date(selected.start),
        calendarBookingId: persistedBooking.id,
        idempotencyKey: operationKey,
        updatedAt: input.now,
      }).where(and(
        eq(meetingProposals.workspaceId, input.workspaceId),
        eq(meetingProposals.id, proposal.id),
        eq(meetingProposals.status, "offered"),
      ));
      return rescheduleDecision(
        input.decision,
        proposal.id,
        selected.start,
        booking.label,
        booking.meetingUrl,
        booking.bookingId,
      );
    } catch (error) {
      if (!(error instanceof CalendarIntegrationError)) throw error;
      const refreshed = await this.scheduler.schedulingContext({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        now: input.now,
      });
      return this.#offer(input, refreshed, `${input.idempotencyKey}:reschedule-unavailable`);
    }
  }

  async #book(
    input: MeetingProposalExecutionInput,
    selectedSlotStart: string,
  ): Promise<InboundReplyDecision> {
    const bookingKey = `${input.idempotencyKey}:book`;
    const completed = await this.#byIdempotency(input.workspaceId, bookingKey);
    if (completed?.status === "booked") {
      const selected = persistedSlots(completed.slots).find(
        (slot) => slot.start === completed.selectedSlotStart?.toISOString(),
      );
      const booking = completed.calendarBookingId
        ? await this.#booking(input.workspaceId, completed.calendarBookingId)
        : null;
      return bookingDecision(input.decision, completed.id, selected?.start ?? selectedSlotStart, selected?.label ?? "au créneau convenu", booking?.meetingUrl ?? null, completed.calendarBookingId);
    }
    let proposal = await this.#active(input.workspaceId, input.conversationId);
    if (!proposal && input.calendar?.slots.length) {
      proposal = await this.#recordOffer(input, input.calendar, `${input.idempotencyKey}:selection`);
    }
    const selected = proposal
      ? persistedSlots(proposal.slots).find((slot) => slot.start === selectedSlotStart)
      : null;
    if (!proposal || !selected) {
      const refreshed = await this.scheduler.schedulingContext({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        now: input.now,
      });
      return this.#offer(
        {
          ...input,
          decision: {
            ...input.decision,
            calendarAction: "propose_slots",
            selectedSlotStart: null,
          },
        },
        refreshed,
        `${input.idempotencyKey}:invalid-selection`,
      );
    }
    try {
      const booking = await this.scheduler.book({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        start: selected.start,
        now: input.now,
      });
      const persistedBooking = await this.#bookingByProviderId(
        input.workspaceId,
        booking.bookingId,
      );
      if (!persistedBooking) throw new Error("CALENDAR_BOOKING_NOT_PERSISTED");
      await this.database
        .update(meetingProposals)
        .set({
          status: "booked",
          selectedSlotStart: new Date(selected.start),
          calendarBookingId: persistedBooking.id,
          idempotencyKey: bookingKey,
          updatedAt: input.now,
        })
        .where(and(
          eq(meetingProposals.workspaceId, input.workspaceId),
          eq(meetingProposals.id, proposal.id),
          eq(meetingProposals.status, "offered"),
        ));
      return bookingDecision(input.decision, proposal.id, selected.start, booking.label, booking.meetingUrl, booking.bookingId);
    } catch (error) {
      if (!(error instanceof CalendarIntegrationError)) throw error;
      const refreshed = await this.scheduler.schedulingContext({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        now: input.now,
      });
      return this.#offer(
        {
          ...input,
          decision: {
            ...input.decision,
            calendarAction: "propose_slots",
            selectedSlotStart: null,
          },
        },
        refreshed,
        `${input.idempotencyKey}:slot-unavailable`,
      );
    }
  }

  async #offer(
    input: MeetingProposalExecutionInput,
    calendar: CalendarSchedulingContext | null,
    idempotencyKey = `${input.idempotencyKey}:offer`,
  ): Promise<InboundReplyDecision> {
    if (calendar?.status === "email_required") {
      return {
        ...input.decision,
        calendarAction: "propose_slots",
        selectedSlotStart: null,
        replyBody: "Avec plaisir. Quelle adresse email professionnelle puis-je utiliser pour confirmer le rendez-vous ?",
      };
    }
    if (calendar?.slots.length) {
      const proposal = await this.#recordOffer(input, calendar, idempotencyKey);
      const slots = persistedSlots(proposal.slots);
      return {
        ...input.decision,
        calendarAction: "propose_slots",
        selectedSlotStart: null,
        replyBody: proposalReply(slots, proposal.timeZone),
        metadata: {
          ...input.decision.metadata,
          calendarAction: "propose_slots",
          meetingProposalId: proposal.id,
        },
      };
    }
    if (input.bookingUrl) {
      const generated = input.decision.replyBody?.trim();
      return {
        ...input.decision,
        calendarAction: "propose_slots",
        selectedSlotStart: null,
        replyBody: generated?.includes(input.bookingUrl)
          ? generated
          : `${generated || "Avec plaisir."}\n\nVous pouvez choisir directement un créneau ici : ${input.bookingUrl}`,
      };
    }
    return {
      ...input.decision,
      calendarAction: "propose_slots",
      selectedSlotStart: null,
      replyBody: input.decision.replyBody?.trim()
        || "Avec plaisir. Je vérifie les prochains créneaux et je reviens vers vous.",
    };
  }

  async #recordOffer(
    input: Pick<MeetingProposalExecutionInput, "workspaceId" | "conversationId" | "contactId" | "campaignId" | "now">,
    calendar: CalendarSchedulingContext,
    idempotencyKey: string,
  ) {
    const [existing] = await this.database
      .select()
      .from(meetingProposals)
      .where(and(
        eq(meetingProposals.workspaceId, input.workspaceId),
        eq(meetingProposals.idempotencyKey, idempotencyKey),
      ))
      .limit(1);
    if (existing) return existing;

    const slots = calendar.slots.slice(0, 3).map((slot, index) => ({
      position: index + 1,
      start: new Date(slot.start).toISOString(),
      end: slot.end ? new Date(slot.end).toISOString() : null,
      label: slot.label,
    }));
    if (!slots.length) throw new Error("MEETING_PROPOSAL_REQUIRES_SLOTS");
    const expiresAt = new Date(input.now.getTime() + OFFER_TTL_MS);
    const id = crypto.randomUUID();
    return this.database.transaction(async (tx) => {
      await tx
        .update(meetingProposals)
        .set({ status: "superseded", updatedAt: input.now })
        .where(and(
          eq(meetingProposals.workspaceId, input.workspaceId),
          eq(meetingProposals.conversationId, input.conversationId),
          eq(meetingProposals.status, "offered"),
        ));
      const [created] = await tx.insert(meetingProposals).values({
        id,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        status: "offered",
        timeZone: calendar.timeZone,
        slots,
        idempotencyKey,
        expiresAt,
        createdAt: input.now,
        updatedAt: input.now,
      }).returning();
      if (!created) throw new Error("MEETING_PROPOSAL_WRITE_FAILED");
      return created;
    });
  }

  async #expire(workspaceId: string, conversationId: string, now: Date): Promise<void> {
    await this.database
      .update(meetingProposals)
      .set({ status: "expired", updatedAt: now })
      .where(and(
        eq(meetingProposals.workspaceId, workspaceId),
        eq(meetingProposals.conversationId, conversationId),
        eq(meetingProposals.status, "offered"),
        lte(meetingProposals.expiresAt, now),
      ));
  }

  async #active(workspaceId: string, conversationId: string) {
    const [proposal] = await this.database
      .select()
      .from(meetingProposals)
      .where(and(
        eq(meetingProposals.workspaceId, workspaceId),
        eq(meetingProposals.conversationId, conversationId),
        eq(meetingProposals.status, "offered"),
      ))
      .orderBy(desc(meetingProposals.createdAt))
      .limit(1);
    return proposal ?? null;
  }

  async #byIdempotency(workspaceId: string, idempotencyKey: string) {
    const [proposal] = await this.database
      .select()
      .from(meetingProposals)
      .where(and(
        eq(meetingProposals.workspaceId, workspaceId),
        eq(meetingProposals.idempotencyKey, idempotencyKey),
      ))
      .limit(1);
    return proposal ?? null;
  }

  async #booking(workspaceId: string, bookingId: string) {
    const [booking] = await this.database
      .select({ meetingUrl: calendarBookings.meetingUrl })
      .from(calendarBookings)
      .where(and(
        eq(calendarBookings.workspaceId, workspaceId),
        eq(calendarBookings.id, bookingId),
      ))
      .limit(1);
    return booking ?? null;
  }

  async #bookingByProviderId(workspaceId: string, providerBookingId: string) {
    const [booking] = await this.database
      .select({ id: calendarBookings.id })
      .from(calendarBookings)
      .where(and(
        eq(calendarBookings.workspaceId, workspaceId),
        eq(calendarBookings.providerBookingId, providerBookingId),
      ))
      .limit(1);
    return booking ?? null;
  }

  async #activeBooking(
    workspaceId: string,
    contactId: string,
    campaignId: string | null,
  ): Promise<CalendarSchedulingContext["activeBooking"]> {
    const predicates = [
      eq(calendarBookings.workspaceId, workspaceId),
      eq(calendarBookings.contactId, contactId),
      eq(calendarBookings.status, "booked"),
    ];
    if (campaignId) predicates.push(eq(calendarBookings.campaignId, campaignId));
    const [booking] = await this.database
      .select({
        providerBookingId: calendarBookings.providerBookingId,
        startAt: calendarBookings.startAt,
      })
      .from(calendarBookings)
      .where(and(...predicates))
      .orderBy(desc(calendarBookings.updatedAt))
      .limit(1);
    if (!booking) return undefined;
    const timeZone = (await this.scheduler.schedulingContext({
      workspaceId,
      contactId,
    })).timeZone;
    return {
      bookingId: booking.providerBookingId,
      start: booking.startAt.toISOString(),
      label: slotLabel(booking.startAt, timeZone),
    };
  }
}

function persistedSlots(value: unknown): readonly PersistedMeetingSlot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const slot = item as Record<string, unknown>;
    if (
      typeof slot.position !== "number"
      || typeof slot.start !== "string"
      || (slot.end !== null && typeof slot.end !== "string")
      || typeof slot.label !== "string"
    ) return [];
    return [{
      position: slot.position,
      start: slot.start,
      end: slot.end as string | null,
      label: slot.label,
    }];
  }).sort((left, right) => left.position - right.position);
}

function proposalReply(slots: readonly PersistedMeetingSlot[], timeZone: string): string {
  const options = slots.map((slot) => `${slot.position}. ${slot.label}`).join("\n");
  return `Avec plaisir. Voici mes prochains créneaux disponibles (${timeZone}) :\n${options}\n\nRépondez simplement avec le numéro ou le créneau qui vous convient.`;
}

function bookingDecision(
  decision: InboundReplyDecision,
  proposalId: string,
  start: string,
  label: string,
  meetingUrl: string | null,
  bookingId: string | null,
): InboundReplyDecision {
  return {
    ...decision,
    calendarAction: "book",
    selectedSlotStart: start,
    replyBody: `Parfait, c’est réservé ${label}. Vous allez recevoir la confirmation par email.${meetingUrl ? ` Lien du rendez-vous : ${meetingUrl}` : ""}`,
    metadata: {
      ...decision.metadata,
      calendarAction: "book",
      meetingProposalId: proposalId,
      ...(bookingId ? { calendarBookingId: bookingId } : {}),
    },
  };
}

function rescheduleDecision(
  decision: InboundReplyDecision,
  proposalId: string,
  start: string,
  label: string,
  meetingUrl: string | null,
  bookingId: string | null,
): InboundReplyDecision {
  return {
    ...decision,
    calendarAction: "reschedule",
    selectedSlotStart: start,
    replyBody: `C’est déplacé ${label}. Vous allez recevoir la nouvelle confirmation par email.${meetingUrl ? ` Lien du rendez-vous : ${meetingUrl}` : ""}`,
    metadata: {
      ...decision.metadata,
      calendarAction: "reschedule",
      meetingProposalId: proposalId,
      ...(bookingId ? { calendarBookingId: bookingId } : {}),
    },
  };
}

function slotLabel(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
