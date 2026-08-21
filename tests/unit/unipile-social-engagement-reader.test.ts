import { describe, expect, test } from "bun:test";
import { UnipileSocialEngagementReader } from "@outbound/infrastructure/content/unipile-social-engagement-reader";

describe("Unipile social engagement reader", () => {
  test("uses the LinkedIn social_id and normalizes comments plus explicit mentions", async () => {
    const calls: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(new URL(String(input)));
      return Response.json({
        items: [{
          object: "Comment",
          id: "comment-1",
          author: "Alice",
          author_details: { id: "alice-provider", headline: "CTO", profile_url: "https://www.linkedin.com/in/alice" },
          date: "2026-08-21T06:00:00.000Z",
          text: "Merci {{0}}",
          reply_counter: 2,
          reaction_counter: 3,
          mentions: [{ profile_id: "owner-provider", name: "Salim" }],
        }],
        cursor: "comments-next",
      });
    }) as unknown as typeof fetch;
    const reader = new UnipileSocialEngagementReader({ dsn: "https://api.example.test", apiKey: "secret", fetchImpl });
    const page = await reader.listEngagements({ accountId: "account-1", providerSocialId: "urn:li:activity:123", kind: "comments", parentProviderInteractionId: null, cursor: "comments-cursor", limit: 100 });
    expect(calls[0]?.pathname).toBe("/api/v1/posts/urn%3Ali%3Aactivity%3A123/comments");
    expect(Object.fromEntries(calls[0]!.searchParams)).toEqual({ account_id: "account-1", limit: "100", cursor: "comments-cursor", sort_by: "MOST_RECENT" });
    expect(page.nextCursor).toBe("comments-next");
    expect(page.data).toEqual([
      expect.objectContaining({ providerInteractionId: "comment-1", type: "comment", body: "Merci {{0}}", replyCount: 2, reactionCount: 3, actor: expect.objectContaining({ providerId: "alice-provider", name: "Alice" }) }),
      expect.objectContaining({ providerInteractionId: "comment-1:mention:owner-provider", type: "mention", parentProviderInteractionId: "comment-1", mentionedProviderId: "owner-provider" }),
    ]);
  });

  test("reads replies and reactions with stable provider compound keys", async () => {
    const calls: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); calls.push(url);
      if (url.pathname.endsWith("/comments")) return Response.json({ items: [{ id: "reply-1", author: "Bob", author_details: { id: "bob-provider" }, text: "Réponse", reply_counter: 0, reaction_counter: 0 }] });
      return Response.json({ items: [{ value: "LIKE", post_id: "urn:li:activity:123", comment_id: "comment-1", author: { id: "bob-provider", name: "Bob", headline: null, profile_url: "https://www.linkedin.com/in/bob" } }], paging: { cursor: null } });
    }) as unknown as typeof fetch;
    const reader = new UnipileSocialEngagementReader({ dsn: "https://api.example.test", apiKey: "secret", fetchImpl });
    const replyPage = await reader.listEngagements({ accountId: "account-1", providerSocialId: "urn:li:activity:123", kind: "comments", parentProviderInteractionId: "comment-1", cursor: null, limit: 25 });
    const reactionPage = await reader.listEngagements({ accountId: "account-1", providerSocialId: "urn:li:activity:123", kind: "reactions", parentProviderInteractionId: "comment-1", cursor: null, limit: 25 });
    expect(replyPage.data[0]).toEqual(expect.objectContaining({ providerInteractionId: "reply-1", type: "reply", parentProviderInteractionId: "comment-1" }));
    expect(reactionPage.data[0]).toEqual(expect.objectContaining({ providerInteractionId: "reaction:urn:li:activity:123:comment-1:bob-provider:LIKE", type: "reaction", reaction: "LIKE" }));
    expect(calls.map((url) => Object.fromEntries(url.searchParams))).toEqual([
      { account_id: "account-1", limit: "25", comment_id: "comment-1", sort_by: "MOST_RECENT" },
      { account_id: "account-1", limit: "25", comment_id: "comment-1" },
    ]);
  });

  test("classifies throttling as retryable", async () => {
    const reader = new UnipileSocialEngagementReader({ dsn: "https://api.example.test", apiKey: "secret", fetchImpl: (async () => new Response("limited", { status: 429 })) as unknown as typeof fetch });
    await expect(reader.listEngagements({ accountId: "account-1", providerSocialId: "urn:li:activity:123", kind: "comments", parentProviderInteractionId: null, cursor: null, limit: 25 })).rejects.toMatchObject({ code: "SOCIAL_RATE_LIMITED", retryable: true, deliveryState: "not_sent" });
  });
});
