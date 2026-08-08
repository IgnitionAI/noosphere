import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  contactIdentities,
  contacts,
  conversations,
  messages,
  outreachActions,
  prospectDiscoveryCandidates,
} from "@outbound/infrastructure/database/schema";

const MAX_PAGES = 5;
const PAGE_SIZE = 100;
const DEFAULT_OVERLAP_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

export interface UnipileChatContactScope {
  readonly channel: Extract<ProspectingChannel, "linkedin" | "whatsapp">;
  readonly since: Date;
  readonly contactId?: string;
  readonly campaignId?: string;
}

export interface UnipileInboxThread {
  readonly chatId: string;
  readonly attendeeProviderId: string;
  readonly name: string;
  readonly profileUrl: string | null;
  readonly photoUrl: string | null;
  readonly unreadCount: number;
  readonly updatedAt: Date;
  readonly messages: readonly {
    readonly id: string;
    readonly body: string;
    readonly direction: "inbound" | "outbound";
    readonly occurredAt: Date;
  }[];
}

export interface UnipilePollingEvent {
  readonly event: "message_received" | "message_sent";
  readonly account_id: string;
  readonly account_type: "LINKEDIN" | "WHATSAPP";
  readonly chat_id: string;
  readonly id: string;
  readonly text: string;
  readonly direction: "inbound" | "outbound";
  readonly sender: { readonly attendee_provider_id: string };
  readonly timestamp: string;
  readonly source: "polling";
}

export async function collectUnipileChatEvents(input: {
  readonly dsn: string;
  readonly apiKey: string;
  readonly accountId: string;
  readonly contacts: ReadonlyMap<string, UnipileChatContactScope>;
  readonly fetchImpl?: typeof fetch;
}): Promise<UnipilePollingEvent[]> {
  if (input.contacts.size === 0) return [];
  const fetchImpl = input.fetchImpl ?? fetch;
  const chats = await listPaginated({
    dsn: input.dsn,
    apiKey: input.apiKey,
    path: "/api/v1/chats",
    query: { account_id: input.accountId },
    fetchImpl,
  });
  const events = new Map<string, UnipilePollingEvent>();
  for (const chat of chats) {
    const chatId = stringValue(chat.id);
    const attendeeProviderId = stringValue(chat.attendee_provider_id);
    if (!chatId || !attendeeProviderId) continue;
    const scope = input.contacts.get(attendeeProviderId);
    if (!scope) continue;
    const messages = await listPaginated({
      dsn: input.dsn,
      apiKey: input.apiKey,
      path: `/api/v1/chats/${encodeURIComponent(chatId)}/messages`,
      fetchImpl,
    });
    for (const message of messages) {
      const normalized = normalizeMessage({
        message,
        chatId,
        accountId: input.accountId,
        attendeeProviderId,
        scope,
      });
      if (normalized) events.set(normalized.id, normalized);
    }
  }
  return [...events.values()].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
}

