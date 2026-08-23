import { and, eq, gt } from "drizzle-orm";
import type { OutboundChannelGateway } from "@outbound/application/campaigns/outbound-channel-gateway";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import { captureProspectMemoryMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-memory-mutation";
import {
  automatedReplies,
  contactIdentities,
  contacts,
  conversations,
  messages,
} from "@outbound/infrastructure/database/schema";

export class AutomatedReplySendJobProcessor {
  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly gateway: OutboundChannelGateway,
    private readonly clock: Clock,
  ) {}

  async process(job: LeasedJob): Promise<void> {
    const payload = replyPayload(job.payload);
    const reply = await this.#load(payload);
    if (!reply || ["sent", "failed", "cancelled"].includes(reply.status)) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    if (reply.status === "sending") {
      await this.#fail(payload, "AUTOMATED_REPLY_DELIVERY_UNKNOWN", "Une exécution précédente a perdu son lease pendant l’envoi.");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    const [claimed] = await this.database
      .update(automatedReplies)
      .set({ status: "sending", updatedAt: this.clock.now() })
      .where(
        and(
          eq(automatedReplies.workspaceId, payload.workspaceId),
          eq(automatedReplies.id, payload.replyId),
          eq(automatedReplies.status, "scheduled"),
        ),
      )
      .returning({ id: automatedReplies.id });
    if (!claimed) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    if (await this.#hasHumanActivityAfterInbound(payload.workspaceId, reply)) {
      await this.#cancel(payload, "HUMAN_ACTIVITY_DETECTED", "Une personne a répondu avant l’envoi automatique.");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    try {
      const result = await this.gateway.send({
        accountId: reply.providerAccountId,
        channel: reply.channel,
        stepKind: reply.channel === "email" ? "email" : reply.channel === "whatsapp" ? "whatsapp" : "linkedin_message",
        recipient: {
          value: reply.identityValue ?? reply.contactName,
          normalizedValue: reply.identityNormalized ?? reply.contactName,
          providerUserId: null,
        },
        subject: reply.channel === "email" ? "Re: votre message" : null,
        body: reply.body,
        idempotencyKey: reply.idempotencyKey,
        conversationId: reply.providerThreadId,
        replyToProviderMessageId: reply.inboundProviderMessageId,
      });
      const now = this.clock.now();
      await this.database.transaction(async (tx) => {
        const messageId = crypto.randomUUID();
        await tx
          .update(automatedReplies)
          .set({
            status: "sent",
            providerRequestId: result.providerRequestId,
            sentAt: now,
            errorCode: null,
            errorMessage: null,
            updatedAt: now,
          })
          .where(and(eq(automatedReplies.workspaceId, payload.workspaceId), eq(automatedReplies.id, payload.replyId)));
        const [insertedMessage] = await tx.insert(messages).values({
          id: messageId,
          workspaceId: payload.workspaceId,
          conversationId: reply.conversationId,
          providerMessageId: result.providerRequestId,
          direction: "outbound",
          senderType: "ai",
          body: reply.body,
          sentAt: now,
          createdAt: now,
        }).onConflictDoNothing().returning({ id: messages.id });
        if (insertedMessage) await captureProspectMemoryMutation(tx, {
          workspaceId: payload.workspaceId,
          sourceContactId: reply.contactId,
          sourceKind: "message",
          sourceId: insertedMessage.id,
          sourceVersion: 1,
          kind: "message_sent",
          occurredAt: now,
          observedAt: now,
          payload: {
            conversationId: reply.conversationId,
            channel: reply.channel,
            direction: "outbound",
            senderType: "ai",
          },
          correlationId: job.correlationId,
        });
        await tx
          .update(conversations)
          .set({ lastMessageAt: now, updatedAt: now })
          .where(and(eq(conversations.workspaceId, payload.workspaceId), eq(conversations.id, reply.conversationId)));
      });
      await this.queue.acknowledge(job.id, job.lockedBy, now);
    } catch (error) {
      if (
        error instanceof OutboundDeliveryError &&
        error.deliveryState === "not_sent" &&
        error.retryable
      ) {
        await this.database
          .update(automatedReplies)
          .set({ status: "scheduled", errorCode: error.code, errorMessage: error.message, updatedAt: this.clock.now() })
          .where(and(eq(automatedReplies.workspaceId, payload.workspaceId), eq(automatedReplies.id, payload.replyId)));
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
        error instanceof OutboundDeliveryError ? error.code : "AUTOMATED_REPLY_DELIVERY_UNKNOWN",
        error instanceof Error ? error.message : String(error),
      );
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    }
  }

  async #load(input: { workspaceId: string; replyId: string }) {
    const rows = await this.database
      .select({
        id: automatedReplies.id,
        status: automatedReplies.status,
        body: automatedReplies.body,
        idempotencyKey: automatedReplies.idempotencyKey,
        providerAccountId: automatedReplies.providerAccountId,
        channel: automatedReplies.channel,
        conversationId: conversations.id,
        providerThreadId: conversations.providerThreadId,
        contactId: conversations.contactId,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        inboundProviderMessageId: messages.providerMessageId,
        inboundOccurredAt: messages.receivedAt,
      })
      .from(automatedReplies)
      .innerJoin(
        conversations,
        and(eq(conversations.workspaceId, automatedReplies.workspaceId), eq(conversations.id, automatedReplies.conversationId)),
      )
      .innerJoin(
        contacts,
        and(eq(contacts.workspaceId, conversations.workspaceId), eq(contacts.id, conversations.contactId)),
      )
      .innerJoin(
        messages,
        and(eq(messages.workspaceId, automatedReplies.workspaceId), eq(messages.id, automatedReplies.inboundMessageId)),
      )
      .where(and(eq(automatedReplies.workspaceId, input.workspaceId), eq(automatedReplies.id, input.replyId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const [identity] = await this.database
      .select({ value: contactIdentities.value, normalizedValue: contactIdentities.normalizedValue })
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.workspaceId, input.workspaceId),
          eq(contactIdentities.contactId, row.contactId),
          eq(contactIdentities.type, row.channel === "whatsapp" ? "whatsapp" : row.channel),
        ),
      )
      .limit(1);
    return {
      ...row,
      contactName: `${row.contactFirstName} ${row.contactLastName}`,
      identityValue: identity?.value ?? null,
      identityNormalized: identity?.normalizedValue ?? null,
    };
  }

  async #fail(input: { workspaceId: string; replyId: string }, code: string, message: string) {
    await this.database
      .update(automatedReplies)
      .set({ status: "failed", errorCode: code, errorMessage: message.slice(0, 4_000), updatedAt: this.clock.now() })
      .where(and(eq(automatedReplies.workspaceId, input.workspaceId), eq(automatedReplies.id, input.replyId)));
  }

  async #hasHumanActivityAfterInbound(workspaceId: string, reply: {
    conversationId: string;
    inboundOccurredAt: Date | null;
  }): Promise<boolean> {
    if (!reply.inboundOccurredAt) return false;
    const [activity] = await this.database
      .select({ id: messages.id })
      .from(messages)
      .where(and(
        eq(messages.workspaceId, workspaceId),
        eq(messages.conversationId, reply.conversationId),
        eq(messages.direction, "outbound"),
        eq(messages.senderType, "human"),
        gt(messages.sentAt, reply.inboundOccurredAt),
      ))
      .limit(1);
    return Boolean(activity);
  }

  async #cancel(input: { workspaceId: string; replyId: string }, code: string, message: string) {
    await this.database
      .update(automatedReplies)
      .set({ status: "cancelled", errorCode: code, errorMessage: message.slice(0, 4_000), updatedAt: this.clock.now() })
      .where(and(eq(automatedReplies.workspaceId, input.workspaceId), eq(automatedReplies.id, input.replyId)));
  }
}

function replyPayload(value: unknown): { workspaceId: string; replyId: string } {
  if (!value || typeof value !== "object") throw new Error("INVALID_AUTOMATED_REPLY_SEND_JOB");
  const payload = value as Record<string, unknown>;
  if (typeof payload.workspaceId !== "string" || typeof payload.replyId !== "string") {
    throw new Error("INVALID_AUTOMATED_REPLY_SEND_JOB");
  }
  return { workspaceId: payload.workspaceId, replyId: payload.replyId };
}
