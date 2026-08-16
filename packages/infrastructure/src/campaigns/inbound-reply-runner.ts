import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  INBOUND_REPLY_SEND_JOB_TYPE,
} from "@outbound/application/campaigns/autonomous-prospecting";
import type { InboundReplyAgent } from "@outbound/application/campaigns/inbound-reply-agent";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import { resolveCampaignAutopilotPolicy } from "@outbound/domain/campaigns/campaign-autopilot-policy";
import { normalizeEmail, normalizePhone } from "@outbound/domain/crm/normalization";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  CalendarIntegrationError,
  type CalendarSchedulingContext,
  type WorkspaceCalendarScheduler,
} from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { PostgresMeetingProposalManager } from "@outbound/infrastructure/calendar/meeting-proposal-manager";
import {
  automatedReplies,
  approvalItems,
  campaignProspects,
  campaigns,
  contactIdentities,
  contactSuppressions,
  contacts,
  conversations,
  icpVersions,
  integrationEvents,
  jobs,
  messages,
  outreachActions,
  prospectDecisions,
  prospectDiscoveryCandidates,
  replyClassifications,
  campaignEnrollments,
} from "@outbound/infrastructure/database/schema";
import { upsertOpportunityStage } from "@outbound/infrastructure/pipeline/opportunity-stage-writer";

