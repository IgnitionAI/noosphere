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
});

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
}
