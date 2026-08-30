import { and, desc, eq } from "drizzle-orm";
import type {
  ExternalEffectExecutorInput,
  ExternalEffectExecutorResult,
  ExternalEffectReadOnlyInput,
  ExternalEffectReadOnlyPort,
  ExternalEffectReadOnlyResult,
} from "@outbound/application/mcp/external-effect-attempt";
import type { McpGovernedEffectKind } from "@outbound/application/mcp/mcp-governed-effects";
import type { OutboundChannelGateway } from "@outbound/application/campaigns/outbound-channel-gateway";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";
import type {
  SocialContentReader,
  SocialPublisher,
} from "@outbound/application/content/social-ports";
import { SocialProviderError } from "@outbound/application/content/social-ports";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import type { Database, DatabaseExecutor } from "@outbound/infrastructure/database/client";
import {
  calendarBookings,
  contactIdentities,
  contacts,
  contentAssetVersions,
  contentAssets,
  contentPublications,
  conversations,
  messages,
  mcpEffectProposals,
  meetingProposals,
} from "@outbound/infrastructure/database/schema";
import {
  CalendarIntegrationError,
  type WorkspaceCalendarScheduler,
} from "@outbound/infrastructure/calendar/postgres-calendar-integration";

const MAX_TEXT_BYTES = 32_000;
const MAX_ID_BYTES = 500;
const MAX_RECONCILIATION_RESULTS = 100;
const CHANNELS = new Set<ProspectingChannel>(["email", "linkedin", "whatsapp"]);

/** Provider implementations that have an explicit, existing contract. */
export interface McpGovernedEffectProviderAdapters {
  readonly outbound?: OutboundChannelGateway;
  readonly publisher?: SocialPublisher;
  readonly socialContentReader?: SocialContentReader;
  readonly calendar?: WorkspaceCalendarScheduler;
}

export interface ConversationExecutionSource {
  readonly kind: "conversation_reply";
  readonly provider: "unipile";
  readonly accountId: string;
  readonly channel: ProspectingChannel;
  readonly recipient: { readonly value: string; readonly normalizedValue: string; readonly providerUserId: string | null };
  readonly subject: string | null;
  readonly body: string;
  readonly conversationId: string | null;
  readonly replyToProviderMessageId: string | null;
}

export interface ContentExecutionSource {
  readonly kind: "content_publication";
  readonly accountId: string;
  readonly text: string;
  /** Media needs a separate durable object-storage/provider contract. */
  readonly attachments?: readonly unknown[];
}

export interface MeetingExecutionSource {
  readonly kind: "meeting_proposal";
  readonly contactId: string;
  readonly campaignId: string | null;
  readonly slotStart: string;
  readonly expiresAt: string;
  readonly meetingTypeId?: string;
}

export type McpGovernedEffectExecutionSource =
  | ConversationExecutionSource
  | ContentExecutionSource
  | MeetingExecutionSource
  | { readonly kind: "campaign_activation" };

export interface McpGovernedEffectSourceReader {
  read(input: { readonly workspaceId: string; readonly proposalId: string; readonly kind: McpGovernedEffectKind; readonly aggregateId: string }): Promise<McpGovernedEffectExecutionSource | null>;
}

/**
 * Executes only the three effects with an existing provider port. The durable
 * worker calls this after its attempt marker has committed; this class never
 * creates queue state and never accepts provider response bodies wholesale.
 */
export class PostgresMcpGovernedEffectExecutor implements ExternalEffectReadOnlyPort {
  private readonly sourceReader: McpGovernedEffectSourceReader;

  constructor(
    private readonly database: Database,
    private readonly adapters: McpGovernedEffectProviderAdapters,
    sourceReader?: McpGovernedEffectSourceReader,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.sourceReader = sourceReader ?? new PostgresMcpGovernedEffectSourceReader(database, this.now);
  }

