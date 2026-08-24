import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import { normalizeEmail } from "@outbound/domain/crm/normalization";
import type { Database } from "@outbound/infrastructure/database/client";
import { captureProspectMemoryMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-memory-mutation";
import { htmlToText } from "@outbound/infrastructure/inbox/html-to-text";
import {
  automatedReplies,
  connectedAccounts,
  contactIdentities,
  contacts,
  conversations,
  inboxSyncStates,
  messages,
  outreachActions,
  prospectDiscoveryCandidates,
} from "@outbound/infrastructure/database/schema";

const PAGE_SIZE = 250;
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_OVERLAP_MS = 10 * 60_000;
const MAX_MESSAGE_LENGTH = 100_000;

export interface MirroredInboxMessage {
  readonly id: string;
  readonly body: string;
  readonly direction: "inbound" | "outbound";
  readonly occurredAt: Date;
  readonly senderValue: string | null;
  readonly senderProviderId: string | null;
}

export interface MirroredInboxThread {
  readonly threadId: string;
  readonly channel: ProspectingChannel;
  readonly externalIdentity: string;
  readonly identityValue: string;
  readonly contactName: string;
  readonly photoUrl: string | null;
  readonly subject: string | null;
  readonly unreadCount: number;
  readonly updatedAt: Date;
  readonly messages: readonly MirroredInboxMessage[];
}

export interface MirroredInboxPage {
  readonly threads: readonly MirroredInboxThread[];
  readonly nextCursor: string | null;
  readonly highWatermark: Date | null;
}

export async function collectUnipileMessageInboxPage(input: {
  readonly dsn: string;
  readonly apiKey: string;
  readonly accountId: string;
  readonly channel: Extract<ProspectingChannel, "linkedin" | "whatsapp">;
  readonly cursor?: string | null;
  readonly after?: Date | null;
  readonly fetchImpl?: typeof fetch;
}): Promise<MirroredInboxPage> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const page = await readPage({
    dsn: input.dsn,
    apiKey: input.apiKey,
    path: "/api/v1/messages",
    query: {
      account_id: input.accountId,
      ...(input.after ? { after: input.after.toISOString() } : {}),
    },
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    fetchImpl,
  });
  const grouped = new Map<string, MirroredInboxMessage[]>();
  for (const record of page.items) {
    const threadId = stringValue(record.chat_id);
    const message = normalizeChatMessage(record);
    if (!threadId || !message) continue;
    const current = grouped.get(threadId) ?? [];
    current.push(message);
    grouped.set(threadId, current);
  }
  const threads: MirroredInboxThread[] = [];
  for (const batch of batches([...grouped.entries()], 8)) {
    const loaded = await Promise.all(batch.map(async ([threadId, threadMessages]) => {
      const chat = await readOptionalRecord({
        dsn: input.dsn,
        apiKey: input.apiKey,
        path: `/api/v1/chats/${encodeURIComponent(threadId)}`,
        fetchImpl,
      });
      const attendeeProviderId = stringValue(chat?.attendee_provider_id)
        ?? stringValue(chat?.attendee_public_identifier);
      const attendee = input.channel === "linkedin" && attendeeProviderId
        ? await readOptionalRecord({
            dsn: input.dsn,
            apiKey: input.apiKey,
            path: `/api/v1/chat_attendees/${encodeURIComponent(attendeeProviderId)}`,
            fetchImpl,
          })
        : null;
      const externalIdentity = attendeeProviderId
        ?? stringValue(chat?.provider_id)
        ?? threadId;
      const name = stringValue(attendee?.name)
        ?? stringValue(chat?.name)
        ?? (input.channel === "linkedin" ? "Contact LinkedIn" : "Contact WhatsApp");
      const messages = [...threadMessages].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
      return {
        threadId,
        channel: input.channel,
        externalIdentity,
        identityValue: stringValue(attendee?.profile_url) ?? externalIdentity,
        contactName: name,
        photoUrl: stringValue(attendee?.picture_url),
        subject: null,
        unreadCount: nonNegativeInteger(chat?.unread_count),
        updatedAt: messages.at(-1)?.occurredAt ?? dateValue(chat?.timestamp) ?? new Date(),
        messages,
      } satisfies MirroredInboxThread;
    }));
    threads.push(...loaded);
  }
  return {
    threads: threads.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
    nextCursor: page.nextCursor,
    highWatermark: maxOccurredAt(threads),
  };
}