export async function collectUnipileLinkedInInbox(input: {
  readonly dsn: string;
  readonly apiKey: string;
  readonly accountId: string;
  readonly since?: Date;
  readonly fetchImpl?: typeof fetch;
}): Promise<UnipileInboxThread[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const chats = await listPaginated({
    dsn: input.dsn,
    apiKey: input.apiKey,
    path: "/api/v1/chats",
    query: { account_id: input.accountId },
    maxPages: 1,
    fetchImpl,
  });
  const recent = chats.filter((chat) => {
    const chatId = stringValue(chat.id);
    const attendeeProviderId = stringValue(chat.attendee_provider_id);
    const updatedAt = dateValue(chat.timestamp);
    return isDirectChat(chat.type)
      && Boolean(chatId && attendeeProviderId && updatedAt)
      && (!input.since || updatedAt! > input.since);
  }).slice(0, PAGE_SIZE);
  const threads: UnipileInboxThread[] = [];
  for (let offset = 0; offset < recent.length; offset += 5) {
    const batch = recent.slice(offset, offset + 5);
    const loaded = await Promise.all(batch.map(async (chat): Promise<UnipileInboxThread | null> => {
      const chatId = stringValue(chat.id);
      const attendeeProviderId = stringValue(chat.attendee_provider_id);
      const updatedAt = dateValue(chat.timestamp);
      if (!chatId || !attendeeProviderId || !updatedAt) return null;
      const [rows, attendee] = await Promise.all([
        listPaginated({
          dsn: input.dsn,
          apiKey: input.apiKey,
          path: `/api/v1/chats/${encodeURIComponent(chatId)}/messages`,
          maxPages: 1,
          fetchImpl,
        }),
        readOptionalRecord({
          dsn: input.dsn,
          apiKey: input.apiKey,
          path: `/api/v1/chat_attendees/${encodeURIComponent(attendeeProviderId)}`,
          fetchImpl,
        }),
      ]);
      const normalized = rows.flatMap((message) => {
        const id = stringValue(message.id);
        const body = stringValue(message.text)?.trim();
        const occurredAt = dateValue(message.timestamp);
        if (
          !id
          || !body
          || !occurredAt
          || truthy(message.is_event)
          || truthy(message.is_deleted)
          || truthy(message.deleted)
          || truthy(message.is_hidden)
          || truthy(message.hidden)
        ) return [];
        return [{
          id,
          body,
          direction: truthy(message.is_sender) ? "outbound" as const : "inbound" as const,
          occurredAt,
        }];
      }).sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
      return {
        chatId,
        attendeeProviderId,
        name: stringValue(attendee?.name)?.trim()
          || stringValue(chat.name)?.trim()
          || "Contact LinkedIn",
        profileUrl: stringValue(attendee?.profile_url),
        photoUrl: stringValue(attendee?.picture_url),
        unreadCount: nonNegativeInteger(chat.unread_count),
        updatedAt,
        messages: normalized,
      };
    }));
    threads.push(...loaded.filter((thread): thread is UnipileInboxThread => thread !== null));
  }
  return threads.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

interface WebhookIngestor {
  ingest(rawBody: string): Promise<{ duplicate: boolean; eventId: string }>;
}

export class UnipileChatSynchronizer {
  readonly #watermarks = new Map<string, Date>();

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

  async reconcile(): Promise<number> {
    const scopes = await this.#campaignContactScopes();
    let ingested = 0;
    for (const [key, account] of scopes) {
      try {
        const events = await collectUnipileChatEvents({
          dsn: this.options.dsn,
          apiKey: this.options.apiKey,
          accountId: account.accountId,
          contacts: account.contacts,
          ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
        });
        for (const event of events) {
          const result = await this.ingestor.ingest(JSON.stringify(event));
          if (!result.duplicate) ingested += 1;
        }
        if (account.channels.has("linkedin")) {
          const watermark = this.#watermarks.get(key);
          const inbox = await collectUnipileLinkedInInbox({
            dsn: this.options.dsn,
            apiKey: this.options.apiKey,
            accountId: account.accountId,
            ...(watermark ? { since: new Date(watermark.getTime() - (this.options.overlapMs ?? DEFAULT_OVERLAP_MS)) } : {}),
            ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
          });
          ingested += await this.#persistLinkedInInbox(account, inbox);
        }
        this.#watermarks.set(key, (this.options.now ?? (() => new Date()))());
      } catch (error) {
        console.warn(JSON.stringify({
          event: "unipile_chat_sync_failed",
          workspaceId: account.workspaceId,
          accountId: account.accountId,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    return ingested;
  }

  async #campaignContactScopes(): Promise<Map<string, AccountScope>> {
    const rows = await this.database
      .select({
        workspaceId: outreachActions.workspaceId,
        accountId: outreachActions.providerAccountId,
        channel: outreachActions.channel,
        contactId: outreachActions.contactId,
        campaignId: outreachActions.campaignId,
        sentAt: outreachActions.sentAt,
        providerData: prospectDiscoveryCandidates.providerData,
      })
      .from(outreachActions)
      .innerJoin(
        prospectDiscoveryCandidates,
        and(
          eq(prospectDiscoveryCandidates.workspaceId, outreachActions.workspaceId),
          eq(prospectDiscoveryCandidates.id, outreachActions.candidateId),
        ),
      )
      .where(and(
        eq(outreachActions.status, "sent"),
        inArray(outreachActions.channel, ["linkedin", "whatsapp"]),
        isNotNull(outreachActions.sentAt),
      ));
    const accounts = new Map<string, AccountScope>();
    const overlapMs = this.options.overlapMs ?? DEFAULT_OVERLAP_MS;
    for (const row of rows) {
      if (!row.sentAt || (row.channel !== "linkedin" && row.channel !== "whatsapp")) continue;
      const providerId = providerContactId(row.providerData);
      if (!providerId) continue;
      const key = `${row.workspaceId}:${row.accountId}`;
      let account = accounts.get(key);
      if (!account) {
        account = {
          workspaceId: row.workspaceId,
          accountId: row.accountId,
          contacts: new Map(),
          channels: new Set(),
        };
        accounts.set(key, account);
      }
      account.channels.add(row.channel);
      const watermark = this.#watermarks.get(key);
      const watermarkFloor = watermark
        ? new Date(watermark.getTime() - overlapMs)
        : row.sentAt;
      const since = row.sentAt > watermarkFloor ? row.sentAt : watermarkFloor;
      const existing = account.contacts.get(providerId);
      if (!existing || since < existing.since) {
        account.contacts.set(providerId, {
          channel: row.channel,
          since,
          contactId: row.contactId,
          campaignId: row.campaignId,
        });
      }
    }
    return accounts;
  }

  async #persistLinkedInInbox(
    account: AccountScope,
    threads: readonly UnipileInboxThread[],
  ): Promise<number> {
    let insertedMessages = 0;
    for (const thread of threads) {
      const known = account.contacts.get(thread.attendeeProviderId);
      const identityKey = providerIdentityKey(account.accountId, thread.attendeeProviderId);
      const contactId = known?.contactId
        ?? await this.#contactForProvider(account.workspaceId, identityKey)
        ?? crypto.randomUUID();
      const [firstName, lastName] = splitContactName(thread.name);
      const lastMessageAt = thread.messages.at(-1)?.occurredAt ?? thread.updatedAt;
      await this.database.transaction(async (tx) => {
        const contactValues = {
          id: contactId,
          workspaceId: account.workspaceId,
          firstName,
          lastName,
          photoUrl: thread.photoUrl,
          preferredChannel: "linkedin",
          source: "provider",
          createdAt: thread.updatedAt,
          updatedAt: thread.updatedAt,
        } as const;
        if (known?.contactId) {
          await tx.insert(contacts).values(contactValues).onConflictDoNothing();
        } else {
          await tx.insert(contacts).values(contactValues).onConflictDoUpdate({
            target: contacts.id,
            set: {
              firstName,
              lastName,
              photoUrl: thread.photoUrl,
              updatedAt: thread.updatedAt,
            },
          });
        }
        await tx.insert(contactIdentities).values({
          id: crypto.randomUUID(),
          workspaceId: account.workspaceId,
          contactId,
          type: "linkedin",
          value: thread.profileUrl ?? thread.attendeeProviderId,
          normalizedValue: identityKey,
          verificationStatus: "verified",
          source: "provider",
          createdAt: thread.updatedAt,
          updatedAt: thread.updatedAt,
        }).onConflictDoUpdate({
          target: [
            contactIdentities.workspaceId,
            contactIdentities.type,
            contactIdentities.normalizedValue,
          ],
          set: {
            value: thread.profileUrl ?? thread.attendeeProviderId,
            verificationStatus: "verified",
            updatedAt: thread.updatedAt,
          },
        });
        const [conversation] = await tx.insert(conversations).values({
          id: crypto.randomUUID(),
          workspaceId: account.workspaceId,
          contactId,
          campaignId: known?.campaignId ?? null,
          provider: "unipile",
          providerAccountId: account.accountId,
          providerThreadId: thread.chatId,
          channel: "linkedin",
          status: "open",
          unreadCount: thread.unreadCount,
          lastMessageAt,
          createdAt: thread.updatedAt,
          updatedAt: thread.updatedAt,
        }).onConflictDoUpdate({
          target: [conversations.workspaceId, conversations.providerAccountId, conversations.providerThreadId],
          set: {
            contactId,
            ...(known?.campaignId ? { campaignId: known.campaignId } : {}),
            unreadCount: thread.unreadCount,
            lastMessageAt,
            updatedAt: thread.updatedAt,
          },
        }).returning({ id: conversations.id });
        if (!conversation) throw new Error("LINKEDIN_INBOX_CONVERSATION_WRITE_FAILED");
        if (thread.messages.length) {
          const created = await tx.insert(messages).values(thread.messages.map((message) => ({
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
          }))).onConflictDoNothing().returning({ id: messages.id });
          insertedMessages += created.length;
        }
      });
    }
    return insertedMessages;
  }

  async #contactForProvider(workspaceId: string, identityKey: string): Promise<string | null> {
    const [identity] = await this.database
      .select({ contactId: contactIdentities.contactId })
      .from(contactIdentities)
      .where(and(
        eq(contactIdentities.workspaceId, workspaceId),
        eq(contactIdentities.type, "linkedin"),
        eq(contactIdentities.normalizedValue, identityKey),
      ))
      .limit(1);
    return identity?.contactId ?? null;
  }
}

interface AccountScope {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly contacts: Map<string, UnipileChatContactScope>;
  readonly channels: Set<Extract<ProspectingChannel, "linkedin" | "whatsapp">>;
}

function normalizeMessage(input: {
  message: Record<string, unknown>;
  chatId: string;
  accountId: string;
  attendeeProviderId: string;
  scope: UnipileChatContactScope;
}): UnipilePollingEvent | null {
  const id = stringValue(input.message.id);
  const text = stringValue(input.message.text)?.trim();
  const timestamp = stringValue(input.message.timestamp);
  if (!id || !text || !timestamp) return null;
  const occurredAt = new Date(timestamp);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt <= input.scope.since) return null;
  if (
    truthy(input.message.is_event)
    || truthy(input.message.is_deleted)
    || truthy(input.message.deleted)
    || truthy(input.message.is_hidden)
  ) return null;
  const outbound = truthy(input.message.is_sender);
  return {
    event: outbound ? "message_sent" : "message_received",
    account_id: input.accountId,
    account_type: input.scope.channel === "linkedin" ? "LINKEDIN" : "WHATSAPP",
    chat_id: input.chatId,
    id,
    text,
    direction: outbound ? "outbound" : "inbound",
    sender: { attendee_provider_id: input.attendeeProviderId },
    timestamp: occurredAt.toISOString(),
    source: "polling",
  };
}

async function listPaginated(input: {
  readonly dsn: string;
  readonly apiKey: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly fetchImpl: typeof fetch;
  readonly maxPages?: number;
}): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < (input.maxPages ?? MAX_PAGES); page += 1) {
    const url = new URL(input.path, normalizedDsn(input.dsn));
    url.searchParams.set("limit", String(PAGE_SIZE));
    for (const [key, value] of Object.entries(input.query ?? {})) {
      url.searchParams.set(key, value);
    }
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await input.fetchImpl(url, {
      headers: { "X-API-KEY": input.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`UNIPILE_CHAT_SYNC_HTTP_${response.status}`);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("UNIPILE_CHAT_SYNC_RESPONSE_INVALID");
    }
    const pageBody = body as Record<string, unknown>;
    if (Array.isArray(pageBody.items)) {
      for (const item of pageBody.items) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          items.push(item as Record<string, unknown>);
        }
      }
    }
    const nextCursor = stringValue(pageBody.cursor);
    if (!nextCursor || cursors.has(nextCursor)) break;
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  return items;
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
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
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
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function providerIdentityKey(accountId: string, providerId: string): string {
  return `unipile:${accountId}:${providerId}`;
}

function splitContactName(value: string): readonly [string, string] {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return ["Contact", "LinkedIn"];
  if (parts.length === 1) return [parts[0]!, ""];
  return [parts[0]!, parts.slice(1).join(" ")];
}

function isDirectChat(value: unknown): boolean {
  return value === undefined || value === null || value === 0 || value === "0";
}
