import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { InboundReplyAgent } from "@outbound/application/campaigns/inbound-reply-agent";
import type { OutboundChannelGateway } from "@outbound/application/campaigns/outbound-channel-gateway";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import { resolveCampaignAutopilotPolicy } from "@outbound/domain/campaigns/campaign-autopilot-policy";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  CalendarIntegrationError,
  type CalendarSchedulingContext,
  type WorkspaceCalendarScheduler,
} from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { PostgresMeetingProposalManager } from "@outbound/infrastructure/calendar/meeting-proposal-manager";
import {
  automatedReplies,
  campaignProspects,
  campaigns,
  contactIdentities,
  contacts,
  conversationCommands,
  conversations,
  icpVersions,
  messages,
  outboxEvents,
  prospectDiscoveryCandidates,
} from "@outbound/infrastructure/database/schema";

export class ConversationCommandJobProcessor {
  private readonly meetingProposals: PostgresMeetingProposalManager | undefined;

  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly gateway: OutboundChannelGateway,
    private readonly agent: InboundReplyAgent,
    private readonly clock: Clock,
    private readonly bookingUrl: string | null,
    private readonly bookingLinks?: WorkspaceCalendarScheduler,
  ) {
    this.meetingProposals = bookingLinks
      ? new PostgresMeetingProposalManager(database, bookingLinks)
      : undefined;
  }

  async process(job: LeasedJob): Promise<void> {
    const payload = commandPayload(job.payload);
    const command = await this.#load(payload);
    if (!command || ["sent", "failed", "cancelled"].includes(command.status)) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    if (command.status === "sending") {
      await this.#fail(payload, "CONVERSATION_COMMAND_DELIVERY_UNKNOWN", "Une exécution précédente a perdu son lease pendant l’envoi.");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    const [automaticSending] = await this.database
      .select({ id: automatedReplies.id })
      .from(automatedReplies)
      .where(
        and(
          eq(automatedReplies.workspaceId, payload.workspaceId),
          eq(automatedReplies.conversationId, command.conversationId),
          eq(automatedReplies.status, "sending"),
        ),
      )
      .limit(1);
    if (automaticSending) {
      await this.#fail(payload, "AUTOMATED_REPLY_IN_FLIGHT", "Une réponse automatique est déjà en cours d’envoi.");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    const [claimed] = await this.database
      .update(conversationCommands)
      .set({ status: "sending", updatedAt: this.clock.now() })
      .where(
        and(
          eq(conversationCommands.workspaceId, payload.workspaceId),
          eq(conversationCommands.id, payload.commandId),
          eq(conversationCommands.status, "scheduled"),
        ),
      )
      .returning({ id: conversationCommands.id });
    if (!claimed) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    try {
      await this.database
        .update(automatedReplies)
        .set({
          status: "cancelled",
          errorCode: "USER_COMMAND_TAKES_PRECEDENCE",
          errorMessage: "Une commande manuelle ou explicite du Setter remplace cette réponse.",
          updatedAt: this.clock.now(),
        })
        .where(
          and(
            eq(automatedReplies.workspaceId, payload.workspaceId),
            eq(automatedReplies.conversationId, command.conversationId),
            eq(automatedReplies.status, "scheduled"),
          ),
        );
      const body = command.mode === "manual"
        ? requiredBody(command.requestedBody)
        : await this.#generateSetterReply(command);
      const result = await this.gateway.send({
        accountId: command.providerAccountId,
        channel: command.channel,
        stepKind: command.channel === "email"
          ? "email"
          : command.channel === "whatsapp"
            ? "whatsapp"
            : "linkedin_message",
        recipient: {
          value: command.identityValue ?? command.contactName,
          normalizedValue: command.identityNormalized ?? command.contactName,
          providerUserId: null,
        },
        subject: command.channel === "email" ? "Re: votre message" : null,
        body,
        idempotencyKey: command.idempotencyKey,
        conversationId: command.providerThreadId,
        replyToProviderMessageId: command.latestInboundProviderMessageId,
      });
      const now = this.clock.now();
      await this.database.transaction(async (tx) => {
        await tx
          .update(conversationCommands)
          .set({
            generatedBody: command.mode === "setter" ? body : null,
            status: "sent",
            providerRequestId: result.providerRequestId,
            sentAt: now,
            errorCode: null,
            errorMessage: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(conversationCommands.workspaceId, payload.workspaceId),
              eq(conversationCommands.id, payload.commandId),
            ),
          );
        await tx.insert(messages).values({
          id: crypto.randomUUID(),
          workspaceId: payload.workspaceId,
          conversationId: command.conversationId,
          providerMessageId: result.providerRequestId,
          direction: "outbound",
          senderType: command.mode === "setter" ? "ai" : "human",
          body,
          sentAt: now,
          createdAt: now,
        }).onConflictDoNothing();
        await tx
          .update(conversations)
          .set({ lastMessageAt: now, updatedAt: now })
          .where(
            and(
              eq(conversations.workspaceId, payload.workspaceId),
              eq(conversations.id, command.conversationId),
            ),
          );
        await tx.insert(outboxEvents).values({
          workspaceId: payload.workspaceId,
          aggregateType: "Conversation",
          aggregateId: command.conversationId,
          eventType: command.mode === "setter"
            ? "SetterReplySentOnDemand"
            : "ManualConversationMessageSent",
          payload: { conversationId: command.conversationId, commandId: payload.commandId },
          createdAt: now,
        });
      });
      await this.queue.acknowledge(job.id, job.lockedBy, now);
    } catch (error) {
      if (error instanceof SetterStoppedConversationError) {
        await this.#cancel(payload, error.code, error.message);
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
        return;
      }
      if (error instanceof OutboundDeliveryError && error.deliveryState === "not_sent" && error.retryable) {
        await this.database
          .update(conversationCommands)
          .set({ status: "scheduled", errorCode: error.code, errorMessage: error.message, updatedAt: this.clock.now() })
          .where(and(eq(conversationCommands.workspaceId, payload.workspaceId), eq(conversationCommands.id, payload.commandId)));
        await this.queue.retry({
          jobId: job.id,
          workerId: job.lockedBy,
          availableAt: new Date(this.clock.now().getTime() + 60_000 * job.attempts),
          errorCode: error.code,
          errorMessage: error.message,
        });
        return;
      }
      await this.#fail(
        payload,
        error instanceof OutboundDeliveryError ? error.code : "CONVERSATION_COMMAND_FAILED",
        error instanceof Error ? error.message : String(error),
      );
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    }
  }

  async #generateSetterReply(command: LoadedConversationCommand) {
    const history = await this.database
      .select({ direction: messages.direction, body: messages.body })
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, command.workspaceId),
          eq(messages.conversationId, command.conversationId),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(30);
    const latestInbound = [...history].reverse().find((message) => message.direction === "inbound");
    if (!latestInbound) {
      throw new SetterStoppedConversationError(
        "SETTER_REQUIRES_INBOUND_MESSAGE",
        "Le Setter ne peut pas inventer une réponse sans message entrant.",
      );
    }
    const policy = resolveCampaignAutopilotPolicy(command.autopilotPolicy, command.channel);
    const calendar = this.meetingProposals
      ? await this.meetingProposals.prepare({
          workspaceId: command.workspaceId,
          conversationId: command.conversationId,
          contactId: command.contactId,
          campaignId: command.campaignId,
          now: this.clock.now(),
        })
      : await this.bookingLinks?.schedulingContext({
          workspaceId: command.workspaceId,
          contactId: command.contactId,
          now: this.clock.now(),
        });
    const bookingUrl = policy.email.bookingUrl
      ?? calendar?.bookingUrl
      ?? await this.bookingLinks?.resolve({
        workspaceId: command.workspaceId,
        contactId: command.contactId,
      })
      ?? this.bookingUrl;
    const decision = await this.agent.decide({
      workspaceId: command.workspaceId,
      channel: command.channel,
      contactName: command.contactName,
      companyName: command.companyName,
      icpName: command.icpName,
      incomingMessage: latestInbound.body,
      conversationHistory: history.map((message) => ({
        direction: message.direction === "outbound" ? "outbound" as const : "inbound" as const,
        body: message.body,
      })),
      instructions: policy.email.replyInstructions,
      bookingUrl,
      ...(calendar ? { calendar } : {}),
    });
    if (decision.action === "stop") {
      throw new SetterStoppedConversationError(
        "SETTER_DECIDED_NOT_TO_REPLY",
        decision.rationale,
      );
    }
    if (this.meetingProposals) {
      const effective = await this.meetingProposals.execute({
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        contactId: command.contactId,
        campaignId: command.campaignId,
        idempotencyKey: command.idempotencyKey,
        decision,
        calendar: calendar ?? null,
        bookingUrl,
        now: this.clock.now(),
      });
      if (!effective.replyBody) {
        throw new SetterStoppedConversationError(
          "SETTER_DECIDED_NOT_TO_REPLY",
          effective.rationale,
        );
      }
      return effective.replyBody;
    }
    if (!decision.replyBody) {
      throw new SetterStoppedConversationError(
        "SETTER_DECIDED_NOT_TO_REPLY",
        decision.rationale,
      );
    }
    if (
      decision.action === "booking"
      && decision.calendarAction === "book"
      && decision.selectedSlotStart
      && calendar?.canBook
      && this.bookingLinks
    ) {
      try {
        const booking = await this.bookingLinks.book({
          workspaceId: command.workspaceId,
          contactId: command.contactId,
          campaignId: command.campaignId,
          start: decision.selectedSlotStart,
          now: this.clock.now(),
        });
        return `Parfait, c’est réservé ${booking.label}. Vous allez recevoir la confirmation par email.${booking.meetingUrl ? ` Lien du rendez-vous : ${booking.meetingUrl}` : ""}`;
      } catch (error) {
        if (!(error instanceof CalendarIntegrationError)) throw error;
        const refreshed = await this.bookingLinks.schedulingContext({
          workspaceId: command.workspaceId,
          contactId: command.contactId,
          now: this.clock.now(),
        });
        return commandCalendarFallback(refreshed, bookingUrl);
      }
    }
    if (decision.action === "booking" && calendar) {
      return commandCalendarFallback(calendar, bookingUrl, decision.replyBody);
    }
    return decision.replyBody;
  }

  async #load(input: { workspaceId: string; commandId: string }) {
    const [row] = await this.database
      .select({
        id: conversationCommands.id,
        workspaceId: conversationCommands.workspaceId,
        mode: conversationCommands.mode,
        requestedBody: conversationCommands.requestedBody,
        status: conversationCommands.status,
        idempotencyKey: conversationCommands.idempotencyKey,
        conversationId: conversations.id,
        providerAccountId: conversations.providerAccountId,
        providerThreadId: conversations.providerThreadId,
        channel: conversations.channel,
        contactId: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        campaignId: conversations.campaignId,
        autopilotPolicy: campaigns.autopilotPolicy,
        icpName: icpVersions.name,
        companyName: prospectDiscoveryCandidates.companyName,
      })
      .from(conversationCommands)
      .innerJoin(
        conversations,
        and(
          eq(conversations.workspaceId, conversationCommands.workspaceId),
          eq(conversations.id, conversationCommands.conversationId),
        ),
      )
      .innerJoin(
        contacts,
        and(eq(contacts.workspaceId, conversations.workspaceId), eq(contacts.id, conversations.contactId)),
      )
      .leftJoin(
        campaigns,
        and(eq(campaigns.workspaceId, conversations.workspaceId), eq(campaigns.id, conversations.campaignId)),
      )
      .leftJoin(
        icpVersions,
        and(eq(icpVersions.workspaceId, campaigns.workspaceId), eq(icpVersions.id, campaigns.icpVersionId)),
      )
      .leftJoin(
        campaignProspects,
        and(
          eq(campaignProspects.workspaceId, conversations.workspaceId),
          eq(campaignProspects.campaignId, conversations.campaignId),
          eq(campaignProspects.contactId, conversations.contactId),
        ),
      )
      .leftJoin(
        prospectDiscoveryCandidates,
        and(
          eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
          eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
        ),
      )
      .where(
        and(
          eq(conversationCommands.workspaceId, input.workspaceId),
          eq(conversationCommands.id, input.commandId),
        ),
      )
      .limit(1);
    if (!row) return null;
    const [identity, latestInbound] = await Promise.all([
      this.database
        .select({ value: contactIdentities.value, normalizedValue: contactIdentities.normalizedValue })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.workspaceId, input.workspaceId),
            eq(contactIdentities.contactId, row.contactId),
            eq(contactIdentities.type, row.channel === "whatsapp" ? "whatsapp" : row.channel),
          ),
        )
        .limit(1),
      this.database
        .select({ providerMessageId: messages.providerMessageId })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, input.workspaceId),
            eq(messages.conversationId, row.conversationId),
            eq(messages.direction, "inbound"),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(1),
    ]);
    return {
      ...row,
      mode: row.mode === "setter" ? "setter" as const : "manual" as const,
      contactName: `${row.firstName} ${row.lastName}`,
      identityValue: identity[0]?.value ?? null,
      identityNormalized: identity[0]?.normalizedValue ?? null,
      latestInboundProviderMessageId: latestInbound[0]?.providerMessageId ?? null,
    };
  }

  async #fail(input: { workspaceId: string; commandId: string }, code: string, message: string) {
    await this.database
      .update(conversationCommands)
      .set({ status: "failed", errorCode: code, errorMessage: message.slice(0, 4_000), updatedAt: this.clock.now() })
      .where(and(eq(conversationCommands.workspaceId, input.workspaceId), eq(conversationCommands.id, input.commandId)));
  }

  async #cancel(input: { workspaceId: string; commandId: string }, code: string, message: string) {
    await this.database
      .update(conversationCommands)
      .set({ status: "cancelled", errorCode: code, errorMessage: message.slice(0, 4_000), updatedAt: this.clock.now() })
      .where(and(eq(conversationCommands.workspaceId, input.workspaceId), eq(conversationCommands.id, input.commandId)));
  }
}

