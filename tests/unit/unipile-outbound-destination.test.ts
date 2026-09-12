import { expect, test } from "bun:test";
import { UnipileOutboundChannelGateway } from "@outbound/infrastructure/campaigns/unipile-outbound-channel-gateway";
import type { OutboundSendRequest } from "@outbound/application/campaigns/outbound-channel-gateway";

const request: OutboundSendRequest = { accountId: "account-a", channel: "linkedin", stepKind: "linkedin_message", recipient: { value: "https://www.linkedin.com/in/crm-alice", normalizedValue: "linkedin.com/in/crm-alice", providerUserId: null }, subject: null, body: "Synthetic controlled message", idempotencyKey: "synthetic-destination", conversationId: "chat-a" };
function fixture(participant = "provider-alice", account = "account-a", extra = false) {
  const calls: { method: string; url: string }[] = [];
  const gateway = new UnipileOutboundChannelGateway({ dsn: "https://fixture.invalid", apiKey: "fixture", fetchImpl: (async (input: unknown, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET"; calls.push({ method, url });
    if (method === "POST") return Response.json({ id: "unipile-message", provider_id: "upstream-message", chat_id: "chat-a" });
    if (url.includes("/users/")) return Response.json({ provider_id: "provider-alice" });
    if (url.endsWith("/attendees")) return Response.json({ items: [{ provider_id: participant, is_self: false }, { provider_id: "self", is_self: true }, ...(extra ? [{ provider_id: "third-party", is_self: false }] : [])], cursor: null });
    return Response.json({ id: "chat-a", account_id: account });
  }) as unknown as typeof fetch });
  return { gateway, calls };
}
test.each([["provider-bob", "account-a", false], ["provider-alice", "account-b", false], ["provider-alice", "account-a", true]] as const)("blocks thread destination mismatch before mutation (%s, %s, %s)", async (participant, account, extra) => {
  const h = fixture(participant, account, extra);
  await expect(h.gateway.send(request)).rejects.toMatchObject({ code: "LINKEDIN_THREAD_RECIPIENT_MISMATCH", deliveryState: "not_sent" });
  expect(h.calls.filter(call => call.method === "POST")).toHaveLength(0);
});
test("verifies the CRM profile and sole external attendee before sending to an existing thread", async () => {
  const h = fixture();
  const result = await h.gateway.send(request);
  expect(h.calls[0]?.url).toContain("/users/crm-alice?account_id=account-a");
  expect(h.calls.filter(call => call.method === "GET")).toHaveLength(3);
  expect(h.calls.filter(call => call.method === "POST")).toHaveLength(1);
  expect(result.providerRequestId).toBe("unipile-message");
});
test("never invents confirmation when a successful HTTP response omits message identity", async () => {
  const gateway = new UnipileOutboundChannelGateway({ dsn: "https://fixture.invalid", apiKey: "fixture", fetchImpl: (async () => Response.json({})) as unknown as typeof fetch });
  await expect(gateway.send({ ...request, channel: "email", stepKind: "email", subject: "Synthetic", conversationId: null, recipient: { value: "test@example.com", normalizedValue: "test@example.com", providerUserId: null } })).rejects.toMatchObject({ code: "UNIPILE_RESPONSE_ID_MISSING", deliveryState: "unknown", retryable: false });
});

test("resolves a local Unipile email id to its upstream reply id without conflating them", async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const gateway = new UnipileOutboundChannelGateway({ dsn: "https://fixture.invalid", apiKey: "fixture", fetchImpl: (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(init?.method === "GET" ? { id: "local-email", provider_id: "upstream-email", account_id: "account-a" } : { id: "local-sent", provider_id: "upstream-sent" });
  }) as unknown as typeof fetch });
  const result = await gateway.send({ ...request, channel: "email", stepKind: "email", subject: "Synthetic", replyToUnipileMessageId: "local-email", recipient: { value: "test@example.com", normalizedValue: "test@example.com", providerUserId: null } });
  expect(calls[0]).toMatchObject({ method: "GET", url: "https://fixture.invalid/api/v1/emails/local-email" });
  expect(calls[1]?.body).toMatchObject({ reply_to: "upstream-email" });
  expect(result.providerRequestId).toBe("local-sent");
});

test("a failed LinkedIn verification does not prevent an independent email send", async () => {
  const h = fixture("wrong-recipient");
  const results = await Promise.allSettled([h.gateway.send(request), h.gateway.send({ ...request, channel: "email", stepKind: "email", subject: "Synthetic email", conversationId: null, recipient: { value: "test@example.com", normalizedValue: "test@example.com", providerUserId: null } })]);
  expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled"]);
  expect(h.calls.filter(call => call.method === "POST").map(call => call.url)).toEqual(["https://fixture.invalid/api/v1/emails"]);
});

test.each([
  { id: "other-email", provider_id: "upstream-email", account_id: "account-a" },
  { id: "local-email", provider_id: "upstream-email", account_id: "account-b" },
  { id: "local-email", provider_id: "", account_id: "account-a" },
])("rejects an unverified email reply identity before sending (%j)", async (original) => {
  const methods: string[] = [];
  const gateway = new UnipileOutboundChannelGateway({ dsn: "https://fixture.invalid", apiKey: "fixture", fetchImpl: (async (_input: unknown, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    return Response.json(original);
  }) as unknown as typeof fetch });
  await expect(gateway.send({ ...request, channel: "email", stepKind: "email", subject: "Synthetic", replyToUnipileMessageId: "local-email" })).rejects.toMatchObject({ code: "EMAIL_REPLY_ID_MISMATCH", deliveryState: "not_sent", retryable: false });
  expect(methods).toEqual(["GET"]);
});

test("a failed read preflight remains not_sent even when the provider response is ambiguous", async () => {
  const methods: string[] = [];
  const gateway = new UnipileOutboundChannelGateway({ dsn: "https://fixture.invalid", apiKey: "fixture", fetchImpl: (async (_input: unknown, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    return new Response("temporary failure", { status: 503 });
  }) as unknown as typeof fetch });
  await expect(gateway.send(request)).rejects.toMatchObject({ code: "LINKEDIN_RECIPIENT_VERIFICATION_FAILED", deliveryState: "not_sent" });
  expect(methods).toEqual(["GET"]);
});