  async execute(input: ExternalEffectExecutorInput): Promise<ExternalEffectExecutorResult> {
    const source = await this.sourceReader.read({
      workspaceId: input.identity.workspaceId,
      proposalId: input.identity.proposalId,
      kind: input.identity.kind,
      aggregateId: input.identity.aggregateId,
    });
    if (!source || source.kind !== input.identity.kind) return { outcome: "failed", code: "MCP_EFFECT_ATTEMPT_BINDING_CONFLICT" };
    if (source.kind === "campaign_activation") return { outcome: "failed", code: "ADAPTER_UNAVAILABLE" };
    try {
      if (source.kind === "conversation_reply") return await this.executeConversation(source, input);
      if (source.kind === "content_publication") return await this.executeContent(source, input);
      return await this.executeMeeting(source, input);
    } catch (error) {
      return mapProviderError(error);
    }
  }

  async reconcileReadOnly(input: ExternalEffectReadOnlyInput): Promise<ExternalEffectReadOnlyResult> {
    const source = await this.sourceReader.read({ workspaceId: input.workspaceId, proposalId: input.proposalId, kind: input.kind, aggregateId: input.aggregateId });
    if (!source || source.kind !== input.kind) return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
    if (source.kind === "content_publication" && this.adapters.socialContentReader) {
      if (!source.accountId) return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
      try {
        const page = await this.adapters.socialContentReader.listOwnContent({ accountId: source.accountId, cursor: null, limit: MAX_RECONCILIATION_RESULTS });
        const expectedPostId = stringValue(input.criteriaSnapshot.providerPostId);
        if (!expectedPostId) return { outcome: "error", code: "RECONCILIATION_CRITERIA_UNAVAILABLE" };
        const matches = page.data.filter((post) => post.providerPostId === expectedPostId);
        if (matches.length === 1) {
          const match = matches[0]!;
          return { outcome: "matched", authoritative: true, candidateCount: 1, result: boundedRecord({ providerPostId: match.providerPostId, socialId: match.socialId, url: match.url }) };
        }
        return matches.length === 0 ? { outcome: "not_found", candidateCount: 0 } : { outcome: "ambiguous", candidateCount: Math.min(matches.length, MAX_RECONCILIATION_RESULTS) };
      } catch (error) {
        return { outcome: "error", code: safeErrorCode(error) };
      }
    }
    // A booking row is an authoritative local read and does not call Cal.com.
    if (source.kind === "meeting_proposal") {
      const matches = await this.database.select({ id: calendarBookings.id, providerBookingId: calendarBookings.providerBookingId, meetingUrl: calendarBookings.meetingUrl })
        .from(calendarBookings)
        .where(and(eq(calendarBookings.workspaceId, input.workspaceId), eq(calendarBookings.contactId, source.contactId), eq(calendarBookings.startAt, new Date(source.slotStart)), eq(calendarBookings.status, "booked")))
        .limit(2);
      if (matches.length === 1) return { outcome: "matched", authoritative: true, candidateCount: 1, result: boundedRecord({ bookingId: matches[0]!.providerBookingId, meetingUrl: matches[0]!.meetingUrl }) };
      return matches.length === 0 ? { outcome: "not_found", candidateCount: 0 } : { outcome: "ambiguous", candidateCount: matches.length };
    }
    return { outcome: "error", code: "ADAPTER_UNAVAILABLE" };
  }

  private async executeConversation(source: ConversationExecutionSource, input: ExternalEffectExecutorInput): Promise<ExternalEffectExecutorResult> {
    const gateway = this.adapters.outbound;
    if (!gateway) return { outcome: "failed", code: "ADAPTER_UNAVAILABLE" };
    if (source.provider !== "unipile" || !boundedText(source.body, MAX_TEXT_BYTES) || !boundedText(source.accountId, MAX_ID_BYTES) || !CHANNELS.has(source.channel)) return { outcome: "failed", code: "ADAPTER_UNAVAILABLE" };
    const recipient = validRecipient(source.recipient);
    if (!recipient) return { outcome: "failed", code: "EFFECT_RECIPIENT_INVALID" };
    const result = await gateway.send({
      accountId: source.accountId,
      channel: source.channel,
      stepKind: source.channel === "email" ? "email" : source.channel === "whatsapp" ? "whatsapp" : "linkedin_message",
      recipient,
      subject: boundedText(source.subject, MAX_ID_BYTES),
      body: source.body,
      idempotencyKey: input.marker.idempotencyKey,
      conversationId: boundedText(source.conversationId, MAX_ID_BYTES),
      replyToProviderMessageId: boundedText(source.replyToProviderMessageId, MAX_ID_BYTES),
    });
    if (!boundedText(result.providerRequestId, MAX_ID_BYTES)) return { outcome: "unknown", code: "EFFECT_PROVIDER_RESPONSE_INVALID" };
    return delivered({ providerRequestId: result.providerRequestId, conversationId: result.conversationId });
  }

