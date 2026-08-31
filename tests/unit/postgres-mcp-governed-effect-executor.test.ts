import { describe, expect, test } from "bun:test";
import { ExternalEffectAmbiguousError, type ExternalEffectExecutorInput } from "@outbound/application/mcp/external-effect-attempt";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";
import { CalendarIntegrationError } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import {
  PostgresMcpGovernedEffectExecutor,
  type ConversationExecutionSource,
  type McpGovernedEffectExecutionSource,
  type McpGovernedEffectSourceReader,
} from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-executor";

const identity = (kind: "conversation_reply" | "content_publication" | "meeting_proposal" | "campaign_activation") => ({
  workspaceId: "00000000-0000-4000-8000-000000000001",
  proposalId: "00000000-0000-4000-8000-000000000002",
  intentionId: "00000000-0000-4000-8000-000000000003",
  jobId: "00000000-0000-4000-8000-000000000004",
  kind,
  aggregateId: "00000000-0000-4000-8000-000000000005",
  correlationId: "corr",
  leaseToken: "00000000-0000-4000-8000-000000000006",
  leaseExpiresAt: new Date("2026-08-29T13:00:00.000Z"),
});

const marker = (kind: Parameters<typeof identity>[0]) => ({
  ...identity(kind),
  state: "started" as const,
  attempt: 1,
  sequence: 1,
  sourceEventId: "00000000-0000-4000-8000-000000000007",
  idempotencyKey: "mcp-effect:test:v1",
});

function sourceReader(source: McpGovernedEffectExecutionSource): McpGovernedEffectSourceReader {
  return { read: async () => source };
}

