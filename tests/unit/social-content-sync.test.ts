import { describe, expect, test } from "bun:test";
import { SocialContentSynchronizer, type SocialContentSyncLease, type SocialContentSyncRepository } from "@outbound/application/content/social-content-sync";

const now = new Date("2026-08-21T06:00:00.000Z");
const account = { workspaceId: "workspace-fixture", connectedAccountId: "connected-fixture", providerAccountId: "provider-fixture" };

describe("LNK-102 durable social content synchronization", () => {
  test("persists one provider page and advances the durable cursor", async () => {
    const pages: unknown[] = [];
    const synchronizer = new SocialContentSynchronizer(
      repository({ pages }),
      { async listOwnContent() { return { data: [post()], nextCursor: "next-fixture" }; } },
      { async readMetrics() { return [metrics()]; } },
      { now: () => now },
    );
    expect(await synchronizer.reconcile(account.workspaceId)).toBe(1);
    expect(pages).toEqual([expect.objectContaining({ nextCursor: "next-fixture", posts: [post()], metrics: [metrics()] })]);
  });

  test("resets a completed backfill to the newest page after reaching its watermark", async () => {
    const pages: any[] = [];
    const lease = durableLease({ backfillComplete: true, cursor: "older-page", highWatermark: new Date("2026-08-20T12:00:00.000Z") });
    const synchronizer = new SocialContentSynchronizer(
      repository({ pages, lease }),
      { async listOwnContent() { return { data: [{ ...post(), publishedAt: new Date("2026-08-20T10:00:00.000Z") }], nextCursor: "even-older" }; } },
      { async readMetrics() { return []; } },
      { now: () => now },
    );
    await synchronizer.reconcile();
    expect(pages[0].nextCursor).toBeNull();
  });

  test("releases the lease as an explicit retryable failure", async () => {
    const failures: unknown[] = [];
    const synchronizer = new SocialContentSynchronizer(
      repository({ failures }),
      { async listOwnContent() { throw Object.assign(new Error("rate limited"), { code: "SOCIAL_RATE_LIMITED" }); } },
      { async readMetrics() { return []; } },
      { now: () => now, failureRetryMs: 8_000 },
    );
    expect(await synchronizer.reconcile()).toBe(0);
    expect(failures).toEqual([expect.objectContaining({ code: "SOCIAL_RATE_LIMITED", retryAfterMs: 8_000 })]);
  });

  test("honors the provider retry-after delay", async () => {
    const failures: unknown[] = [];
    const synchronizer = new SocialContentSynchronizer(
      repository({ failures }),
      {
        async listOwnContent() {
          throw Object.assign(new Error("rate limited"), {
            code: "SOCIAL_RATE_LIMITED",
            retryAfterMs: 90_000,
          });
        },
      },
      { async readMetrics() { return []; } },
      { now: () => now, failureRetryMs: 8_000 },
    );

    expect(await synchronizer.reconcile()).toBe(0);
    expect(failures).toEqual([
      expect.objectContaining({ code: "SOCIAL_RATE_LIMITED", retryAfterMs: 90_000 }),
    ]);
  });
});

function repository(output: { pages?: unknown[]; failures?: unknown[]; lease?: SocialContentSyncLease }): SocialContentSyncRepository {
  return {
    async listDueAccounts() { return [account]; },
    async acquire() { return output.lease ?? durableLease(); },
    async persistPage(input) { output.pages?.push(input); return input.posts.length; },
    async markFailed(input) { output.failures?.push(input); },
    async list() { return { data: [], nextCursor: null }; },
    async status() { return { status: "idle", backfillComplete: false, lastSuccessAt: null, nextSyncAt: null, lastErrorCode: null, lastErrorMessage: null }; },
  };
}
function durableLease(overrides: Partial<SocialContentSyncLease> = {}): SocialContentSyncLease { return { ...account, stateId: "state-fixture", leaseToken: "lease-fixture", cursor: null, highWatermark: null, backfillComplete: false, ...overrides }; }
function post() { return { providerPostId: "post-fixture", socialId: "urn:li:activity:123", authorProviderId: "owner-fixture", text: "Post fixture", url: "https://www.linkedin.com/feed/update/urn:li:activity:123", publishedAt: new Date("2026-08-21T05:00:00.000Z"), observedAt: now }; }
function metrics() { return { providerPostId: "post-fixture", impressions: 100, reactions: 5, comments: 2, reposts: 1, observedAt: now }; }