export async function collectUnipileEmailInboxPage(input: {
  readonly dsn: string;
  readonly apiKey: string;
  readonly accountId: string;
  readonly cursor?: string | null;
  readonly after?: Date | null;
  readonly fetchImpl?: typeof fetch;
}): Promise<MirroredInboxPage> {
  const page = await readPage({
    dsn: input.dsn,
    apiKey: input.apiKey,
    path: "/api/v1/emails",
    query: {
      account_id: input.accountId,
      meta_only: "false",
      ...(input.after ? { after: input.after.toISOString() } : {}),
    },
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    fetchImpl: input.fetchImpl ?? fetch,
  });
  const grouped = new Map<string, { records: Record<string, unknown>[]; messages: MirroredInboxMessage[] }>();
  for (const record of page.items) {
    const message = normalizeEmailMessage(record);
    const threadId = stringValue(record.thread_id)
      ?? stringValue(record.message_id)
      ?? stringValue(record.id);
    if (!threadId || !message) continue;
    const current = grouped.get(threadId) ?? { records: [], messages: [] };
    current.records.push(record);
    current.messages.push(message);
    grouped.set(threadId, current);
  }
  const threads = [...grouped.entries()].flatMap(([threadId, group]): MirroredInboxThread[] => {
    const sortedRecords = group.records.sort((left, right) => {
      return (dateValue(left.date)?.getTime() ?? 0) - (dateValue(right.date)?.getTime() ?? 0);
    });
    const messages = [...group.messages].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    const incoming = sortedRecords.find((record) => emailDirection(record) === "inbound");
    const representative = incoming ?? sortedRecords[0];
    if (!representative) return [];
    const participant = emailDirection(representative) === "inbound"
      ? recordValue(representative.from_attendee)
      : recordList(representative.to_attendees)[0] ?? null;
    const email = stringValue(participant?.identifier);
    if (!email) return [];
    const contactName = stringValue(participant?.display_name) ?? email;
    const unreadCount = sortedRecords.filter((record) => {
      return emailDirection(record) === "inbound" && !stringValue(record.read_date);
    }).length;
    return [{
      threadId,
      channel: "email",
      externalIdentity: email,
      identityValue: email,
      contactName,
      photoUrl: null,
      subject: [...sortedRecords].reverse().map((record) => stringValue(record.subject)).find(Boolean) ?? null,
      unreadCount,
      updatedAt: messages.at(-1)?.occurredAt ?? new Date(),
      messages,
    }];
  }).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  return { threads, nextCursor: page.nextCursor, highWatermark: maxOccurredAt(threads) };
}

interface WebhookIngestor {
  ingest(rawBody: string): Promise<{ duplicate: boolean; eventId: string }>;
}

export class UnipileAccountInboxSynchronizer {
  constructor(
    private readonly database: Database,
    private readonly ingestor: WebhookIngestor,
    private readonly options: {
      readonly dsn: string;
      readonly apiKey: string;
      readonly fetchImpl?: typeof fetch;
      readonly overlapMs?: number;
      readonly now?: () => Date;
    },
  ) {}

  async reconcile(workspaceId?: string): Promise<number> {
    const conditions = [eq(connectedAccounts.provider, "unipile"), eq(connectedAccounts.status, "connected")];
    if (workspaceId) conditions.push(eq(connectedAccounts.workspaceId, workspaceId));
    const accounts = await this.database
      .select({
        id: connectedAccounts.id,
        workspaceId: connectedAccounts.workspaceId,
        providerAccountId: connectedAccounts.providerAccountId,
        capabilities: connectedAccounts.capabilities,
      })
      .from(connectedAccounts)
      .where(and(...conditions));
    let imported = 0;
    for (const account of accounts) {
      const channel = channelFromCapabilities(account.capabilities);
      if (!channel) continue;
      imported += await this.#syncAccount({ ...account, channel });
    }
    return imported;
  }

