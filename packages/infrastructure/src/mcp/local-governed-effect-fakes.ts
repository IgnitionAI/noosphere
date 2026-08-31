import type { OutboundChannelGateway, OutboundSendRequest, OutboundSendResult } from "@outbound/application/campaigns/outbound-channel-gateway";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";
import type { McpGovernedEffectKind } from "@outbound/application/mcp/mcp-governed-effects";
import { ExternalEffectAmbiguousError } from "@outbound/application/mcp/external-effect-attempt";
import type { McpGovernedEffectProviderAdapters } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-executor";
import type { CalendarSchedulingContext, WorkspaceCalendarScheduler } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { CalendarIntegrationError } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import type {
  SocialContentReader,
  SocialPublishTextRequest,
  SocialPublisher,
  SocialPublisherCapabilities,
  SocialPublishResult,
} from "@outbound/application/content/social-ports";
import { SocialProviderError } from "@outbound/application/content/social-ports";

export type LocalFakeKind = McpGovernedEffectKind;

export interface LocalFakeOutcome {
  readonly kind: "success" | "failure" | "ambiguous";
  readonly safeCode: string;
  /** Opaque, bounded reference used only as a deterministic fake result. */
  readonly providerReference?: string;
}

export interface LocalFakeCounters {
  conversationReply: number;
  contentPublication: number;
  meetingProposal: number;
  campaignActivation: number;
}

export interface LocalFakeOptions {
  readonly mode: "local-fake";
  readonly allowNetwork: false;
  readonly outcomes: Readonly<{ [K in LocalFakeKind]: LocalFakeOutcome }>;
  readonly counters: LocalFakeCounters;
}

export interface LocalFakeAdapters {
  readonly adapters: McpGovernedEffectProviderAdapters;
  readonly counters: Readonly<LocalFakeCounters>;
  outcomeFor(kind: LocalFakeKind): LocalFakeOutcome;
}

const LOCAL_FAKE_KINDS: readonly LocalFakeKind[] = [
  "conversation_reply",
  "content_publication",
  "meeting_proposal",
  "campaign_activation",
];
const SAFE_CODE = /^[A-Z0-9][A-Z0-9_:-]{0,79}$/;
const OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SAFE_TEXT_BYTES = 32_000;
const SAFE_ID_BYTES = 500;
const MAX_COUNTER_VALUE = 1_000_000_000;
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

let activeCounterRegistry: MutableLocalFakeCounters | null = null;

type MutableLocalFakeCounters = LocalFakeCounters;

/**
 * Select local fakes only when explicitly enabled outside production. Any
 * other value is rejected so a typo cannot silently select a fake adapter.
 */
export function resolveLocalFakeMode(environment: NodeJS.ProcessEnv): boolean {
  const configured = environment.MCP_LOCAL_FAKE_EFFECTS;
  if (configured === undefined || configured === "false") return false;
  if (configured !== "true") throw new Error("MCP_LOCAL_FAKE_CONFIG_INVALID");
  if (environment.NODE_ENV === "production") throw new Error("MCP_LOCAL_FAKE_DISABLED_IN_PRODUCTION");
  return true;
}

/** Return the latest process-local counter view without exposing request data. */
export function getLocalFakeCounters(): Readonly<LocalFakeCounters> {
  if (!activeCounterRegistry) throw new Error("MCP_LOCAL_FAKE_COUNTERS_UNAVAILABLE");
  return counterView(activeCounterRegistry);
}

/** Explicitly release the one-instance counter registry between local runs/tests. */
export function resetLocalFakeCounters(): void {
  activeCounterRegistry = null;
}

/** Build strictly local implementations of the existing outbound ports. */
export function createLocalGovernedEffectFakes(options: LocalFakeOptions): LocalFakeAdapters {
  if (!options || typeof options !== "object" || options.mode !== "local-fake") throw new Error("MCP_LOCAL_FAKE_CONFIG_INVALID");
  if (options.allowNetwork !== false) throw new Error("MCP_LOCAL_FAKE_NETWORK_DISABLED");
  if (activeCounterRegistry) throw new Error("MCP_LOCAL_FAKE_REGISTRY_ALREADY_INITIALIZED");
  if (!options.outcomes || typeof options.outcomes !== "object") throw new Error("MCP_LOCAL_FAKE_OUTCOME_INVALID");
  const outcomes = {} as { [K in LocalFakeKind]: LocalFakeOutcome };
  for (const kind of LOCAL_FAKE_KINDS) {
    validateOutcome(options.outcomes[kind], kind);
    outcomes[kind] = cloneAndFreeze(options.outcomes[kind]);
  }
  validateCounters(options.counters);
  const counters: MutableLocalFakeCounters = { ...options.counters };

  const outcomeFor = (kind: LocalFakeKind): LocalFakeOutcome => {
    if (!LOCAL_FAKE_KINDS.includes(kind)) throw new Error("MCP_LOCAL_FAKE_KIND_INVALID");
    return outcomes[kind];
  };
  const adapters: McpGovernedEffectProviderAdapters = {
    outbound: createOutboundFake(outcomeFor, counters),
    publisher: createPublisherFake(outcomeFor, counters),
    socialContentReader: createSocialContentReaderFake(outcomeFor),
    calendar: createCalendarFake(outcomeFor, counters),
  };
  activeCounterRegistry = counters;
  return { adapters, counters: counterView(counters), outcomeFor };
}

