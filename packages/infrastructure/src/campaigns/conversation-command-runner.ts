import { and, desc, eq, inArray } from "drizzle-orm";
import type { InboundReplyAgent } from "@outbound/application/campaigns/inbound-reply-agent";
import type { OutboundChannelGateway } from "@outbound/application/campaigns/outbound-channel-gateway";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import {
  requireProspectMemoryAllowedProviders,
  type ProspectContextAssembler,
  type ProspectMemoryPolicyReader,
} from "@outbound/application/prospect-memory/prospect-memory";
import type { ProspectMemoryShadowComparator } from "@outbound/application/prospect-memory/prospect-memory-shadow-comparator";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import { resolveCampaignAutopilotPolicy } from "@outbound/domain/campaigns/campaign-autopilot-policy";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  CalendarIntegrationError,
  type CalendarSchedulingContext,
  type WorkspaceCalendarScheduler,
} from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { PostgresMeetingProposalManager } from "@outbound/infrastructure/calendar/meeting-proposal-manager";
import { captureProspectMemoryMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-memory-mutation";
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
    private readonly prospectContextAssembler?: ProspectContextAssembler,
    private readonly prospectMemoryShadowComparator?: ProspectMemoryShadowComparator,
    private readonly prospectMemoryPolicies?: ProspectMemoryPolicyReader,
  ) {
    this.meetingProposals = bookingLinks
      ? new PostgresMeetingProposalManager(database, bookingLinks)
      : undefined;
  }

  async process(job: LeasedJob): Promise<void> {
    const payload = commandPayload(job.payload);
    const command = await this.#load(payload);
    if (!command || ["sent", "generated", "failed", "cancelled"].includes(command.status)) {
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
    if (automaticSending && command.executionMode === "live") {
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
      if (command.executionMode === "live") {
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
      }
      const generation = command.mode === "manual"
        ? { body: requiredBody(command.requestedBody), metadata: {} }
        : await this.#generateSetterReply(command, command.executionMode === "dry_run");
      const body = generation.body;
      if (command.executionMode === "dry_run") {
        const now = this.clock.now();
        await this.database.transaction(async (tx) => {
          await tx
            .update(conversationCommands)
            .set({
              generatedBody: body,
              generationMetadata: generation.metadata,
              status: "generated",
              providerRequestId: null,
              sentAt: null,
              errorCode: null,
              errorMessage: null,
              updatedAt: now,
            })
            .where(and(
              eq(conversationCommands.workspaceId, payload.workspaceId),
              eq(conversationCommands.id, payload.commandId),
            ));
          await tx.insert(outboxEvents).values({
            workspaceId: payload.workspaceId,
            aggregateType: "Conversation",
            aggregateId: command.conversationId,
            eventType: "SetterReplyGeneratedDryRun",
            payload: {
              conversationId: command.conversationId,
              commandId: payload.commandId,
              aiRunId: generation.metadata.aiRunId ?? null,
              memoryReceiptId: generation.metadata.memoryReceiptId ?? null,
              sentEffect: false,
            },
            createdAt: now,
          });
        });
        await this.queue.acknowledge(job.id, job.lockedBy, now);
        return;
      }
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
        const messageId = crypto.randomUUID();
        await tx
          .update(conversationCommands)
          .set({
            generatedBody: command.mode === "setter" ? body : null,
            generationMetadata: generation.metadata,
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
        const [insertedMessage] = await tx.insert(messages).values({
          id: messageId,
          workspaceId: payload.workspaceId,
          conversationId: command.conversationId,
          providerMessageId: result.providerRequestId,
          direction: "outbound",
          senderType: command.mode === "setter" ? "ai" : "human",
          body,
          sentAt: now,
          createdAt: now,
        }).onConflictDoNothing().returning({ id: messages.id });
        if (insertedMessage) await captureProspectMemoryMutation(tx, {
          workspaceId: payload.workspaceId,
          sourceContactId: command.contactId,
          sourceKind: "message",
          sourceId: insertedMessage.id,
          sourceVersion: 1,
          kind: "message_sent",
          occurredAt: now,
          observedAt: now,
          payload: {
            conversationId: command.conversationId,
            channel: command.channel,
            direction: "outbound",
            senderType: command.mode === "setter" ? "ai" : "human",
          },
          correlationId: job.correlationId,
        });
        await tx
          .update(conversations)
          .set({
            ...(command.mode === "manual" ? { automationMode: "human" as const } : {}),
            lastMessageAt: now,
            updatedAt: now,
          })
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

  async #generateSetterReply(
    command: LoadedConversationCommand,
    dryRun: boolean,
  ): Promise<GeneratedSetterReply> {
    let prospectContext: Readonly<Record<string, unknown>> | undefined;
    let prospectContextReference: Parameters<InboundReplyAgent["decide"]>[0]["prospectContextReference"];
    let prospectContextAllowedProviders: Parameters<InboundReplyAgent["decide"]>[0]["prospectContextAllowedProviders"];
    let shadowContext: Awaited<ReturnType<ProspectContextAssembler["assemble"]>> | null = null;
    if (this.prospectContextAssembler) {
      try {
        const bundle = await this.prospectContextAssembler.assemble({
          workspaceId: command.workspaceId,
          contactId: command.contactId,
          capability: "setter_campaign",
          principalRole: "worker",
          requestKey: `setter-context:${command.idempotencyKey}`,
          now: this.clock.now(),
        });
        if (bundle.mode === "active") {
          if (!bundle.automaticActionAllowed) {
            throw new SetterStoppedConversationError(
              bundle.waitCode ?? "WAIT_MEMORY_STALE",
              "La mémoire Prospect 360 doit être actualisée avant un envoi automatique.",
            );
          }
          prospectContext = bundle.context;
          prospectContextReference = contextReference(bundle);
          if (!this.prospectMemoryPolicies) throw new Error("PROSPECT_MEMORY_POLICY_READER_REQUIRED");
          prospectContextAllowedProviders = await requireProspectMemoryAllowedProviders({
            policies: this.prospectMemoryPolicies,
            workspaceId: command.workspaceId,
            capability: "setter_campaign",
          });
        } else if (dryRun) {
          if (bundle.waitCode) {
            throw new SetterStoppedConversationError(
              bundle.waitCode,
              "La mémoire Prospect 360 doit être actualisée avant le dry-run.",
            );
          }
          prospectContext = bundle.context;
          prospectContextReference = contextReference(bundle);
          if (!this.prospectMemoryPolicies) throw new Error("PROSPECT_MEMORY_POLICY_READER_REQUIRED");
          prospectContextAllowedProviders = await requireProspectMemoryAllowedProviders({
            policies: this.prospectMemoryPolicies,
            workspaceId: command.workspaceId,
            capability: "setter_campaign",
          });
          shadowContext = bundle;
        } else {
          shadowContext = bundle;
        }
      } catch (error) {
        if (error instanceof SetterStoppedConversationError) throw error;
        if (!isMemoryDisabled(error)) throw error;
        // Capture/shadow is opt-in. A disabled workspace must retain the legacy
        // behavior exactly until its controlled rollout starts.
      }
    }
    const recentHistory = await this.database
      .select({ id: messages.id, direction: messages.direction, body: messages.body })
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, command.workspaceId),
          eq(messages.conversationId, command.conversationId),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(30);
    const history = [...recentHistory].reverse();
    if (shadowContext && this.prospectMemoryShadowComparator) {
      await this.prospectMemoryShadowComparator.compare({
        workspaceId: command.workspaceId,
        contactId: command.contactId,
        requestKey: `setter-shadow:${command.idempotencyKey}`,
        legacyHistory: history.map((message) => ({
          direction: message.direction === "outbound" ? "outbound" as const : "inbound" as const,
          body: message.body,
          sourceId: message.id,
        })),
        memory: shadowContext,
        comparedAt: this.clock.now(),
      });
    }
    const latestInbound = [...history].reverse().find((message) => message.direction === "inbound");
    if (!latestInbound) {
      throw new SetterStoppedConversationError(
        "SETTER_REQUIRES_INBOUND_MESSAGE",
        "Le Setter ne peut pas inventer une réponse sans message entrant.",
      );
    }
    const policy = resolveCampaignAutopilotPolicy(command.autopilotPolicy, command.channel);
    const calendar = dryRun
      ? await this.bookingLinks?.schedulingContext({
          workspaceId: command.workspaceId,
          contactId: command.contactId,
          now: this.clock.now(),
        })
      : this.meetingProposals
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
      ...(prospectContext ? { prospectContext } : {}),
      ...(prospectContextReference ? { prospectContextReference } : {}),
      ...(prospectContextAllowedProviders ? { prospectContextAllowedProviders } : {}),
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
    if (dryRun) {
      if (!decision.replyBody) {
        throw new SetterStoppedConversationError(
          "SETTER_DRY_RUN_DID_NOT_GENERATE_REPLY",
          decision.rationale,
        );
      }
      if (decision.action === "booking" && calendar) {
        return generatedSetterReply(
          commandCalendarFallback(calendar, bookingUrl, decision.replyBody),
          decision,
        );
      }
      return generatedSetterReply(decision.replyBody, decision);
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
      return generatedSetterReply(effective.replyBody, decision);
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
        return generatedSetterReply(
          `Parfait, c’est réservé ${booking.label}. Vous allez recevoir la confirmation par email.${booking.meetingUrl ? ` Lien du rendez-vous : ${booking.meetingUrl}` : ""}`,
          decision,
        );
      } catch (error) {
        if (!(error instanceof CalendarIntegrationError)) throw error;
        const refreshed = await this.bookingLinks.schedulingContext({
          workspaceId: command.workspaceId,
          contactId: command.contactId,
          now: this.clock.now(),
        });
        return generatedSetterReply(commandCalendarFallback(refreshed, bookingUrl), decision);
      }
    }
    if (decision.action === "booking" && calendar) {
      return generatedSetterReply(
        commandCalendarFallback(calendar, bookingUrl, decision.replyBody),
        decision,
      );
    }
    return generatedSetterReply(decision.replyBody, decision);
  }

  async #load(input: { workspaceId: string; commandId: string }) {
    const [row] = await this.database
      .select({
        id: conversationCommands.id,
        workspaceId: conversationCommands.workspaceId,
        mode: conversationCommands.mode,
        executionMode: conversationCommands.executionMode,
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
      executionMode: row.executionMode === "dry_run" ? "dry_run" as const : "live" as const,
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

function contextReference(bundle: Awaited<ReturnType<ProspectContextAssembler["assemble"]>>) {
  return {
    receiptId: bundle.receiptId,
    snapshotId: bundle.snapshotId,
    snapshotVersion: bundle.snapshotVersion,
    watermark: bundle.watermark,
    privacyEpoch: bundle.privacyEpoch,
    mode: bundle.mode,
  } as const;
}

function isMemoryDisabled(error: unknown): boolean {
  return error instanceof Error && [
    "PROSPECT_MEMORY_CAPABILITY_DISABLED",
    "PROSPECT_MEMORY_CONTACT_UNAVAILABLE",
  ].includes(error.message);
}

type LoadedConversationCommand = {
  id: string;
  workspaceId: string;
  mode: "manual" | "setter";
  executionMode: "live" | "dry_run";
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

type GeneratedSetterReply = {
  readonly body: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

function generatedSetterReply(
  body: string,
  decision: Awaited<ReturnType<InboundReplyAgent["decide"]>>,
): GeneratedSetterReply {
  return {
    body,
    metadata: {
      ...decision.metadata,
      intent: decision.intent,
      action: decision.action,
      calendarAction: decision.calendarAction ?? null,
    },
  };
}

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