  async #syncAccount(account: SyncAccount): Promise<number> {
    const now = (this.options.now ?? (() => new Date()))();
    const resource = account.channel === "email" ? "emails" as const : "messages" as const;
    const state = await this.#loadState(account, resource, now);
    const activityFloor = state.backfillComplete ? state.highWatermark : null;
    await this.database.update(inboxSyncStates).set({
      status: "syncing",
      lastAttemptAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: now,
    }).where(eq(inboxSyncStates.id, state.id));
    try {
      const after = !state.cursor && state.backfillComplete && state.highWatermark
        ? new Date(state.highWatermark.getTime() - (this.options.overlapMs ?? DEFAULT_OVERLAP_MS))
        : null;
      const page = account.channel === "email"
        ? await collectUnipileEmailInboxPage({
            dsn: this.options.dsn,
            apiKey: this.options.apiKey,
            accountId: account.providerAccountId,
            cursor: state.cursor,
            after,
            ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
          })
        : await collectUnipileMessageInboxPage({
            dsn: this.options.dsn,
            apiKey: this.options.apiKey,
            accountId: account.providerAccountId,
            channel: account.channel,
            cursor: state.cursor,
            after,
            ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
          });
      const result = await this.#persistThreads(account, page.threads, activityFloor, now);
      const highWatermark = latestDate(state.highWatermark, page.highWatermark);
      const completedBackfill = state.backfillComplete || page.nextCursor === null;
      await this.database.update(inboxSyncStates).set({
        cursor: page.nextCursor,
        highWatermark,
        backfillComplete: completedBackfill,
        status: "idle",
        lastSuccessAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: now,
      }).where(eq(inboxSyncStates.id, state.id));
      for (const event of result.inboundEvents) {
        await this.ingestor.ingest(JSON.stringify(event));
      }
      return result.insertedMessages;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.database.update(inboxSyncStates).set({
        status: "error",
        lastErrorCode: unipileErrorCode(message),
        lastErrorMessage: message.slice(0, 4_000),
        updatedAt: now,
      }).where(eq(inboxSyncStates.id, state.id));
      console.warn(JSON.stringify({
        event: "unipile_inbox_sync_failed",
        workspaceId: account.workspaceId,
        connectedAccountId: account.id,
        channel: account.channel,
        error: message,
      }));
      return 0;
    }
  }

  async #loadState(account: SyncAccount, resource: "messages" | "emails", now: Date) {
    const [state] = await this.database.insert(inboxSyncStates).values({
      id: crypto.randomUUID(),
      workspaceId: account.workspaceId,
      connectedAccountId: account.id,
      providerAccountId: account.providerAccountId,
      channel: account.channel,
      resource,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [inboxSyncStates.workspaceId, inboxSyncStates.connectedAccountId, inboxSyncStates.resource],
      set: {
        providerAccountId: account.providerAccountId,
        channel: account.channel,
        updatedAt: now,
      },
    }).returning();
    if (!state) throw new Error("INBOX_SYNC_STATE_WRITE_FAILED");
    return state;
  }

  async #persistThreads(
    account: SyncAccount,
    threads: readonly MirroredInboxThread[],
    activityFloor: Date | null,
    observedAt: Date,
  ): Promise<{ insertedMessages: number; inboundEvents: Record<string, unknown>[] }> {
    const campaignContacts = await this.#campaignContacts(account);
    let insertedMessages = 0;
    const inboundEvents: Record<string, unknown>[] = [];
    for (const thread of threads) {
      const providerKey = providerIdentityKey(account.providerAccountId, thread.externalIdentity);
      const normalizedIdentity = thread.channel === "email"
        ? safeNormalizeEmail(thread.identityValue)
        : providerKey;
      const knownCampaign = campaignContacts.get(thread.externalIdentity);
      const existingContactId = knownCampaign?.contactId
        ?? await this.#contactForIdentity(account.workspaceId, thread.channel, normalizedIdentity);
      const contactId = existingContactId ?? crypto.randomUUID();
      const campaignId = knownCampaign?.campaignId
        ?? await this.#campaignForContact(account, contactId);
      const [firstName, lastName] = splitContactName(thread.contactName, thread.channel);
      const outcome = await this.database.transaction(async (tx) => {
        const [insertedContact] = await tx.insert(contacts).values({
          id: contactId,
          workspaceId: account.workspaceId,
          firstName,
          lastName,
          photoUrl: thread.photoUrl,
          preferredChannel: thread.channel,
          source: "provider",
          createdAt: thread.updatedAt,
          updatedAt: thread.updatedAt,
        }).onConflictDoNothing().returning({ id: contacts.id, updatedAt: contacts.updatedAt });
        const [linkedIdentity] = await tx.insert(contactIdentities).values({
          id: crypto.randomUUID(),
          workspaceId: account.workspaceId,
          contactId,
          type: thread.channel === "whatsapp" ? "whatsapp" : thread.channel,
          value: thread.identityValue,
          normalizedValue: normalizedIdentity,
          verificationStatus: "verified",
          source: "provider",
          createdAt: thread.updatedAt,
          updatedAt: thread.updatedAt,
        }).onConflictDoUpdate({
          target: [contactIdentities.workspaceId, contactIdentities.type, contactIdentities.normalizedValue],
          set: { value: thread.identityValue, verificationStatus: "verified", updatedAt: thread.updatedAt },
        }).returning({
          id: contactIdentities.id,
          type: contactIdentities.type,
          verificationStatus: contactIdentities.verificationStatus,
          updatedAt: contactIdentities.updatedAt,
        });
        if (insertedContact) {
          await captureProspectMemoryMutation(tx, {
            workspaceId: account.workspaceId,
            sourceContactId: contactId,
            sourceKind: "contact",
            sourceId: contactId,
            sourceVersion: insertedContact.updatedAt.getTime(),
            kind: "contact_updated",
            occurredAt: insertedContact.updatedAt,
            observedAt,
            payload: { source: "provider", preferredChannel: thread.channel },
            correlationId: `inbox-sync:${account.id}:${thread.threadId}`,
          });
        }
        if (linkedIdentity) {
          await captureProspectMemoryMutation(tx, {
            workspaceId: account.workspaceId,
            sourceContactId: contactId,
            sourceKind: "contact_identity",
            sourceId: linkedIdentity.id,
            sourceVersion: linkedIdentity.updatedAt.getTime(),
            kind: "identity_linked",
            occurredAt: linkedIdentity.updatedAt,
            observedAt,
            payload: {
              identityType: linkedIdentity.type,
              verificationStatus: linkedIdentity.verificationStatus,
            },
            correlationId: `inbox-sync:${account.id}:${thread.threadId}`,
          });
        }
        const [conversation] = await tx.insert(conversations).values({
          id: crypto.randomUUID(),
          workspaceId: account.workspaceId,
          contactId,
          campaignId,
          connectedAccountId: account.id,
          provider: "unipile",
          providerAccountId: account.providerAccountId,
          providerThreadId: thread.threadId,
          channel: thread.channel,
          origin: campaignId ? "campaign" : "outside_campaign",
          automationMode: campaignId ? "setter" : "human",
          subject: thread.subject,
          status: "open",
          unreadCount: thread.unreadCount,
          lastMessageAt: thread.updatedAt,
          createdAt: thread.updatedAt,
          updatedAt: thread.updatedAt,
        }).onConflictDoUpdate({
          target: [conversations.workspaceId, conversations.providerAccountId, conversations.providerThreadId],
          set: {
            contactId,
            connectedAccountId: account.id,
            ...(campaignId ? { campaignId, origin: "campaign" as const } : {}),
            ...(thread.subject ? { subject: thread.subject } : {}),
            unreadCount: thread.unreadCount,
            lastMessageAt: thread.updatedAt,
            updatedAt: thread.updatedAt,
          },
        }).returning({
          id: conversations.id,
          campaignId: conversations.campaignId,
          automationMode: conversations.automationMode,
        });
        if (!conversation) throw new Error("INBOX_CONVERSATION_WRITE_FAILED");
        const created = thread.messages.length
          ? await tx.insert(messages).values(thread.messages.map((message) => ({
              id: crypto.randomUUID(),
              workspaceId: account.workspaceId,
              conversationId: conversation.id,
              providerMessageId: message.id,
              direction: message.direction,
              senderType: message.direction === "inbound" ? "prospect" : "human",
              body: message.body,
              sentAt: message.direction === "outbound" ? message.occurredAt : null,
              receivedAt: message.direction === "inbound" ? message.occurredAt : null,
              createdAt: message.occurredAt,
            }))).onConflictDoNothing().returning({
              id: messages.id,
              providerMessageId: messages.providerMessageId,
            })
          : [];
        const createdIds = new Set(created.map((message) => message.providerMessageId));
        const newMessages = thread.messages.filter((message) => createdIds.has(message.id));
        const internalIds = new Map(created.map((message) => [message.providerMessageId, message.id]));
        for (const message of newMessages) {
          const internalMessageId = internalIds.get(message.id);
          if (!internalMessageId) continue;
          await captureProspectMemoryMutation(tx, {
            workspaceId: account.workspaceId,
            sourceContactId: contactId,
            sourceKind: "message",
            sourceId: internalMessageId,
            sourceVersion: 1,
            kind: message.direction === "inbound" ? "message_received" : "message_sent",
            occurredAt: message.occurredAt,
            observedAt,
            payload: {
              conversationId: conversation.id,
              channel: thread.channel,
              direction: message.direction,
              senderType: message.direction === "inbound" ? "prospect" : "human",
            },
            correlationId: `inbox-sync:${account.id}:${thread.threadId}`,
          });
        }
        const newOutbound = newMessages.filter((message) => message.direction === "outbound");
        const automatedOutbound = new Set<string>();
        if (newOutbound.length) {
          const [sentActions, sentReplies] = await Promise.all([
            tx.select({
              providerRequestId: outreachActions.providerRequestId,
              providerMessageId: outreachActions.providerMessageId,
              body: outreachActions.body,
              sentAt: outreachActions.sentAt,
            }).from(outreachActions).where(and(
              eq(outreachActions.workspaceId, account.workspaceId),
              eq(outreachActions.providerAccountId, account.providerAccountId),
              eq(outreachActions.contactId, contactId),
              isNotNull(outreachActions.sentAt),
            )).orderBy(desc(outreachActions.sentAt)).limit(50),
            tx.select({
              providerRequestId: automatedReplies.providerRequestId,
              body: automatedReplies.body,
              sentAt: automatedReplies.sentAt,
            }).from(automatedReplies).where(and(
              eq(automatedReplies.workspaceId, account.workspaceId),
              eq(automatedReplies.conversationId, conversation.id),
              isNotNull(automatedReplies.sentAt),
            )).orderBy(desc(automatedReplies.sentAt)).limit(50),
          ]);
          for (const message of newOutbound) {
            const exactAction = sentActions.some((action) => action.providerRequestId === message.id || action.providerMessageId === message.id);
            const exactReply = sentReplies.some((reply) => reply.providerRequestId === message.id);
            const contentMatch = [...sentActions, ...sentReplies].some((entry) => entry.sentAt
              && entry.body.trim() === message.body.trim()
              && Math.abs(entry.sentAt.getTime() - message.occurredAt.getTime()) <= 15 * 60_000);
            if (exactAction || exactReply || contentMatch) automatedOutbound.add(message.id);
          }
        }
        const humanActivity = activityFloor
          ? newMessages.some((message) => message.direction === "outbound"
            && message.occurredAt > activityFloor
            && !automatedOutbound.has(message.id))
          : false;
        if (humanActivity) {
          await tx.update(conversations).set({ automationMode: "human", updatedAt: thread.updatedAt }).where(and(
            eq(conversations.workspaceId, account.workspaceId),
            eq(conversations.id, conversation.id),
          ));
          await tx.update(automatedReplies).set({
            status: "cancelled",
            errorCode: "HUMAN_ACTIVITY_DETECTED",
            errorMessage: "Une personne a répondu dans le thread avant l’envoi automatique.",
            updatedAt: thread.updatedAt,
          }).where(and(
            eq(automatedReplies.workspaceId, account.workspaceId),
            eq(automatedReplies.conversationId, conversation.id),
            inArray(automatedReplies.status, ["scheduled", "sending"]),
          ));
        }
        return {
          conversationId: conversation.id,
          campaignId: conversation.campaignId,
          automationMode: humanActivity ? "human" : conversation.automationMode,
          newMessages,
        };
      });
      insertedMessages += outcome.newMessages.length;
      if (activityFloor && outcome.campaignId && outcome.automationMode === "setter") {
        for (const message of outcome.newMessages) {
          if (message.direction !== "inbound" || message.occurredAt <= activityFloor) continue;
          inboundEvents.push(providerEvent(account, thread, message));
        }
      }
    }
    return { insertedMessages, inboundEvents };
  }

  async #contactForIdentity(
    workspaceId: string,
    channel: ProspectingChannel,
    normalizedValue: string,
  ): Promise<string | null> {
    const [identity] = await this.database.select({ contactId: contactIdentities.contactId })
      .from(contactIdentities)
      .where(and(
        eq(contactIdentities.workspaceId, workspaceId),
        eq(contactIdentities.type, channel === "whatsapp" ? "whatsapp" : channel),
        eq(contactIdentities.normalizedValue, normalizedValue),
      ))
      .limit(1);
    return identity?.contactId ?? null;
  }

  async #campaignContacts(account: SyncAccount): Promise<Map<string, { contactId: string; campaignId: string }>> {
    if (account.channel === "email") return new Map();
    const rows = await this.database.select({
      contactId: outreachActions.contactId,
      campaignId: outreachActions.campaignId,
      providerData: prospectDiscoveryCandidates.providerData,
      sentAt: outreachActions.sentAt,
    }).from(outreachActions).innerJoin(
      prospectDiscoveryCandidates,
      and(
        eq(prospectDiscoveryCandidates.workspaceId, outreachActions.workspaceId),
        eq(prospectDiscoveryCandidates.id, outreachActions.candidateId),
      ),
    ).where(and(
      eq(outreachActions.workspaceId, account.workspaceId),
      eq(outreachActions.providerAccountId, account.providerAccountId),
      eq(outreachActions.channel, account.channel),
      isNotNull(outreachActions.sentAt),
    )).orderBy(desc(outreachActions.sentAt));
    const result = new Map<string, { contactId: string; campaignId: string }>();
    for (const row of rows) {
      const providerId = providerContactId(row.providerData);
      if (providerId && !result.has(providerId)) {
        result.set(providerId, { contactId: row.contactId, campaignId: row.campaignId });
      }
    }
    return result;
  }

  async #campaignForContact(account: SyncAccount, contactId: string): Promise<string | null> {
    const [action] = await this.database.select({ campaignId: outreachActions.campaignId })
      .from(outreachActions)
      .where(and(
        eq(outreachActions.workspaceId, account.workspaceId),
        eq(outreachActions.providerAccountId, account.providerAccountId),
        eq(outreachActions.channel, account.channel),
        eq(outreachActions.contactId, contactId),
        isNotNull(outreachActions.sentAt),
      ))
      .orderBy(desc(outreachActions.sentAt))
      .limit(1);
    return action?.campaignId ?? null;
  }
}