  private async executeContent(source: ContentExecutionSource, input: ExternalEffectExecutorInput): Promise<ExternalEffectExecutorResult> {
    const publisher = this.adapters.publisher;
    if (!publisher) return { outcome: "failed", code: "ADAPTER_UNAVAILABLE" };
    if (!boundedText(source.accountId, MAX_ID_BYTES) || !boundedText(source.text, MAX_TEXT_BYTES)) return { outcome: "failed", code: "EFFECT_REQUEST_INVALID" };
    if (source.attachments && source.attachments.length > 0) return { outcome: "failed", code: "ADAPTER_UNAVAILABLE" };
    const capabilities = await publisher.observeCapabilities({ accountId: source.accountId, now: this.now() });
    if (capabilities.network !== "linkedin" || capabilities.accountId !== source.accountId || !capabilities.accountHealthy || capabilities.textPublishing !== "available") return { outcome: "failed", code: "ADAPTER_UNAVAILABLE" };
    const result = await publisher.publishText({ accountId: source.accountId, text: source.text, requestKey: input.marker.idempotencyKey });
    if (!boundedText(result.providerPostId, MAX_ID_BYTES)) return { outcome: "unknown", code: "EFFECT_PROVIDER_RESPONSE_INVALID" };
    return delivered({ providerPostId: result.providerPostId, socialId: result.socialId, url: result.url, publishedAt: result.publishedAt?.toISOString() ?? null });
  }

  private async executeMeeting(source: MeetingExecutionSource, input: ExternalEffectExecutorInput): Promise<ExternalEffectExecutorResult> {
    const calendar = this.adapters.calendar;
    if (!calendar) return { outcome: "failed", code: "ADAPTER_UNAVAILABLE" };
    const slotStart = Date.parse(source.slotStart);
    const expiresAt = Date.parse(source.expiresAt);
    if (!boundedText(source.contactId, MAX_ID_BYTES) || !boundedText(source.slotStart, MAX_ID_BYTES) || !Number.isFinite(slotStart) || !boundedText(source.expiresAt, MAX_ID_BYTES) || !Number.isFinite(expiresAt)) return { outcome: "failed", code: "EFFECT_REQUEST_INVALID" };
    if (expiresAt <= this.now().getTime()) return { outcome: "failed", code: "SOURCE_STALE" };
    const result = await calendar.book({ workspaceId: input.identity.workspaceId, contactId: source.contactId, campaignId: source.campaignId, ...(source.meetingTypeId ? { meetingTypeId: source.meetingTypeId } : {}), start: source.slotStart, now: this.now() });
    if (!boundedText(result.bookingId, MAX_ID_BYTES) || !boundedText(result.start, MAX_ID_BYTES) || !boundedText(result.end, MAX_ID_BYTES)) return { outcome: "unknown", code: "EFFECT_PROVIDER_RESPONSE_INVALID" };
    return delivered({ bookingId: result.bookingId, start: result.start, end: result.end, meetingUrl: result.meetingUrl, label: result.label });
  }
}

export class PostgresMcpGovernedEffectSourceReader implements McpGovernedEffectSourceReader {
  constructor(private readonly database: DatabaseExecutor, private readonly now: () => Date = () => new Date()) {}

