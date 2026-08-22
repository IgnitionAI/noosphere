import { describe, expect, test } from "bun:test";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";
import { UnipileOutboundChannelGateway } from "@outbound/infrastructure/campaigns/unipile-outbound-channel-gateway";

describe("UnipileOutboundChannelGateway", () => {
  test("sends a LinkedIn invitation with the provider user id", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const gateway = new UnipileOutboundChannelGateway({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret",
      fetchImpl: fakeFetch((url, init) => {
        calls.push({ url, init });
        return Response.json({ id: "invite_1" }, { status: 201 });
      }),
    });
    const result = await gateway.send({
      accountId: "acc_li",
      channel: "linkedin",
      stepKind: "linkedin_invite",
      recipient: {
        value: "https://linkedin.com/in/marie",
        normalizedValue: "linkedin.com/in/marie",
        providerUserId: "provider_marie",
      },
      subject: null,
      body: "Bonjour Marie",
      idempotencyKey: "action-1",
    });
    expect(calls[0]?.url).toBe("https://api37.unipile.com:16796/api/v1/users/invite");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      account_id: "acc_li",
      provider_id: "provider_marie",
      message: "Bonjour Marie",
    });
    expect(result.providerRequestId).toBe("invite_1");
  });

  test("sends email through the Unipile email endpoint with a trace header", async () => {
    let body: Record<string, unknown> = {};
    const gateway = new UnipileOutboundChannelGateway({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret",
      fetchImpl: fakeFetch((_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ id: "email_1" }, { status: 201 });
      }),
    });
    await gateway.send({
      accountId: "acc_mail",
      channel: "email",
      stepKind: "email",
      recipient: {
        value: "marie@example.com",
        normalizedValue: "marie@example.com",
        providerUserId: null,
      },
      subject: "Un sujet",
      body: "Bonjour Marie",
      idempotencyKey: "action-email-1",
    });
    expect(body).toMatchObject({
      account_id: "acc_mail",
      subject: "Un sujet",
      to: [{ identifier: "marie@example.com" }],
      custom_headers: [{ name: "Content-Type" }, { name: "X-Ignition-Outbound-Action", value: "action-email-1" }],
    });
  });

  test("waits for a LinkedIn invitation to be accepted before starting the follow-up chat", async () => {
    const calls: string[] = [];
    const gateway = new UnipileOutboundChannelGateway({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret",
      fetchImpl: fakeFetch((url) => {
        calls.push(url);
        return Response.json({ provider_id: "provider_marie", is_relationship: false, network_distance: "SECOND_DEGREE" });
      }),
    });

    const error = await gateway.send({
      accountId: "acc_li",
      channel: "linkedin",
      stepKind: "linkedin_message",
      recipient: { value: "Marie", normalizedValue: "marie", providerUserId: "provider_marie" },
      subject: null,
      body: "Merci pour la connexion",
      idempotencyKey: "action-follow-up",
    }).catch((caught) => caught);

    expect(calls).toEqual(["https://api37.unipile.com:16796/api/v1/users/provider_marie?account_id=acc_li"]);
    expect(error).toMatchObject({ code: "LINKEDIN_RELATION_PENDING", deliveryState: "not_sent", retryable: true });
  });

  test("starts the LinkedIn follow-up chat after the relationship is confirmed", async () => {
    const calls: string[] = [];
    const gateway = new UnipileOutboundChannelGateway({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret",
      fetchImpl: fakeFetch((url) => {
        calls.push(url);
        return url.includes("/users/")
          ? Response.json({ provider_id: "provider_marie", is_relationship: true, network_distance: "FIRST_DEGREE" })
          : Response.json({ id: "message-1", chat_id: "chat-1" }, { status: 201 });
      }),
    });

    const result = await gateway.send({
      accountId: "acc_li",
      channel: "linkedin",
      stepKind: "linkedin_message",
      recipient: { value: "Marie", normalizedValue: "marie", providerUserId: "provider_marie" },
      subject: null,
      body: "Merci pour la connexion",
      idempotencyKey: "action-follow-up-ready",
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe("https://api37.unipile.com:16796/api/v1/chats");
    expect(result).toMatchObject({ providerRequestId: "message-1", conversationId: "chat-1" });
  });

  test("retries connection failures that are known to happen before delivery", async () => {
    const gateway = new UnipileOutboundChannelGateway({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret",
      fetchImpl: (async () => {
        throw new TypeError("Unable to connect. Is the computer able to access the url?");
      }) as unknown as typeof fetch,
    });

    const error = await gateway.send({
      accountId: "acc_li",
      channel: "linkedin",
      stepKind: "linkedin_invite",
      recipient: {
        value: "https://linkedin.com/in/marie",
        normalizedValue: "linkedin.com/in/marie",
        providerUserId: "provider_marie",
      },
      subject: null,
      body: "Bonjour Marie",
      idempotencyKey: "action-network-retry",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(OutboundDeliveryError);
    expect(error).toMatchObject({
      code: "UNIPILE_NETWORK_NOT_SENT",
      deliveryState: "not_sent",
      retryable: true,
    });
  });

  test("treats a provider usage limit returned as 422 as safely retryable", async () => {
    const gateway = new UnipileOutboundChannelGateway({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      fetchImpl: (async () => Response.json({
        status: 422,
        type: "errors/limit_exceeded",
        title: "Limit exceeded",
        detail: "You have reached the usage limit set by the provider for the current period.",
      }, { status: 422 })) as unknown as typeof fetch,
    });

    const error = await gateway.send({
      accountId: "linkedin-account",
      channel: "linkedin",
      stepKind: "linkedin_invite",
      recipient: {
        value: "Marie Durand",
        normalizedValue: "linkedin.com/in/marie-durand",
        providerUserId: "provider-marie",
      },
      subject: null,
      body: "Bonjour Marie",
      idempotencyKey: "limit:test",
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "UNIPILE_PROVIDER_LIMIT",
      deliveryState: "not_sent",
      retryable: true,
    });
  });

  test("turns a recently sent LinkedIn invitation into a safe cooldown", async () => {
    const gateway = new UnipileOutboundChannelGateway({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      fetchImpl: (async () => Response.json({
        status: 422,
        type: "errors/already_invited_recently",
        title: "Should delay new invitation to this recipient",
        detail: "An invitation has already been sent recently to this recipient. Please try again later.",
      }, { status: 422 })) as unknown as typeof fetch,
    });

    const error = await gateway.send({
      accountId: "linkedin-account",
      channel: "linkedin",
      stepKind: "linkedin_invite",
      recipient: {
        value: "Marie Durand",
        normalizedValue: "linkedin.com/in/marie-durand",
        providerUserId: "provider-marie",
      },
      subject: null,
      body: "",
      idempotencyKey: "invite-recent:test",
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "LINKEDIN_INVITE_RECENT",
      deliveryState: "not_sent",
      retryable: true,
    });
  });
});

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
}