type LoadedConversationCommand = {
  id: string;
  workspaceId: string;
  mode: "manual" | "setter";
  requestedBody: string | null;
  status: string;
  idempotencyKey: string;
  conversationId: string;
  providerAccountId: string;
  providerThreadId: string;
  channel: ProspectingChannel;
  contactId: string;
  firstName: string;
  lastName: string;
  campaignId: string | null;
  autopilotPolicy: unknown;
  icpName: string | null;
  companyName: string | null;
  contactName: string;
  identityValue: string | null;
  identityNormalized: string | null;
  latestInboundProviderMessageId: string | null;
};

class SetterStoppedConversationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function requiredBody(value: string | null): string {
  const body = value?.trim();
  if (!body) throw new Error("MANUAL_MESSAGE_BODY_REQUIRED");
  return body;
}

function commandCalendarFallback(
  calendar: CalendarSchedulingContext,
  bookingUrl: string | null,
  generated?: string | null,
): string {
  if (calendar.status === "email_required") {
    return "Avec plaisir. Quelle adresse email professionnelle puis-je utiliser pour confirmer le rendez-vous ?";
  }
  if (calendar.slots.length) {
    const slots = calendar.slots.slice(0, 3).map((slot) => `• ${slot.label}`).join("\n");
    return `Avec plaisir. Voici mes prochains créneaux disponibles (${calendar.timeZone}) :\n${slots}\n\nLequel vous convient le mieux ?`;
  }
  if (bookingUrl) {
    if (generated?.includes(bookingUrl)) return generated;
    return `${generated?.trim() || "Avec plaisir."}\n\nVous pouvez choisir directement un créneau ici : ${bookingUrl}`;
  }
  return generated?.trim() || "Avec plaisir. Je vérifie les prochains créneaux et je reviens vers vous.";
}

function commandPayload(value: unknown): { workspaceId: string; commandId: string } {
  if (!value || typeof value !== "object") throw new Error("INVALID_CONVERSATION_COMMAND_JOB");
  const payload = value as Record<string, unknown>;
  if (typeof payload.workspaceId !== "string" || typeof payload.commandId !== "string") {
    throw new Error("INVALID_CONVERSATION_COMMAND_JOB");
  }
  return { workspaceId: payload.workspaceId, commandId: payload.commandId };
}