export class InboundReplyJobProcessor {
  private readonly meetingProposals: PostgresMeetingProposalManager | undefined;

  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
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
    const payload = eventPayload(job.payload);
    const event = await this.#event(payload);
    if (!event || ["processed", "ignored", "unmatched"].includes(event.status)) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    try {
      const incoming = normalizeInboundWebhook(event.payload);
      if (!incoming) {
        await this.#finishEvent(payload, "ignored");
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
        return;
      }
      if (!incoming.inbound) {
        await this.#persistHumanOutboundOrIgnore({ ...payload, outgoing: incoming });
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
        return;
      }
      const matched = await this.#matchContact({
        workspaceId: payload.workspaceId,
        incoming,
      });
      if (!matched) {
        await this.#finishEvent(payload, "unmatched", "INBOUND_CONTACT_UNMATCHED");
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
        return;
      }
      const persisted = await this.#persistAndSuspend({
        ...payload,
        incoming,
        matched,
      });
      if (!persisted.created) {
        const [existingDecision] = await this.database
          .select({ id: replyClassifications.id })
          .from(replyClassifications)
          .where(and(
            eq(replyClassifications.workspaceId, payload.workspaceId),
            eq(replyClassifications.messageId, persisted.messageId),
          ))
          .limit(1);
        if (existingDecision) {
          await this.#finishEvent(payload, "processed");
          await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
          return;
        }
      }
      const history = await this.database
        .select({ direction: messages.direction, body: messages.body })
        .from(messages)
        .where(and(eq(messages.workspaceId, payload.workspaceId), eq(messages.conversationId, persisted.conversationId)))
        .orderBy(asc(messages.createdAt))
        .limit(20);
      const [context] = await this.database
        .select({
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          companyName: prospectDiscoveryCandidates.companyName,
          icpName: icpVersions.name,
          campaignId: campaignProspects.campaignId,
        })
        .from(contacts)
        .leftJoin(
          campaignProspects,
          and(eq(campaignProspects.workspaceId, contacts.workspaceId), eq(campaignProspects.contactId, contacts.id)),
        )
        .leftJoin(
          prospectDiscoveryCandidates,
          and(
            eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
            eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
          ),
        )
        .leftJoin(
          icpVersions,
          eq(icpVersions.id, sql`(select icp_version_id from campaigns where id = ${campaignProspects.campaignId} limit 1)`),
        )
        .where(and(eq(contacts.workspaceId, payload.workspaceId), eq(contacts.id, matched.contactId)))
        .limit(1);
      const campaignId = matched.campaignId ?? context?.campaignId ?? null;
      const replyPolicy = await this.#replyPolicy({
        workspaceId: payload.workspaceId,
        campaignId,
        channel: incoming.channel,
      });
      let calendar = await this.#calendarContext({
        workspaceId: payload.workspaceId,
        conversationId: persisted.conversationId,
        contactId: matched.contactId,
        campaignId,
      });
      if (calendar?.status === "email_required") {
        const capturedEmail = extractEmailAddress(incoming.body);
        if (capturedEmail) {
          await this.#captureContactEmail(payload.workspaceId, matched.contactId, capturedEmail);
          calendar = await this.#calendarContext({
            workspaceId: payload.workspaceId,
            conversationId: persisted.conversationId,
            contactId: matched.contactId,
            campaignId,
          });
        }
      }
      const bookingUrl = replyPolicy.bookingUrl
        ?? calendar?.bookingUrl
        ?? await this.bookingLinks?.resolve({
          workspaceId: payload.workspaceId,
          contactId: matched.contactId,
        })
        ?? this.bookingUrl;
      const decision = classifyPriorityInbound(event.payload, incoming, this.clock.now()) ?? await this.agent.decide({
        workspaceId: payload.workspaceId,
        channel: incoming.channel,
        contactName: context ? `${context.firstName} ${context.lastName}` : "Contact",
        companyName: context?.companyName ?? null,
        icpName: context?.icpName ?? null,
        incomingMessage: incoming.body,
        conversationHistory: history.map((item) => ({
          direction: item.direction === "outbound" ? "outbound" as const : "inbound" as const,
          body: item.body,
        })),
        instructions: replyPolicy.replyInstructions,
        bookingUrl,
        ...(calendar ? { calendar } : {}),
      });
      const effectiveDecision = await this.#executeCalendarDecision({
        workspaceId: payload.workspaceId,
        conversationId: persisted.conversationId,
        contactId: matched.contactId,
        campaignId,
        idempotencyKey: persisted.messageId,
        decision,
        calendar: calendar ?? null,
        bookingUrl,
      });
      await this.#persistDecision({
        ...payload,
        incoming,
        messageId: persisted.messageId,
        conversationId: persisted.conversationId,
        contactId: matched.contactId,
        campaignId,
        decision: effectiveDecision,
        bookingUrl,
        autoReplyEnabled: campaignId !== null && replyPolicy.autoReplyEnabled,
        replyDelayMinutes: replyPolicy.replyDelayMinutes,
        autonomous: replyPolicy.autonomous,
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 30_000 * job.attempts),
        errorCode: "INBOUND_REPLY_PROCESS_FAILED",
        errorMessage: message,
      });
      if (outcome === "dead_lettered") {
        await this.#finishEvent(payload, "failed", "INBOUND_REPLY_PROCESS_FAILED", message);
      }
    }
  }

  async #executeCalendarDecision(input: {
    workspaceId: string;
    conversationId: string;
    contactId: string;
    campaignId: string | null;
    idempotencyKey: string;
    decision: Awaited<ReturnType<InboundReplyAgent["decide"]>>;
    calendar: CalendarSchedulingContext | null;
    bookingUrl: string | null;
  }): Promise<Awaited<ReturnType<InboundReplyAgent["decide"]>>> {
    if (this.meetingProposals) {
      return this.meetingProposals.execute({
        ...input,
        now: this.clock.now(),
      });
    }
    if (input.decision.action !== "booking") return input.decision;
    if (
      input.decision.calendarAction === "book"
      && input.decision.selectedSlotStart
      && input.calendar?.canBook
      && this.bookingLinks
    ) {
      try {
        const booking = await this.bookingLinks.book({
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          campaignId: input.campaignId,
          start: input.decision.selectedSlotStart,
          now: this.clock.now(),
        });
        return {
          ...input.decision,
          replyBody: `Parfait, c’est réservé ${booking.label}. Vous allez recevoir la confirmation par email.${booking.meetingUrl ? ` Lien du rendez-vous : ${booking.meetingUrl}` : ""}`,
          metadata: {
            ...input.decision.metadata,
            calendarAction: "book",
            calendarBookingId: booking.bookingId,
          },
        };
      } catch (error) {
        if (!(error instanceof CalendarIntegrationError)) throw error;
        const refreshed = await this.bookingLinks.schedulingContext({
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          now: this.clock.now(),
        });
        return {
          ...input.decision,
          calendarAction: "propose_slots",
          selectedSlotStart: null,
          replyBody: slotFallbackReply(refreshed, input.bookingUrl),
          metadata: { ...input.decision.metadata, calendarAction: "propose_slots" },
        };
      }
    }
    return {
      ...input.decision,
      calendarAction: input.calendar?.slots.length
        ? "propose_slots"
        : (input.decision.calendarAction ?? null),
      selectedSlotStart: null,
      replyBody: ensureSlotProposal(input.decision.replyBody, input.calendar, input.bookingUrl),
      metadata: {
        ...input.decision.metadata,
        ...(input.calendar?.slots.length ? { calendarAction: "propose_slots" as const } : {}),
      },
    };
  }

  async #calendarContext(input: {
    workspaceId: string;
    conversationId: string;
    contactId: string;
    campaignId: string | null;
  }): Promise<CalendarSchedulingContext | undefined> {
    if (this.meetingProposals) {
      return this.meetingProposals.prepare({ ...input, now: this.clock.now() });
    }
    return this.bookingLinks?.schedulingContext({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      now: this.clock.now(),
    });
  }

  async #captureContactEmail(workspaceId: string, contactId: string, email: string): Promise<void> {
    await this.database.insert(contactIdentities).values({
      id: crypto.randomUUID(),
      workspaceId,
      contactId,
      type: "email",
      value: email,
      normalizedValue: email,
      verificationStatus: "unknown",
      source: "provider",
      createdAt: this.clock.now(),
      updatedAt: this.clock.now(),
    }).onConflictDoNothing();
  }

  async #event(input: { workspaceId: string; integrationEventId: string }) {
    const [row] = await this.database
      .select()
      .from(integrationEvents)
      .where(and(eq(integrationEvents.workspaceId, input.workspaceId), eq(integrationEvents.id, input.integrationEventId)))
      .limit(1);
    return row ?? null;
  }

  async #matchContact(input: { workspaceId: string; incoming: NormalizedInbound }) {
    const [conversation] = await this.database
      .select({ contactId: conversations.contactId, campaignId: conversations.campaignId })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, input.workspaceId),
          eq(conversations.providerAccountId, input.incoming.accountId),
          eq(conversations.providerThreadId, input.incoming.threadId),
        ),
      )
      .limit(1);
    if (conversation) return conversation;
    const normalizedIdentity = normalizeSenderIdentity(input.incoming);
    if (normalizedIdentity) {
      const [identity] = await this.database
        .select({ contactId: contactIdentities.contactId })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.workspaceId, input.workspaceId),
            eq(contactIdentities.normalizedValue, normalizedIdentity),
          ),
        )
        .limit(1);
      if (identity) return { contactId: identity.contactId, campaignId: null };
    }
    if (input.incoming.senderProviderId) {
      const [candidate] = await this.database
        .select({ contactId: campaignProspects.contactId, campaignId: campaignProspects.campaignId })
        .from(campaignProspects)
        .innerJoin(
          prospectDiscoveryCandidates,
          and(
            eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
            eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
          ),
        )
        .where(
          and(
            eq(campaignProspects.workspaceId, input.workspaceId),
            sql`${prospectDiscoveryCandidates.providerData}->>'providerId' = ${input.incoming.senderProviderId}`,
          ),
        )
        .limit(1);
      if (candidate?.contactId) return { contactId: candidate.contactId, campaignId: candidate.campaignId };
    }
    return null;
  }

  async #persistAndSuspend(input: {
    workspaceId: string;
    integrationEventId: string;
    incoming: NormalizedInbound;
    matched: { contactId: string; campaignId: string | null };
  }) {
    const now = this.clock.now();
    return this.database.transaction(async (tx) => {
      const conversationId = crypto.randomUUID();
      const [insertedConversation] = await tx.insert(conversations).values({
        id: conversationId,
        workspaceId: input.workspaceId,
        contactId: input.matched.contactId,
        campaignId: input.matched.campaignId,
        provider: "unipile",
        providerAccountId: input.incoming.accountId,
        providerThreadId: input.incoming.threadId,
        channel: input.incoming.channel,
        status: "open",
        lastMessageAt: input.incoming.occurredAt,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [conversations.workspaceId, conversations.providerAccountId, conversations.providerThreadId],
        set: { lastMessageAt: input.incoming.occurredAt, updatedAt: now },
      }).returning({ id: conversations.id });
      const persistedConversationId = insertedConversation!.id;
      const messageId = crypto.randomUUID();
      const [insertedMessage] = await tx.insert(messages).values({
        id: messageId,
        workspaceId: input.workspaceId,
        conversationId: persistedConversationId,
        providerMessageId: input.incoming.messageId,
        direction: "inbound",
        senderType: "prospect",
        body: input.incoming.body,
        receivedAt: input.incoming.occurredAt,
        createdAt: now,
      }).onConflictDoNothing().returning({ id: messages.id });
      const [existingMessage] = insertedMessage ? [] : await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(
          eq(messages.workspaceId, input.workspaceId),
          eq(messages.providerMessageId, input.incoming.messageId),
        ))
        .limit(1);
      const persistedMessageId = insertedMessage?.id ?? existingMessage?.id;
      if (!persistedMessageId) throw new Error("INBOUND_MESSAGE_PERSIST_FAILED");
      await tx
        .update(campaignEnrollments)
        .set({ status: "cancelled", completedAt: now })
        .where(
          and(
            eq(campaignEnrollments.workspaceId, input.workspaceId),
            eq(campaignEnrollments.contactId, input.matched.contactId),
            eq(campaignEnrollments.status, "active"),
          ),
        );
      await tx
        .update(outreachActions)
        .set({ status: "cancelled", lastErrorCode: "PROSPECT_REPLIED", updatedAt: now })
        .where(
          and(
            eq(outreachActions.workspaceId, input.workspaceId),
            eq(outreachActions.contactId, input.matched.contactId),
            inArray(outreachActions.status, ["scheduled", "awaiting_approval", "executing"]),
          ),
        );
      return {
        created: Boolean(insertedMessage),
        messageId: persistedMessageId,
        conversationId: persistedConversationId,
      };
    });
  }

  async #persistHumanOutboundOrIgnore(input: {
    workspaceId: string;
    integrationEventId: string;
    outgoing: NormalizedInbound;
  }) {
    const [conversation] = await this.database
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(
        eq(conversations.workspaceId, input.workspaceId),
        eq(conversations.providerAccountId, input.outgoing.accountId),
        eq(conversations.providerThreadId, input.outgoing.threadId),
      ))
      .limit(1);
    if (!conversation) {
      await this.#finishEvent(input, "ignored");
      return;
    }
    const [knownMessage, knownOutreach, knownReply] = await Promise.all([
      this.database.select({ id: messages.id }).from(messages).where(and(
        eq(messages.workspaceId, input.workspaceId),
        eq(messages.providerMessageId, input.outgoing.messageId),
      )).limit(1),
      this.database.select({ id: outreachActions.id }).from(outreachActions).where(and(
        eq(outreachActions.workspaceId, input.workspaceId),
        eq(outreachActions.providerRequestId, input.outgoing.messageId),
      )).limit(1),
      this.database.select({ id: automatedReplies.id }).from(automatedReplies).where(and(
        eq(automatedReplies.workspaceId, input.workspaceId),
        eq(automatedReplies.providerRequestId, input.outgoing.messageId),
      )).limit(1),
    ]);
    if (knownMessage.length || knownOutreach.length || knownReply.length) {
      await this.#finishEvent(input, "processed");
      return;
    }
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.insert(messages).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        providerMessageId: input.outgoing.messageId,
        direction: "outbound",
        senderType: "human",
        body: input.outgoing.body,
        sentAt: input.outgoing.occurredAt,
        createdAt: now,
      }).onConflictDoNothing();
      await tx
        .update(automatedReplies)
        .set({
          status: "cancelled",
          errorCode: "HUMAN_ACTIVITY_DETECTED",
          errorMessage: "Une personne a répondu dans le thread avant l’envoi automatique.",
          updatedAt: now,
        })
        .where(and(
          eq(automatedReplies.workspaceId, input.workspaceId),
          eq(automatedReplies.conversationId, conversation.id),
          inArray(automatedReplies.status, ["scheduled", "sending"]),
        ));
      await tx
        .update(conversations)
        .set({ lastMessageAt: input.outgoing.occurredAt, updatedAt: now })
        .where(and(eq(conversations.workspaceId, input.workspaceId), eq(conversations.id, conversation.id)));
      await tx
        .update(integrationEvents)
        .set({ status: "processed", processedAt: now, errorCode: null, errorMessage: null })
        .where(and(
          eq(integrationEvents.workspaceId, input.workspaceId),
          eq(integrationEvents.id, input.integrationEventId),
        ));
    });
  }

  async #replyPolicy(input: {
    workspaceId: string;
    campaignId: string | null;
    channel: ProspectingChannel;
  }) {
    if (!input.campaignId) {
      const defaults = resolveCampaignAutopilotPolicy(null, input.channel);
      return {
        ...(input.channel === "email" ? defaults.email : { ...defaults.email, replyDelayMinutes: 0 }),
        autonomous: false,
      };
    }
    const [campaign] = await this.database
      .select({ autopilotPolicy: campaigns.autopilotPolicy, channel: campaigns.channel })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)))
      .limit(1);
    const policy = resolveCampaignAutopilotPolicy(campaign?.autopilotPolicy, input.channel);
    return {
      ...(input.channel === "email" ? policy.email : { ...policy.email, replyDelayMinutes: 0 }),
      autonomous: policy.executionMode === "live",
    };
  }

  async #persistDecision(input: {
    workspaceId: string;
    integrationEventId: string;
    incoming: NormalizedInbound;
    messageId: string;
    conversationId: string;
    contactId: string;
    campaignId: string | null;
    decision: Awaited<ReturnType<InboundReplyAgent["decide"]>>;
    bookingUrl: string | null;
    autoReplyEnabled: boolean;
    replyDelayMinutes: number;
    autonomous: boolean;
  }) {
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.insert(replyClassifications).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        messageId: input.messageId,
        intent: input.decision.intent,
        confidence: String(input.decision.confidence),
        action: input.decision.action,
        rationale: input.decision.rationale,
        metadata: input.decision.metadata,
        createdAt: now,
      }).onConflictDoNothing();
      if (input.decision.action === "wait") {
        const resumeAt = input.decision.resumeAt ? new Date(input.decision.resumeAt) : new Date(now.getTime() + 30 * 86_400_000);
        if (Number.isNaN(resumeAt.getTime()) || resumeAt <= now) throw new Error("INBOUND_RESUME_DATE_INVALID");
        const [resumeAction] = input.campaignId
          ? await tx
            .select({ id: outreachActions.id, enrollmentId: outreachActions.enrollmentId })
            .from(outreachActions)
            .where(and(
              eq(outreachActions.workspaceId, input.workspaceId),
              eq(outreachActions.campaignId, input.campaignId),
              eq(outreachActions.contactId, input.contactId),
              eq(outreachActions.status, "cancelled"),
              eq(outreachActions.lastErrorCode, "PROSPECT_REPLIED"),
            ))
            .orderBy(asc(outreachActions.dueAt))
            .limit(1)
          : [];
        if (resumeAction) {
          await tx.update(campaignEnrollments).set({ status: "active", completedAt: null }).where(and(
            eq(campaignEnrollments.workspaceId, input.workspaceId),
            eq(campaignEnrollments.campaignId, input.campaignId!),
            eq(campaignEnrollments.id, resumeAction.enrollmentId),
          ));
          await tx.update(outreachActions).set({
            status: "scheduled",
            dueAt: resumeAt,
            cancelledAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: now,
          }).where(and(
            eq(outreachActions.workspaceId, input.workspaceId),
            eq(outreachActions.campaignId, input.campaignId!),
            eq(outreachActions.id, resumeAction.id),
          ));
          const decisionId = crypto.randomUUID();
          const decisionJobId = crypto.randomUUID();
          const idempotencyKey = `${input.messageId}:resume:v1`;
          await tx.insert(jobs).values({
            id: decisionJobId,
            workspaceId: input.workspaceId,
            type: "prospect.decision.execute",
            payload: { workspaceId: input.workspaceId, decisionId },
            idempotencyKey: `${idempotencyKey}:execute`,
            correlationId: `conversation:${input.conversationId}`,
            maxAttempts: 5,
            priority: 80,
            availableAt: resumeAt,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing();
          await tx.insert(prospectDecisions).values({
            id: decisionId,
            workspaceId: input.workspaceId,
            contactId: input.contactId,
            campaignId: input.campaignId,
            outreachActionId: resumeAction.id,
            jobId: decisionJobId,
            kind: input.decision.intent === "out_of_office" ? "out_of_office_return" : "not_now_recheck",
            reason: input.decision.suggestedNextAction ?? input.decision.rationale,
            observation: { intent: input.decision.intent, evidence: input.decision.evidence ?? [] },
            dueAt: resumeAt,
            priority: 80,
            maxAttempts: 5,
            idempotencyKey,
            correlationId: `conversation:${input.conversationId}`,
            payload: { inboundMessageId: input.messageId },
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing();
        }
      }
      if (input.decision.action === "stop") {
        await tx.insert(contactSuppressions).values({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          channel: input.decision.intent === "unsubscribe" ? "global" : input.incoming.channel,
          reason: `Réponse classée ${input.decision.intent}`,
          createdAt: now,
        }).onConflictDoNothing();
        if (input.decision.intent === "bounce" && input.incoming.channel === "email") {
          await tx.update(contactIdentities).set({ verificationStatus: "invalid", updatedAt: now }).where(and(
            eq(contactIdentities.workspaceId, input.workspaceId),
            eq(contactIdentities.contactId, input.contactId),
            eq(contactIdentities.type, "email"),
          ));
        }
      } else if (input.autoReplyEnabled) {
        if (["wait", "handoff"].includes(input.decision.action)) {
          // These decisions intentionally create no automatic reply. The
          // persisted decision or operator handoff is the next action.
        } else {
        if (!input.decision.replyBody) throw new Error("AUTOMATED_REPLY_BODY_MISSING");
        const replyId = crypto.randomUUID();
        const [inserted] = await tx.insert(automatedReplies).values({
          id: replyId,
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          inboundMessageId: input.messageId,
          providerAccountId: input.incoming.accountId,
          channel: input.incoming.channel,
          body: input.decision.replyBody,
          status: "scheduled",
          idempotencyKey: `${input.messageId}:auto-reply:v1`,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing().returning({ id: automatedReplies.id });
        if (inserted) {
          await tx.insert(jobs).values({
            id: crypto.randomUUID(),
            workspaceId: input.workspaceId,
            type: INBOUND_REPLY_SEND_JOB_TYPE,
            payload: { workspaceId: input.workspaceId, replyId },
            idempotencyKey: `${replyId}:send:v1`,
            correlationId: `conversation:${input.conversationId}`,
            maxAttempts: 3,
            availableAt: new Date(now.getTime() + input.replyDelayMinutes * 60_000),
            createdAt: now,
            updatedAt: now,
          });
        }
        }
      }
      // Positive replies and meeting requests are handled by the setter and
      // calendar flow automatically. Autonomous campaigns also keep
      // ambiguous handoffs out of the approval queue; the inbound classifier
      // and campaign cancellation remain the safety boundary.
      if (!input.autonomous && (input.decision.requiresHuman || input.decision.action === "handoff")) {
        await tx.insert(approvalItems).values({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          campaignId: input.campaignId,
          contactId: input.contactId,
          itemType: "inbound_handoff",
          channel: input.incoming.channel,
          contentOriginal: {
            intent: input.decision.intent,
            reason: input.decision.rationale,
            suggestedNextAction: input.decision.suggestedNextAction ?? null,
          },
          context: { conversationId: input.conversationId, messageId: input.messageId },
          sourceUpdatedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (input.decision.action === "booking" && !input.decision.metadata.calendarBookingId) {
        const nextAction = input.bookingUrl
          ? `Le lien de réservation ${input.bookingUrl} a été envoyé automatiquement.`
          : "Proposer automatiquement un créneau de rendez-vous.";
        await upsertOpportunityStage(tx, {
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          campaignId: input.campaignId,
          stage: "meeting_requested",
          nextAction,
          source: "setter",
          reason: "Le Setter a qualifié une demande de rendez-vous.",
          now,
        });
      }
      await tx
        .update(integrationEvents)
        .set({ status: "processed", processedAt: now, errorCode: null, errorMessage: null })
        .where(and(eq(integrationEvents.workspaceId, input.workspaceId), eq(integrationEvents.id, input.integrationEventId)));
    });
  }

  async #finishEvent(
    input: { workspaceId: string; integrationEventId: string },
    status: string,
    errorCode?: string,
    errorMessage?: string,
  ) {
    await this.database
      .update(integrationEvents)
      .set({
        status,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage?.slice(0, 4_000) ?? null,
        processedAt: this.clock.now(),
      })
      .where(and(eq(integrationEvents.workspaceId, input.workspaceId), eq(integrationEvents.id, input.integrationEventId)));
  }
}

export interface NormalizedInbound {
  readonly accountId: string;
  readonly channel: ProspectingChannel;
  readonly threadId: string;
  readonly messageId: string;
  readonly body: string;
  readonly senderValue: string | null;
  readonly senderProviderId: string | null;
  readonly occurredAt: Date;
  readonly inbound: boolean;
}

export function normalizeInboundWebhook(payload: unknown): NormalizedInbound | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  const accountId = firstString(data, [["account_id"], ["accountId"]]);
  const eventType = firstString(data, [["event"]])?.toLowerCase();
  const accountType = firstString(data, [["account_type"], ["account_info", "type"], ["provider"]])?.toUpperCase();
  const channel: ProspectingChannel = accountType === "LINKEDIN"
    ? "linkedin"
    : accountType === "WHATSAPP"
      ? "whatsapp"
      : "email";
  const providerEventId = firstString(data, [["webhook_id"], ["event_id"], ["id"]]);
  const providerBounce = Boolean(eventType && (eventType.includes("bounce") || eventType.includes("delivery_failed")));
  const threadId = firstString(data, [
    ["chat_id"],
    ["thread_id"],
    ["message", "chat_id"],
    ["email", "thread_id"],
    ["in_reply_to", "id"],
    ["provider_id"],
    ["email_id"],
  ]) ?? (providerBounce ? providerEventId : null);
  const messageId = firstString(data, [["message_id"], ["email_id"], ["id"], ["message", "id"], ["email", "id"], ["data", "id"]]);
  const body = firstString(data, [["text"], ["message"], ["body_plain"], ["body"], ["message", "text"], ["message", "body"], ["email", "body"], ["subject"], ["error", "message"]])
    ?? (providerBounce ? eventType : null);
  if (!accountId || !threadId || !messageId || !body) return null;
  const senderProviderId = firstString(data, [["sender", "attendee_provider_id"], ["sender", "provider_id"], ["from", "provider_id"]]);
  const senderValue = firstString(data, [["from_attendee", "identifier"], ["sender", "identifier"], ["from", "identifier"], ["sender", "phone"], ["sender", "email"]]);
  const accountUserId = firstString(data, [["account_info", "user_id"]]);
  const direction = firstString(data, [["direction"]])?.toLowerCase();
  const inbound = eventType === "mail_sent"
    ? false
    : direction
      ? direction !== "outbound" && direction !== "sent"
      : !accountUserId || senderProviderId !== accountUserId;
  const rawDate = firstString(data, [["timestamp"], ["received_at"], ["date"]]);
  const occurredAt = rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate) : new Date();
  return { accountId, channel, threadId, messageId, body, senderValue, senderProviderId, occurredAt, inbound };
}

export function classifyPriorityInbound(
  payload: unknown,
  incoming: NormalizedInbound,
  now: Date,
): Awaited<ReturnType<InboundReplyAgent["decide"]>> | null {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const event = firstString(record, [["event"], ["type"]])?.toLowerCase() ?? "";
  const subject = firstString(record, [["subject"], ["email", "subject"]]) ?? "";
  const content = `${subject}\n${incoming.body}`.trim();
  const lower = content.toLocaleLowerCase("fr");
  const base = {
    confidence: 1,
    evidence: [event || "message_body"],
    referredPerson: null,
    requiresHuman: false,
    suggestedNextAction: null,
    calendarAction: null,
    selectedSlotStart: null,
    replyBody: null,
    metadata: { provider: "deterministic", model: "rules", promptVersion: "inbound-priority-rules-v1" },
  } as const;

  if (event.includes("bounce") || event.includes("delivery_failed") || /\b(mail delivery subsystem|undeliverable|delivery status notification|adresse introuvable)\b/i.test(content)) {
    return {
      ...base,
      intent: "bounce",
      action: "stop",
      rationale: "Le provider ou le contenu identifie un échec permanent de livraison.",
      suggestedNextAction: "Invalider cette adresse email et arrêter ses relances.",
    };
  }
  if (/\b(unsubscribe|désabonnez|désinscri(?:re|vez)|ne (?:me|nous) contactez plus|stop emailing)\b/i.test(content)) {
    return {
      ...base,
      intent: "unsubscribe",
      action: "stop",
      rationale: "Le prospect demande explicitement de ne plus être contacté.",
      suggestedNextAction: "Créer une suppression globale immédiate.",
    };
  }
  const outOfOffice = /\b(out of office|automatic reply|réponse automatique|absent(?:e)? du bureau|en congé|de retour le)\b/i.test(content);
  if (outOfOffice) {
    const resumeAt = extractResumeAt(content, now) ?? new Date(now.getTime() + 7 * 86_400_000);
    return {
      ...base,
      intent: /automatic reply|réponse automatique/i.test(content) && !/absent|congé|out of office|de retour/i.test(content)
        ? "auto_reply"
        : "out_of_office",
      action: "wait",
      resumeAt: resumeAt.toISOString(),
      rationale: "Une réponse automatique d’absence suspend les relances jusqu’au retour.",
      suggestedNextAction: `Réexaminer le prospect après ${resumeAt.toISOString()}.`,
    };
  }
  if (/\b(pas (?:le bon|la bonne) (?:personne|interlocuteur)|wrong person|not the right person)\b/i.test(content)) {
    return {
      ...base,
      intent: "wrong_person",
      action: "handoff",
      rationale: "Le destinataire indique qu’il n’est pas le bon interlocuteur.",
      requiresHuman: true,
      suggestedNextAction: "Identifier le bon décideur à partir de cette réponse sans recontacter la mauvaise personne.",
    };
  }
  if (/\b(contactez|contacter|voyez avec|parlez à|reach out to)\b/i.test(content) && /@|linkedin|collègue|responsable|directeur|directrice/i.test(content)) {
    return {
      ...base,
      intent: "referral",
      action: "handoff",
      rationale: "La réponse contient une orientation explicite vers un autre interlocuteur.",
      referredPerson: content.slice(0, 300),
      requiresHuman: true,
      suggestedNextAction: "Vérifier la personne recommandée et conserver cette réponse comme provenance.",
    };
  }
  if (/\b(pas maintenant|plus tard|recontactez[- ]moi|revenez vers moi|not now|circle back|next quarter|prochain trimestre)\b/i.test(content)) {
    const resumeAt = extractResumeAt(content, now) ?? new Date(now.getTime() + 30 * 86_400_000);
    return {
      ...base,
      intent: "not_now",
      action: "wait",
      resumeAt: resumeAt.toISOString(),
      rationale: "Le prospect demande explicitement un contact ultérieur.",
      suggestedNextAction: `Réexaminer le prospect à la date demandée : ${resumeAt.toISOString()}.`,
    };
  }
  return null;
}

function extractResumeAt(content: string, now: Date): Date | null {
  const iso = content.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) {
    const parsed = new Date(`${iso}T09:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed > now) return parsed;
  }
  const day = content.match(/\b(?:le\s+)?(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (day) {
    const parsed = new Date(Date.UTC(Number(day[3]), Number(day[2]) - 1, Number(day[1]), 9));
    if (!Number.isNaN(parsed.getTime()) && parsed > now) return parsed;
  }
  const days = content.match(/\b(?:dans|in)\s+(\d{1,3})\s+(?:jours?|days?)\b/i)?.[1];
  if (days) return new Date(now.getTime() + Number(days) * 86_400_000);
  return null;
}

function normalizeSenderIdentity(incoming: NormalizedInbound): string | null {
  if (!incoming.senderValue) return null;
  try {
    return incoming.channel === "email"
      ? normalizeEmail(incoming.senderValue)
      : incoming.channel === "whatsapp"
        ? normalizePhone(incoming.senderValue)
        : null;
  } catch {
    return null;
  }
}

function firstString(data: Record<string, unknown>, paths: readonly (readonly string[])[]): string | null {
  for (const path of paths) {
    let value: unknown = data;
    for (const key of path) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        value = null;
        break;
      }
      value = (value as Record<string, unknown>)[key];
    }
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function eventPayload(value: unknown): { workspaceId: string; integrationEventId: string } {
  if (!value || typeof value !== "object") throw new Error("INVALID_INBOUND_REPLY_JOB");
  const payload = value as Record<string, unknown>;
  if (typeof payload.workspaceId !== "string" || typeof payload.integrationEventId !== "string") {
    throw new Error("INVALID_INBOUND_REPLY_JOB");
  }
  return { workspaceId: payload.workspaceId, integrationEventId: payload.integrationEventId };
}

function extractEmailAddress(body: string): string | null {
  if (body.length > 2_000) return null;
  const candidate = body.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
  if (!candidate) return null;
  try {
    return normalizeEmail(candidate);
  } catch {
    return null;
  }
}

function slotFallbackReply(
  calendar: CalendarSchedulingContext,
  bookingUrl: string | null,
): string {
  return ensureSlotProposal(null, calendar, bookingUrl);
}

function ensureSlotProposal(
  generated: string | null,
  calendar: CalendarSchedulingContext | null,
  bookingUrl: string | null,
): string {
  if (calendar?.status === "email_required") {
    return "Avec plaisir. Quelle adresse email professionnelle puis-je utiliser pour confirmer le rendez-vous ?";
  }
  if (calendar?.slots.length) {
    const options = calendar.slots
      .slice(0, 3)
      .map((slot) => `• ${slot.label}`)
      .join("\n");
    return `Avec plaisir. Voici mes prochains créneaux disponibles (${calendar.timeZone}) :\n${options}\n\nLequel vous convient le mieux ?`;
  }
  if (bookingUrl) {
    if (generated?.includes(bookingUrl)) return generated;
    return `${generated?.trim() || "Avec plaisir."}\n\nVous pouvez choisir directement un créneau ici : ${bookingUrl}`;
  }
  return generated?.trim() || "Avec plaisir. Je vérifie les prochains créneaux et je reviens vers vous.";
}
