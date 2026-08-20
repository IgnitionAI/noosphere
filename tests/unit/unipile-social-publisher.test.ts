import { describe, expect, test } from "bun:test";
import { SocialProviderError } from "@outbound/application/content/social-ports";
import { UnipileSocialPublisher } from "@outbound/infrastructure/content/unipile-social-publisher";

describe("UnipileSocialPublisher", () => {
  test("observes text publishing only for a healthy LinkedIn account", async () => {
    const publisher = buildPublisher(() => Response.json({
      id: "account_fixture",
      type: "LINKEDIN",
      sources: [{ id: "LINKEDIN_MESSAGING", status: "OK" }],
    }));

    await expect(publisher.observeCapabilities({
      accountId: "account_fixture",
      now: new Date("2026-08-20T08:00:00.000Z"),
    })).resolves.toEqual({
      network: "linkedin",
      accountId: "account_fixture",
      accountHealthy: true,
      textPublishing: "available",
      observedAt: new Date("2026-08-20T08:00:00.000Z"),
    });
  });

  test("publishes a text post through Unipile v1 and retains the provider identity", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
    const publisher = buildPublisher((url, init) => {
      calls.push({ url, init });
      return Response.json({
        id: "post_fixture_1",
        social_id: "urn:li:share:fixture",
        share_url: "https://www.linkedin.com/feed/update/urn:li:share:fixture",
        parsed_datetime: "2026-08-20T08:05:00.000Z",
      }, { status: 201 });
    });

    const result = await publisher.publishText({
      accountId: "account_fixture",
      text: "Une publication de test sans donnée réelle.",
      requestKey: "publication:fixture:1",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/posts");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      account_id: "account_fixture",
      text: "Une publication de test sans donnée réelle.",
    });
    expect(result).toEqual({
      providerPostId: "post_fixture_1",
      socialId: "urn:li:share:fixture",
      url: "https://www.linkedin.com/feed/update/urn:li:share:fixture",
      publishedAt: new Date("2026-08-20T08:05:00.000Z"),
    });
  });

  test("classifies a 422 as a non-retryable content rejection", async () => {
    const error = await publishWith(() => Response.json({ detail: "fixture rejected" }, { status: 422 }));
    expectSocialError(error, {
      code: "SOCIAL_CONTENT_REJECTED",
      deliveryState: "not_sent",
      retryable: false,
      retryAfterMs: null,
    });
  });

  test("classifies a 429 as safely retryable and retains retry-after", async () => {
    const error = await publishWith(() => new Response("fixture limit", {
      status: 429,
      headers: { "retry-after": "7" },
    }));
    expectSocialError(error, {
      code: "SOCIAL_RATE_LIMITED",
      deliveryState: "not_sent",
      retryable: true,
      retryAfterMs: 7_000,
    });
  });

  test("classifies a provider 5xx as unknown and never automatically retryable", async () => {
    const error = await publishWith(() => new Response("fixture failure", { status: 503 }));
    expectSocialError(error, {
      code: "SOCIAL_PROVIDER_UNAVAILABLE",
      deliveryState: "unknown",
      retryable: false,
      retryAfterMs: null,
    });
  });

  test("classifies connection establishment failures as definitely not sent", async () => {
    const error = await publishWith(() => {
      throw new TypeError("ECONNREFUSED fixture");
    });
    expectSocialError(error, {
      code: "SOCIAL_PROVIDER_UNAVAILABLE",
      deliveryState: "not_sent",
      retryable: true,
      retryAfterMs: null,
    });
  });

  test("does not invent an id when a successful provider response is malformed", async () => {
    const error = await publishWith(() => Response.json({ status: "created" }, { status: 201 }));
    expectSocialError(error, {
      code: "SOCIAL_PROVIDER_RESPONSE_INVALID",
      deliveryState: "unknown",
      retryable: false,
      retryAfterMs: null,
    });
  });

  test("rejects an unhealthy or non-LinkedIn account before any publication", async () => {
    const publisher = buildPublisher(() => Response.json({
      id: "email_fixture",
      type: "GOOGLE",
      sources: [{ status: "OK" }],
    }));
    const error = await publisher.observeCapabilities({ accountId: "email_fixture" }).catch((caught) => caught);
    expectSocialError(error, {
      code: "SOCIAL_ACCOUNT_UNAVAILABLE",
      deliveryState: "not_sent",
      retryable: false,
      retryAfterMs: null,
    });
  });
});

function buildPublisher(handler: (url: string, init?: RequestInit) => Response): UnipileSocialPublisher {
  return new UnipileSocialPublisher({
    dsn: "https://api.example.test/",
    apiKey: "fixture-api-key",
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init)) as typeof fetch,
  });
}

async function publishWith(handler: (url: string, init?: RequestInit) => Response): Promise<unknown> {
  return buildPublisher(handler).publishText({
    accountId: "account_fixture",
    text: "Publication fixture",
    requestKey: "publication:fixture:error",
  }).catch((error) => error);
}

function expectSocialError(error: unknown, expected: {
  readonly code: string;
  readonly deliveryState: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
}): void {
  expect(error).toBeInstanceOf(SocialProviderError);
  expect(error).toMatchObject(expected);
}
