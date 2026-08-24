import { describe, expect, test } from "bun:test";
import { UnipileSocialContentReader } from "@outbound/infrastructure/content/unipile-social-content-reader";

describe("Unipile social content reader", () => {
  test("resolves the owner then reads a cursor page of LinkedIn posts", async () => {
    const calls: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); calls.push(url);
      if (url.pathname.endsWith("/users/me")) return Response.json({ provider_id: "ACoOWNER" });
      return Response.json({ items: [{ social_id: "urn:li:activity:12345", text: "Post observé", share_url: "https://www.linkedin.com/posts/test-activity-12345-x", parsed_datetime: "2026-08-20T08:00:00.000Z" }], cursor: "next_fixture" });
    }) as unknown as typeof fetch;
    const reader = new UnipileSocialContentReader({ dsn: "https://api.example.test", apiKey: "secret", fetchImpl });
    const page = await reader.listOwnContent({ accountId: "account-fixture", cursor: "cursor-fixture", limit: 25 });
    expect(calls.map((url) => `${url.pathname}${url.search}`)).toEqual([
      "/api/v1/users/me?account_id=account-fixture",
      "/api/v1/users/ACoOWNER/posts?account_id=account-fixture&limit=25&cursor=cursor-fixture",
    ]);
    expect(page).toEqual({ data: [expect.objectContaining({ providerPostId: "12345", socialId: "urn:li:activity:12345", authorProviderId: "ACoOWNER", text: "Post observé" })], nextCursor: "next_fixture" });
  });

  test("treats an Unipile cursor without a pagination token as the end of the backfill", async () => {
    const terminalCursor = Buffer.from(JSON.stringify({ pagination_token: null, start: 721 })).toString("base64");
    const calls: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith("/users/me")) return Response.json({ provider_id: "ACoOWNER" });
      return Response.json({ items: [], cursor: terminalCursor });
    }) as unknown as typeof fetch;
    const reader = new UnipileSocialContentReader({ dsn: "https://api.example.test", apiKey: "secret", fetchImpl });

    const page = await reader.listOwnContent({ accountId: "account-fixture", cursor: null, limit: 25 });

    expect(page).toEqual({ data: [], nextCursor: null });
    expect(calls).toHaveLength(2);
  });

  test("recovers a previously stored terminal Unipile cursor without calling the provider", async () => {
    const terminalCursor = Buffer.from(JSON.stringify({ pagination_token: null, start: 721 })).toString("base64");
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return Response.json({});
    }) as unknown as typeof fetch;
    const reader = new UnipileSocialContentReader({ dsn: "https://api.example.test", apiKey: "secret", fetchImpl });

    const page = await reader.listOwnContent({ accountId: "account-fixture", cursor: terminalCursor, limit: 25 });

    expect(page).toEqual({ data: [], nextCursor: null });
    expect(calls).toBe(0);
  });

  test("reads cumulative counters from each post and rejects negative counters", async () => {
    const fetchImpl = (async () => Response.json({ social_id: "urn:li:activity:12345", impressions_counter: 900, reaction_counter: "12", comment_counter: 3, repost_counter: -1 })) as unknown as typeof fetch;
    const reader = new UnipileSocialContentReader({ dsn: "https://api.example.test", apiKey: "secret", fetchImpl });
    const metrics = await reader.readMetrics({ accountId: "account-fixture", providerPostIds: ["12345", "12345"] });
    expect(metrics).toEqual([expect.objectContaining({ providerPostId: "12345", impressions: 900, reactions: 12, comments: 3, reposts: null })]);
  });

  test("skips a deleted post metric without marking the LinkedIn account unavailable", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const postId = url.pathname.split("/").at(-1)!;
      calls.push(postId);
      if (postId === "deleted-post") {
        return Response.json({ type: "errors/resource_not_found" }, { status: 404 });
      }
      return Response.json({ id: postId, impressions_counter: 120, reaction_counter: 7, comment_counter: 2, repost_counter: 1 });
    }) as unknown as typeof fetch;
    const reader = new UnipileSocialContentReader({ dsn: "https://api.example.test", apiKey: "secret", fetchImpl });

    const metrics = await reader.readMetrics({
      accountId: "account-fixture",
      providerPostIds: ["deleted-post", "available-post"],
    });

    expect(calls).toEqual(["deleted-post", "available-post"]);
    expect(metrics).toEqual([
      expect.objectContaining({ providerPostId: "available-post", impressions: 120, reactions: 7, comments: 2, reposts: 1 }),
    ]);
  });

  test("classifies provider throttling as retryable without a delivery ambiguity", async () => {
    const fetchImpl = (async () => new Response("limited", { status: 429, headers: { "retry-after": "90" } })) as unknown as typeof fetch;
    const reader = new UnipileSocialContentReader({ dsn: "https://api.example.test", apiKey: "secret", fetchImpl });
    await expect(reader.listOwnContent({ accountId: "account-fixture", cursor: null, limit: 25 })).rejects.toMatchObject({ code: "SOCIAL_RATE_LIMITED", retryable: true, deliveryState: "not_sent", retryAfterMs: 90_000 });
  });
});