type SyncAccount = {
  readonly id: string;
  readonly workspaceId: string;
  readonly providerAccountId: string;
  readonly capabilities: unknown;
  readonly channel: ProspectingChannel;
};

function providerEvent(
  account: SyncAccount,
  thread: MirroredInboxThread,
  message: MirroredInboxMessage,
): Record<string, unknown> {
  return {
    event: thread.channel === "email" ? "mail_received" : "message_received",
    webhook_id: `polling:${account.providerAccountId}:${message.id}`,
    account_id: account.providerAccountId,
    account_type: thread.channel === "linkedin" ? "LINKEDIN" : thread.channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
    chat_id: thread.channel === "email" ? undefined : thread.threadId,
    thread_id: thread.threadId,
    id: message.id,
    message_id: message.id,
    text: message.body,
    body_plain: message.body,
    direction: "inbound",
    sender: { attendee_provider_id: message.senderProviderId ?? thread.externalIdentity },
    from_attendee: message.senderValue ? { identifier: message.senderValue } : undefined,
    timestamp: message.occurredAt.toISOString(),
    date: message.occurredAt.toISOString(),
    source: "polling",
  };
}

async function readPage(input: {
  readonly dsn: string;
  readonly apiKey: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly cursor?: string | null;
  readonly fetchImpl: typeof fetch;
}): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> {
  const url = new URL(input.path, normalizedDsn(input.dsn));
  url.searchParams.set("limit", String(PAGE_SIZE));
  for (const [key, value] of Object.entries(input.query)) url.searchParams.set(key, value);
  if (input.cursor) url.searchParams.set("cursor", input.cursor);
  const response = await input.fetchImpl(url, {
    headers: { "X-API-KEY": input.apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`UNIPILE_INBOX_SYNC_HTTP_${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("UNIPILE_INBOX_SYNC_RESPONSE_INVALID");
  }
  const record = body as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? record.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
  return { items, nextCursor: stringValue(record.cursor) };
}

async function readOptionalRecord(input: {
  readonly dsn: string;
  readonly apiKey: string;
  readonly path: string;
  readonly fetchImpl: typeof fetch;
}): Promise<Record<string, unknown> | null> {
  try {
    const response = await input.fetchImpl(new URL(input.path, normalizedDsn(input.dsn)), {
      headers: { "X-API-KEY": input.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeChatMessage(record: Record<string, unknown>): MirroredInboxMessage | null {
  if (truthy(record.is_event) || truthy(record.deleted) || truthy(record.hidden)) return null;
  const id = stringValue(record.id);
  const occurredAt = dateValue(record.timestamp);
  const body = messageBody(record);
  if (!id || !occurredAt || !body) return null;
  const direction = truthy(record.is_sender) ? "outbound" as const : "inbound" as const;
  return {
    id,
    body,
    direction,
    occurredAt,
    senderValue: null,
    senderProviderId: stringValue(record.sender_id) ?? stringValue(record.sender_attendee_id),
  };
}

function normalizeEmailMessage(record: Record<string, unknown>): MirroredInboxMessage | null {
  const id = stringValue(record.id);
  const occurredAt = dateValue(record.date);
  const body = stringValue(record.body_plain)
    ?? htmlToText(stringValue(record.body))
    ?? stringValue(record.subject);
  if (!id || !occurredAt || !body) return null;
  const from = recordValue(record.from_attendee);
  return {
    id,
    body: body.slice(0, MAX_MESSAGE_LENGTH),
    direction: emailDirection(record),
    occurredAt,
    senderValue: stringValue(from?.identifier),
    senderProviderId: null,
  };
}

function emailDirection(record: Record<string, unknown>): "inbound" | "outbound" {
  const origin = stringValue(record.origin)?.toLowerCase();
  const role = stringValue(record.role)?.toLowerCase();
  return origin === "internal" || origin === "self" || role === "sent" || role === "outbox"
    ? "outbound"
    : "inbound";
}

function messageBody(record: Record<string, unknown>): string | null {
  const text = stringValue(record.text) ?? stringValue(record.subject);
  if (text) return text.slice(0, MAX_MESSAGE_LENGTH);
  return Array.isArray(record.attachments) && record.attachments.length ? "Pièce jointe" : null;
}

function channelFromCapabilities(value: unknown): ProspectingChannel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const capabilities = value as Record<string, unknown>;
  if (capabilities.linkedin) return "linkedin";
  if (capabilities.email) return "email";
  if (capabilities.whatsapp) return "whatsapp";
  return null;
}

function maxOccurredAt(threads: readonly MirroredInboxThread[]): Date | null {
  let latest: Date | null = null;
  for (const thread of threads) {
    for (const message of thread.messages) latest = latestDate(latest, message.occurredAt);
  }
  return latest;
}

function latestDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function safeNormalizeEmail(value: string): string {
  try {
    return normalizeEmail(value);
  } catch {
    return value.trim().toLowerCase();
  }
}

function providerContactId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  return stringValue(data.providerId)
    ?? stringValue(data.provider_id)
    ?? stringValue(data.attendeeProviderId)
    ?? stringValue(data.attendee_provider_id);
}

function providerIdentityKey(accountId: string, providerId: string): string {
  return `unipile:${accountId}:${providerId}`;
}

function splitContactName(value: string, channel: ProspectingChannel): readonly [string, string] {
  const clean = value.trim();
  if (channel === "email" && clean.includes("@")) return [clean, ""];
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return ["Contact", channel === "linkedin" ? "LinkedIn" : channel === "whatsapp" ? "WhatsApp" : "Email"];
  if (parts.length === 1) return [parts[0]!, ""];
  return [parts[0]!, parts.slice(1).join(" ")];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}

function normalizedDsn(dsn: string): string {
  return dsn.endsWith("/") ? dsn : `${dsn}/`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function unipileErrorCode(message: string): string {
  const match = /UNIPILE_INBOX_SYNC_HTTP_(\d{3})/.exec(message);
  return match ? `UNIPILE_HTTP_${match[1]}` : "UNIPILE_INBOX_SYNC_FAILED";
}