  async read(input: { readonly workspaceId: string; readonly proposalId: string; readonly kind: McpGovernedEffectKind; readonly aggregateId: string }): Promise<McpGovernedEffectExecutionSource | null> {
    const proposal = (await this.database.select({ intentSnapshot: mcpEffectProposals.intentSnapshot }).from(mcpEffectProposals).where(and(eq(mcpEffectProposals.workspaceId, input.workspaceId), eq(mcpEffectProposals.id, input.proposalId), eq(mcpEffectProposals.kind, input.kind), eq(mcpEffectProposals.aggregateId, input.aggregateId))).limit(1))[0];
    if (!proposal) return null;
    const intent = asRecord(proposal.intentSnapshot);
    if (input.kind === "campaign_activation") return { kind: "campaign_activation" };
    if (input.kind === "conversation_reply") {
      const conversation = (await this.database.select().from(conversations).where(and(eq(conversations.workspaceId, input.workspaceId), eq(conversations.id, input.aggregateId))).limit(1))[0];
      if (!conversation) return null;
      const contact = (await this.database.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, conversation.contactId))).limit(1))[0];
      if (!contact) return null;
      const identity = (await this.database.select({ value: contactIdentities.value, normalizedValue: contactIdentities.normalizedValue, type: contactIdentities.type }).from(contactIdentities).where(and(eq(contactIdentities.workspaceId, input.workspaceId), eq(contactIdentities.contactId, contact.id), eq(contactIdentities.type, conversation.channel))).limit(1))[0];
      const inbound = (await this.database.select({ providerMessageId: messages.providerMessageId }).from(messages).where(and(eq(messages.workspaceId, input.workspaceId), eq(messages.conversationId, conversation.id), eq(messages.direction, "inbound"))).orderBy(desc(messages.receivedAt), desc(messages.createdAt)).limit(1))[0];
      const body = stringValue(intent.body);
      if (!identity || !body || !CHANNELS.has(conversation.channel as ProspectingChannel)) return null;
      if (conversation.provider !== "unipile") return null;
      return { kind: "conversation_reply", provider: "unipile", accountId: conversation.providerAccountId, channel: conversation.channel as ProspectingChannel, recipient: { value: identity.value, normalizedValue: identity.normalizedValue, providerUserId: null }, subject: stringValue(intent.subject), body, conversationId: conversation.providerThreadId, replyToProviderMessageId: inbound?.providerMessageId ?? null };
    }
    if (input.kind === "content_publication") {
      const publication = (await this.database.select().from(contentPublications).where(and(eq(contentPublications.workspaceId, input.workspaceId), eq(contentPublications.id, input.aggregateId))).limit(1))[0];
      if (!publication || (publication.status !== "scheduled" && publication.status !== "retry")) return null;
      const asset = (await this.database.select({ id: contentAssets.id, status: contentAssets.status, latestVersion: contentAssets.latestVersion }).from(contentAssets).where(and(eq(contentAssets.workspaceId, input.workspaceId), eq(contentAssets.id, publication.assetId))).limit(1))[0];
      const assetVersion = (await this.database.select({ id: contentAssetVersions.id, version: contentAssetVersions.version }).from(contentAssetVersions).where(and(eq(contentAssetVersions.workspaceId, input.workspaceId), eq(contentAssetVersions.id, publication.assetVersionId), eq(contentAssetVersions.assetId, publication.assetId))).limit(1))[0];
      if (!asset || asset.status !== "ready" || !assetVersion || assetVersion.version !== asset.latestVersion) return null;
      const snapshot = asRecord(publication.contentSnapshot);
      const account = asRecord(publication.accountSnapshot);
      const text = stringValue(snapshot.text) ?? stringValue(snapshot.body);
      const accountId = stringValue(account.providerAccountId);
      if (publication.provider !== "unipile" || !text || !accountId) return null;
      const media = snapshot.media ?? snapshot.attachments;
      const attachments = media === undefined || media === null ? [] : Array.isArray(media) ? media : [media];
      return { kind: "content_publication", accountId, text, attachments };
    }
    const meeting = (await this.database.select().from(meetingProposals).where(and(eq(meetingProposals.workspaceId, input.workspaceId), eq(meetingProposals.id, input.aggregateId))).limit(1))[0];
    const offered = offeredSlotStart(meeting?.slots, numberValue(intent.slotPosition));
    const requestedSlotStart = stringValue(intent.slotStart);
    const hasRequestedSlotStart = Object.prototype.hasOwnProperty.call(intent, "slotStart");
    if (!meeting || meeting.status !== "offered" || !Number.isFinite(meeting.expiresAt.getTime()) || meeting.expiresAt.getTime() <= this.now().getTime() || !offered || hasRequestedSlotStart && (requestedSlotStart === null || requestedSlotStart !== offered)) return null;
    const slotStart = offered;
    const meetingTypeId = stringValue(intent.meetingTypeId);
    return { kind: "meeting_proposal", contactId: meeting.contactId, campaignId: meeting.campaignId, slotStart, expiresAt: meeting.expiresAt.toISOString(), ...(meetingTypeId ? { meetingTypeId } : {}) };
  }
}