function createOutboundFake(
  outcomeFor: (kind: LocalFakeKind) => LocalFakeOutcome,
  counters: MutableLocalFakeCounters,
): OutboundChannelGateway {
  return {
    async send(input: OutboundSendRequest): Promise<OutboundSendResult> {
      if (!isBoundedText(input.accountId, SAFE_ID_BYTES) || !isBoundedText(input.body, SAFE_TEXT_BYTES) || !isBoundedText(input.idempotencyKey, SAFE_ID_BYTES) || !validRecipient(input.recipient)) {
        throw new OutboundDeliveryError("MCP_LOCAL_FAKE_INPUT_INVALID", "MCP_LOCAL_FAKE_INPUT_INVALID", "not_sent", false);
      }
      const outcome = outcomeFor("conversation_reply");
      counters.conversationReply += 1;
      if (outcome.kind !== "success") {
        throw new OutboundDeliveryError(outcome.safeCode, outcome.safeCode, outcome.kind === "ambiguous" ? "unknown" : "not_sent", false);
      }
      return { providerRequestId: outcome.providerReference ?? `fake-message-${counters.conversationReply}`, conversationId: null };
    },
  };
}

function createPublisherFake(
  outcomeFor: (kind: LocalFakeKind) => LocalFakeOutcome,
  counters: MutableLocalFakeCounters,
): SocialPublisher {
  return {
    async observeCapabilities(input): Promise<SocialPublisherCapabilities> {
      if (!isBoundedText(input.accountId, SAFE_ID_BYTES)) throw new SocialProviderError("SOCIAL_PROVIDER_RESPONSE_INVALID", "MCP_LOCAL_FAKE_INPUT_INVALID", "not_sent", false);
      return {
        network: "linkedin",
        accountId: input.accountId,
        accountHealthy: true,
        textPublishing: "available",
        observedAt: input.now ?? new Date(0),
      };
    },
    async publishText(input: SocialPublishTextRequest): Promise<SocialPublishResult> {
      if (!isBoundedText(input.accountId, SAFE_ID_BYTES) || !isBoundedText(input.text, SAFE_TEXT_BYTES) || !isBoundedText(input.requestKey, SAFE_ID_BYTES)) {
        throw new SocialProviderError("SOCIAL_PROVIDER_RESPONSE_INVALID", "MCP_LOCAL_FAKE_INPUT_INVALID", "not_sent", false);
      }
      const outcome = outcomeFor("content_publication");
      counters.contentPublication += 1;
      if (outcome.kind !== "success") {
        if (outcome.kind === "ambiguous" && outcome.providerReference) {
          throw new ExternalEffectAmbiguousError(outcome.safeCode, outcome.providerReference);
        }
        throw new SocialProviderError(outcome.safeCode as never, outcome.safeCode, outcome.kind === "ambiguous" ? "unknown" : "not_sent", false);
      }
      return { providerPostId: outcome.providerReference ?? `fake-post-${counters.contentPublication}`, socialId: null, url: null, publishedAt: null };
    },
  };
}

function createSocialContentReaderFake(
  outcomeFor: (kind: LocalFakeKind) => LocalFakeOutcome,
): SocialContentReader {
  return {
    async listOwnContent(input) {
      if (!isBoundedText(input.accountId, SAFE_ID_BYTES) || input.cursor !== null || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new SocialProviderError("SOCIAL_PROVIDER_RESPONSE_INVALID", "MCP_LOCAL_FAKE_INPUT_INVALID", "not_sent", false);
      }
      const outcome = outcomeFor("content_publication");
      if (outcome.kind === "failure") return { data: [], nextCursor: null };
      const providerPostId = outcome.providerReference ?? "fake-post-1";
      const snapshot = {
        providerPostId,
        socialId: null,
        authorProviderId: null,
        text: "local fake content",
        url: null,
        publishedAt: new Date(0),
        observedAt: new Date(0),
      };
      return { data: outcome.kind === "ambiguous" ? [snapshot, { ...snapshot }] : [snapshot], nextCursor: null };
    },
  };
}