describe("Postgres governed-effect provider executor", () => {
  test("sends a bounded conversation reply through the existing gateway", async () => {
    const calls: unknown[] = [];
    const source: McpGovernedEffectExecutionSource = {
      kind: "conversation_reply", provider: "unipile",
      accountId: "account-1",
      channel: "email",
      recipient: { value: "person@example.test", normalizedValue: "person@example.test", providerUserId: null },
      subject: "Hello",
      body: "A bounded reply",
      conversationId: "provider-thread-1",
      replyToProviderMessageId: "message-1",
    };
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      outbound: {
        send: async (input) => {
          calls.push(input);
          return { providerRequestId: "request-1", conversationId: "provider-thread-1" };
        },
      },
    }, sourceReader(source));

    const result = await executor.execute({ identity: identity("conversation_reply"), marker: marker("conversation_reply") });
    expect(result).toEqual({ outcome: "delivered", authoritative: true, code: "DELIVERED", result: { providerRequestId: "request-1", conversationId: "provider-thread-1" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ accountId: "account-1", channel: "email", body: "A bounded reply", idempotencyKey: "mcp-effect:test:v1", conversationId: "provider-thread-1" });
  });

  test("maps ambiguous provider errors to unknown and never retries the mutation", async () => {
    const source: McpGovernedEffectExecutionSource = {
      kind: "content_publication", accountId: "account-1", text: "Post text", attachments: [],
    };
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      publisher: {
        observeCapabilities: async () => ({ network: "linkedin", accountId: "account-1", accountHealthy: true, textPublishing: "available", observedAt: new Date() }),
        publishText: async () => { throw new Error("timeout"); },
      },
    }, sourceReader(source));

    await expect(executor.execute({ identity: identity("content_publication"), marker: marker("content_publication") })).resolves.toEqual({
      outcome: "unknown", code: "EFFECT_EXECUTOR_AMBIGUOUS",
    });
  });

  test("carries a bounded provider reference as internal reconciliation criteria", async () => {
    const source: McpGovernedEffectExecutionSource = {
      kind: "content_publication", accountId: "account-1", text: "Post text", attachments: [],
    };
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      publisher: {
        observeCapabilities: async () => ({ network: "linkedin", accountId: "account-1", accountHealthy: true, textPublishing: "available", observedAt: new Date() }),
        publishText: async () => {
          throw new ExternalEffectAmbiguousError("SOCIAL_PROVIDER_UNAVAILABLE", "post-1");
        },
      },
    }, sourceReader(source));

    await expect(executor.execute({ identity: identity("content_publication"), marker: marker("content_publication") })).resolves.toEqual({
      outcome: "unknown", code: "SOCIAL_PROVIDER_UNAVAILABLE", reconciliationCriteria: { providerPostId: "post-1" },
    });
  });

  test("publishes content only with a proven text adapter and bounded evidence", async () => {
    let calls = 0;
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      publisher: {
        observeCapabilities: async () => ({ network: "linkedin", accountId: "account-1", accountHealthy: true, textPublishing: "available", observedAt: new Date() }),
        publishText: async (input) => {
          calls += 1;
          expect(input).toMatchObject({ accountId: "account-1", text: "Post text", requestKey: "mcp-effect:test:v1" });
          return { providerPostId: "post-1", socialId: "social-1", url: "https://example.test/post-1", publishedAt: new Date("2026-08-29T12:00:00.000Z") };
        },
      },
    }, sourceReader({ kind: "content_publication", accountId: "account-1", text: "Post text", attachments: [] }));
    await expect(executor.execute({ identity: identity("content_publication"), marker: marker("content_publication") })).resolves.toMatchObject({ outcome: "delivered", authoritative: true, result: { providerPostId: "post-1" } });
    expect(calls).toBe(1);
  });

  test("books only the authoritative offered meeting slot", async () => {
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      calendar: {
        resolve: async () => null,
        schedulingContext: async () => ({ status: "ready", bookingUrl: null, timeZone: "UTC", canBook: true, slots: [] }),
        book: async (input) => {
          expect(input).toMatchObject({ workspaceId: identity("meeting_proposal").workspaceId, contactId: "contact-1", start: "2026-08-29T13:00:00.000Z" });
          return { bookingId: "booking-1", start: input.start, end: "2026-08-29T14:00:00.000Z", meetingUrl: "https://example.test/meeting", label: "Meeting" };
        },
        reschedule: async () => { throw new Error("not used"); },
        cancel: async () => { throw new Error("not used"); },
      },
    }, sourceReader({ kind: "meeting_proposal", contactId: "contact-1", campaignId: null, slotStart: "2026-08-29T13:00:00.000Z", expiresAt: "2026-08-29T14:00:00.000Z" }), () => new Date("2026-08-29T12:00:00.000Z"));
    await expect(executor.execute({ identity: identity("meeting_proposal"), marker: marker("meeting_proposal") })).resolves.toMatchObject({ outcome: "delivered", authoritative: true, result: { bookingId: "booking-1" } });
  });

  test("maps deterministic calendar validation and availability errors to failed", async () => {
    const codes = [
      "CALENDAR_SLOT_INVALID",
      "CALENDAR_EVENT_TYPE_NOT_CONFIGURED",
      "CALENDAR_ATTENDEE_EMAIL_MISSING",
      "CALENDAR_MEETING_TYPE_NOT_FOUND",
      "CALCOM_SLOT_UNAVAILABLE",
      "CALENDAR_AUTOMATION_NOT_CONFIGURED",
    ];
    for (const code of codes) {
      let calls = 0;
      const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
        calendar: {
          resolve: async () => null,
          schedulingContext: async () => ({ status: "ready", bookingUrl: null, timeZone: "UTC", canBook: true, slots: [] }),
          book: async () => {
            calls += 1;
            throw new CalendarIntegrationError(code, 422);
          },
          reschedule: async () => { throw new Error("not used"); },
          cancel: async () => { throw new Error("not used"); },
        },
      }, sourceReader({ kind: "meeting_proposal", contactId: "contact-1", campaignId: null, slotStart: "2026-08-29T13:00:00.000Z", expiresAt: "2026-08-29T14:00:00.000Z" }), () => new Date("2026-08-29T12:00:00.000Z"));
      await expect(executor.execute({ identity: identity("meeting_proposal"), marker: marker("meeting_proposal") })).resolves.toEqual({ outcome: "failed", code });
      expect(calls).toBe(1);
    }
  });

  test("rejects an offered meeting at or beyond its expiry before booking", async () => {
    let calls = 0;
    const calendar = {
      resolve: async () => null,
      schedulingContext: async () => ({ status: "ready" as const, bookingUrl: null, timeZone: "UTC", canBook: true, slots: [] }),
      book: async () => { calls += 1; throw new Error("must not be called"); },
      reschedule: async () => { throw new Error("not used"); },
      cancel: async () => { throw new Error("not used"); },
    };
    const clock = () => new Date("2026-08-29T12:00:00.000Z");
    for (const expiresAt of ["2026-08-29T12:00:00.000Z", "2026-08-29T11:59:59.999Z"]) {
      const executor = new PostgresMcpGovernedEffectExecutor({} as never, { calendar }, sourceReader({
        kind: "meeting_proposal", contactId: "contact-1", campaignId: null,
        slotStart: "2026-08-29T13:00:00.000Z", expiresAt,
      }), clock);
      await expect(executor.execute({ identity: identity("meeting_proposal"), marker: marker("meeting_proposal") })).resolves.toEqual({ outcome: "failed", code: "SOURCE_STALE" });
    }
    expect(calls).toBe(0);
  });

  test("rejects malformed conversation recipients before outbound send", async () => {
    const valid: ConversationExecutionSource = {
      kind: "conversation_reply", provider: "unipile", accountId: "account-1", channel: "email",
      recipient: { value: "person@example.test", normalizedValue: "person@example.test", providerUserId: null },
      subject: null, body: "reply", conversationId: null, replyToProviderMessageId: null,
    };
    const invalidRecipients: unknown[] = [
      null,
      { value: "", normalizedValue: "person@example.test", providerUserId: null },
      { value: "   ", normalizedValue: "person@example.test", providerUserId: null },
      { value: "a".repeat(501), normalizedValue: "a@example.test", providerUserId: null },
      { value: "person@example.test", normalizedValue: "   ", providerUserId: null },
      { value: "person@example.test", normalizedValue: "person@example.test", providerUserId: 42 },
      { normalizedValue: "person@example.test", providerUserId: null },
    ];
    let calls = 0;
    let currentSource: McpGovernedEffectExecutionSource = valid;
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      outbound: { send: async () => { calls += 1; return { providerRequestId: "unexpected", conversationId: null }; } },
    }, {
      read: async () => currentSource,
    });
    for (const recipient of invalidRecipients) {
      const source = { ...valid, recipient } as unknown as McpGovernedEffectExecutionSource;
      currentSource = source;
      const rejected = await executor.execute({ identity: identity("conversation_reply"), marker: marker("conversation_reply") });
      expect(rejected).toEqual({ outcome: "failed", code: "EFFECT_RECIPIENT_INVALID" });
    }
    expect(calls).toBe(0);
  });

  test("maps deterministic provider refusal to failed without retry", async () => {
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      outbound: { send: async () => { throw new OutboundDeliveryError("OUTBOUND_REFUSED", "refused", "not_sent", false); } },
    }, sourceReader({ kind: "conversation_reply", provider: "unipile", accountId: "account-1", channel: "email", recipient: { value: "a@example.test", normalizedValue: "a@example.test", providerUserId: null }, subject: null, body: "reply", conversationId: null, replyToProviderMessageId: null }));
    await expect(executor.execute({ identity: identity("conversation_reply"), marker: marker("conversation_reply") })).resolves.toEqual({ outcome: "failed", code: "OUTBOUND_REFUSED" });
  });

  test("never treats a provider response without its authoritative identifier as delivered", async () => {
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      publisher: {
        observeCapabilities: async () => ({ network: "linkedin", accountId: "account-1", accountHealthy: true, textPublishing: "available", observedAt: new Date() }),
        publishText: async () => ({ providerPostId: "", socialId: null, url: null, publishedAt: null }),
      },
    }, sourceReader({ kind: "content_publication", accountId: "account-1", text: "post", attachments: [] }));
    await expect(executor.execute({ identity: identity("content_publication"), marker: marker("content_publication") })).resolves.toEqual({ outcome: "unknown", code: "EFFECT_PROVIDER_RESPONSE_INVALID" });
  });

  test("keeps campaign activation unavailable and does not touch providers", async () => {
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      outbound: { send: async () => { throw new Error("must not be called"); } },
      publisher: { observeCapabilities: async () => { throw new Error("must not be called"); }, publishText: async () => { throw new Error("must not be called"); } },
    }, sourceReader({ kind: "campaign_activation" }));
    await expect(executor.execute({ identity: identity("campaign_activation"), marker: marker("campaign_activation") })).resolves.toEqual({ outcome: "failed", code: "ADAPTER_UNAVAILABLE" });
  });

  test("returns read-only error when no proven read adapter exists", async () => {
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {}, sourceReader({
      kind: "conversation_reply", provider: "unipile",
      accountId: "account-1",
      channel: "email",
      recipient: { value: "person@example.test", normalizedValue: "person@example.test", providerUserId: null },
      subject: null,
      body: "reply",
      conversationId: "thread-1",
      replyToProviderMessageId: null,
    }));
    await expect(executor.reconcileReadOnly({
      workspaceId: identity("conversation_reply").workspaceId,
      proposalId: identity("conversation_reply").proposalId,
      intentionId: identity("conversation_reply").intentionId,
      kind: "conversation_reply",
      aggregateId: identity("conversation_reply").aggregateId,
      correlationId: "corr",
      reconciliationId: "00000000-0000-4000-8000-000000000008",
      criteriaSnapshot: {},
    })).resolves.toEqual({ outcome: "error", code: "ADAPTER_UNAVAILABLE" });
  });

  test("reconciles content with the read-only provider feed and never publishes", async () => {
    let publishCalls = 0;
    let readCalls = 0;
    const executor = new PostgresMcpGovernedEffectExecutor({} as never, {
      publisher: {
        observeCapabilities: async () => ({ network: "linkedin", accountId: "account-1", accountHealthy: true, textPublishing: "available", observedAt: new Date() }),
        publishText: async () => { publishCalls += 1; return { providerPostId: "unexpected", socialId: null, url: null, publishedAt: null }; },
      },
      socialContentReader: {
        listOwnContent: async () => {
          readCalls += 1;
          return { data: [{ providerPostId: "post-1", socialId: "social-1", authorProviderId: null, text: "ignored", url: null, publishedAt: null, observedAt: new Date() }], nextCursor: null };
        },
      },
    }, sourceReader({ kind: "content_publication", accountId: "account-1", text: "post", attachments: [] }));
    const result = await executor.reconcileReadOnly({
      workspaceId: identity("content_publication").workspaceId,
      proposalId: identity("content_publication").proposalId,
      intentionId: identity("content_publication").intentionId,
      kind: "content_publication",
      aggregateId: identity("content_publication").aggregateId,
      correlationId: "corr",
      reconciliationId: "00000000-0000-4000-8000-000000000008",
      criteriaSnapshot: { providerPostId: "post-1" },
    });
    expect(result).toMatchObject({ outcome: "matched", authoritative: true, candidateCount: 1, result: { providerPostId: "post-1" } });
    expect(readCalls).toBe(1);
    expect(publishCalls).toBe(0);
  });
});