function delivered(result: Record<string, unknown>): ExternalEffectExecutorResult {
  return { outcome: "delivered", authoritative: true, code: "DELIVERED", result: boundedRecord(result) };
}

function mapProviderError(error: unknown): ExternalEffectExecutorResult {
  if (error instanceof OutboundDeliveryError || error instanceof SocialProviderError) {
    return error.deliveryState === "unknown" ? { outcome: "unknown", code: error.code } : { outcome: "failed", code: error.code };
  }
  if (error instanceof CalendarIntegrationError && CALENDAR_DETERMINISTIC_FAILURE_CODES.has(error.code)) {
    return { outcome: "failed", code: error.code };
  }
  return { outcome: "unknown", code: "EFFECT_EXECUTOR_AMBIGUOUS" };
}

const CALENDAR_DETERMINISTIC_FAILURE_CODES = new Set([
  "CALENDAR_SLOT_INVALID",
  "CALENDAR_MEETING_TYPE_SELECTION_INVALID",
  "CALENDAR_EVENT_TYPE_NOT_CONFIGURED",
  "CALENDAR_ATTENDEE_EMAIL_MISSING",
  "CALENDAR_MEETING_TYPE_NOT_FOUND",
  "CALCOM_EVENT_TYPE_NOT_FOUND",
  "CALCOM_SLOT_UNAVAILABLE",
  "CALENDAR_AUTOMATION_NOT_CONFIGURED",
  "CALENDAR_CONNECTION_NOT_FOUND",
]);

function validRecipient(value: unknown): { value: string; normalizedValue: string; providerUserId: string | null } | null {
  const recipient = asRecord(value);
  const recipientValue = boundedText(recipient.value, MAX_ID_BYTES);
  const normalizedValue = boundedText(recipient.normalizedValue, MAX_ID_BYTES);
  const providerUserId = recipient.providerUserId === null ? null : boundedText(recipient.providerUserId, MAX_ID_BYTES);
  if (!recipientValue || !normalizedValue || (recipient.providerUserId !== null && !providerUserId)) return null;
  if (!recipientValue.trim() || !normalizedValue.trim()) return null;
  return { value: recipientValue, normalizedValue, providerUserId };
}

function boundedRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string") result[key] = nested.slice(0, MAX_ID_BYTES);
    else if (nested === null || typeof nested === "boolean" || typeof nested === "number") result[key] = nested;
  }
  return result;
}
function boundedText(value: unknown, max: number): string | null { return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).byteLength <= max ? value : null; }
function safeErrorCode(value: unknown): string { return value instanceof SocialProviderError || value instanceof OutboundDeliveryError ? value.code : "ADAPTER_UNAVAILABLE"; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_BYTES ? value : null; }
function numberValue(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null; }
function offeredSlotStart(value: unknown, position: number | null): string | null { const slots = Array.isArray(value) ? value : []; const slot = position ? asRecord(slots[position - 1]) : null; return stringValue(slot?.start) ?? stringValue(slot?.slotStart); }