function createCalendarFake(
  outcomeFor: (kind: LocalFakeKind) => LocalFakeOutcome,
  counters: MutableLocalFakeCounters,
): WorkspaceCalendarScheduler {
  const unavailableContext = async (): Promise<CalendarSchedulingContext> => ({
    status: "unavailable",
    bookingUrl: null,
    timeZone: "UTC",
    canBook: false,
    slots: [],
  });
  return {
    resolve: async () => null,
    schedulingContext: unavailableContext,
    async book(input) {
      if (!isBoundedText(input.workspaceId, SAFE_ID_BYTES) || !isBoundedText(input.contactId, SAFE_ID_BYTES) || !isBoundedText(input.start, SAFE_ID_BYTES)) {
        throw new CalendarIntegrationError("MCP_LOCAL_FAKE_INPUT_INVALID", 422);
      }
      const outcome = outcomeFor("meeting_proposal");
      counters.meetingProposal += 1;
      if (outcome.kind === "failure") {
        if (!CALENDAR_DETERMINISTIC_FAILURE_CODES.has(outcome.safeCode)) {
          throw new CalendarIntegrationError("MCP_LOCAL_FAKE_INPUT_INVALID", 422);
        }
        throw new CalendarIntegrationError(outcome.safeCode, 422);
      }
      if (outcome.kind === "ambiguous") {
        const error = Object.assign(new Error(outcome.safeCode), { code: outcome.safeCode });
        throw error;
      }
      return { bookingId: outcome.providerReference ?? `fake-booking-${counters.meetingProposal}`, start: input.start, end: input.start, meetingUrl: null, label: "Local fake meeting" };
    },
    async reschedule() { throw new CalendarIntegrationError("MCP_LOCAL_FAKE_UNAVAILABLE", 409); },
    async cancel() { throw new CalendarIntegrationError("MCP_LOCAL_FAKE_UNAVAILABLE", 409); },
  };
}

function validateOutcome(outcome: LocalFakeOutcome, effectKind: LocalFakeKind): void {
  if (!outcome || typeof outcome !== "object" || !hasOnlyOutcomeKeys(outcome) || (outcome.kind !== "success" && outcome.kind !== "failure" && outcome.kind !== "ambiguous") || typeof outcome.safeCode !== "string" || !SAFE_CODE.test(outcome.safeCode) || (outcome.providerReference !== undefined && (typeof outcome.providerReference !== "string" || !OPAQUE_REFERENCE.test(outcome.providerReference))) || effectKind === "meeting_proposal" && outcome.kind === "failure" && !CALENDAR_DETERMINISTIC_FAILURE_CODES.has(outcome.safeCode)) {
    throw new Error("MCP_LOCAL_FAKE_OUTCOME_INVALID");
  }
}

function validateCounters(counters: LocalFakeCounters): void {
  const expected = ["campaignActivation", "contentPublication", "conversationReply", "meetingProposal"];
  const ownNames = counters && Object.getOwnPropertyNames(counters).sort();
  if (!counters || !ownNames || ownNames.length !== expected.length || ownNames.some((key, index) => key !== expected[index]) || Object.getOwnPropertySymbols(counters).length > 0 || expected.some((key) => {
    const value = counters[key as keyof LocalFakeCounters];
    return !Number.isSafeInteger(value) || value < 0 || value > MAX_COUNTER_VALUE;
  })) throw new Error("MCP_LOCAL_FAKE_COUNTERS_INVALID");
}

function hasOnlyOutcomeKeys(value: LocalFakeOutcome): boolean {
  const keys = Reflect.ownKeys(value).map(String).sort();
  const expected = value.providerReference === undefined ? ["kind", "safeCode"] : ["kind", "providerReference", "safeCode"];
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function cloneAndFreeze<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key));
  return Object.freeze(value);
}

function counterView(counters: MutableLocalFakeCounters): Readonly<LocalFakeCounters> {
  const view = {} as LocalFakeCounters;
  for (const key of Object.keys(counters) as (keyof LocalFakeCounters)[]) {
    Object.defineProperty(view, key, { enumerable: true, get: () => counters[key] });
  }
  return Object.freeze(view);
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).byteLength <= maxBytes;
}

function validRecipient(value: OutboundSendRequest["recipient"]): boolean {
  return isBoundedText(value.value, SAFE_ID_BYTES) && isBoundedText(value.normalizedValue, SAFE_ID_BYTES) && (value.providerUserId === null || isBoundedText(value.providerUserId, SAFE_ID_BYTES));
}
