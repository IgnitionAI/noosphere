import { describe, expect, test } from "bun:test";
import { SocialEngagementSynchronizer, type SocialEngagementSyncLease, type SocialEngagementSyncRepository, type SocialEngagementSyncTarget } from "@outbound/application/content/social-engagement-sync";

const now = new Date("2026-08-21T06:00:00.000Z");
const target: SocialEngagementSyncTarget = { workspaceId: "workspace-1", socialContentId: "post-1", connectedAccountId: "connected-1", providerAccountId: "account-1", providerSocialId: "urn:li:activity:123", ownerProviderId: "owner-1", kind: "comments", scopeKey: "post", parentProviderInteractionId: null };

describe("ENG-101 durable social engagement synchronization", () => {
  test("persists one provider page and its durable cursor", async () => {
    const pages: unknown[] = [];
    const synchronizer = new SocialEngagementSynchronizer(
      repository({ pages }),
      { async listEngagements(input) { expect(input.providerSocialId).toBe("urn:li:activity:123"); return { data: [comment()], nextCursor: "next-comments" }; } },
      { now: () => now },
    );
    expect(await synchronizer.reconcile(target.workspaceId)).toBe(1);
    expect(pages).toEqual([expect.objectContaining({ engagements: [comment()], nextCursor: "next-comments" })]);
  });

  test("a reaction is only persisted as a fact and never dispatched", async () => {
    const pages: any[] = [];
    const reactionTarget = { ...target, kind: "reactions" as const };
    const synchronizer = new SocialEngagementSynchronizer(
      repository({ pages, target: reactionTarget, lease: lease(reactionTarget) }),
      { async listEngagements() { return { data: [reaction()], nextCursor: null }; } },
      { now: () => now },
    );
    expect(await synchronizer.reconcile()).toBe(1);
    expect(pages[0].engagements).toEqual([reaction()]);
  });

  test("keeps the cursor and scan token when a retryable read fails", async () => {
    const failures: unknown[] = [];
    const synchronizer = new SocialEngagementSynchronizer(
      repository({ failures }),
      { async listEngagements() { throw Object.assign(new Error("rate limited"), { code: "SOCIAL_RATE_LIMITED" }); } },
      { now: () => now, failureRetryMs: 9_000 },
    );
    expect(await synchronizer.reconcile()).toBe(0);
    expect(failures).toEqual([expect.objectContaining({ code: "SOCIAL_RATE_LIMITED", retryAfterMs: 9_000, lease: expect.objectContaining({ scanToken: "scan-1" }) })]);
  });
});

function repository(output: { pages?: unknown[]; failures?: unknown[]; target?: SocialEngagementSyncTarget; lease?: SocialEngagementSyncLease }): SocialEngagementSyncRepository {
  const current = output.target ?? target;
  return {
    async listDueTargets() { return [current]; },
    async acquire() { return output.lease ?? lease(current); },
    async persistPage(input) { output.pages?.push(input); return input.engagements.length; },
    async markFailed(input) { output.failures?.push(input); },
    async list() { return { data: [], nextCursor: null }; },
    async status() { return { status: "idle", observed: 0, incoming: 0, lastSuccessAt: null, nextSyncAt: null, lastErrorCode: null, lastErrorMessage: null }; },
  };
}
function lease(value = target): SocialEngagementSyncLease { return { ...value, stateId: "state-1", leaseToken: "lease-1", cursor: null, scanToken: "scan-1" }; }
function actor() { return { providerId: "incoming-1", name: "Alice", headline: null, profileUrl: null }; }
function comment() { return { providerInteractionId: "comment-1", type: "comment" as const, parentProviderInteractionId: null, actor: actor(), body: "Bonjour", reaction: null, mentionedProviderId: null, mentionedName: null, occurredAt: now, observedAt: now, replyCount: 0, reactionCount: 0 }; }
function reaction() { return { providerInteractionId: "reaction-1", type: "reaction" as const, parentProviderInteractionId: null, actor: actor(), body: null, reaction: "LIKE", mentionedProviderId: null, mentionedName: null, occurredAt: null, observedAt: now, replyCount: 0, reactionCount: 0 }; }
