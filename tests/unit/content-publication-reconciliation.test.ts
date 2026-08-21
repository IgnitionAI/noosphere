import { describe, expect, test } from "bun:test";
import {
  ContentPublicationOutcomeReconciler,
  textFingerprint,
  type ContentPublicationReconciliationLease,
  type ContentPublicationReconciliationRepository,
} from "@outbound/application/content/content-publication-reconciliation";

const now = new Date("2026-08-21T10:00:00.000Z");

describe("OPS-102 provider effect reconciliation", () => {
  test("finds the exact durable fingerprint without replaying the publication", async () => {
    const matched: unknown[] = [];
    let reads = 0;
    const reconciler = new ContentPublicationOutcomeReconciler(
      repository({ matched }),
      { async listOwnContent() { reads += 1; return { data: [post("post-found", "Texte publié")], nextCursor: null }; } },
      { now: () => now },
    );
    expect(await reconciler.reconcile("workspace-fixture")).toBe(1);
    expect(reads).toBe(1);
    expect(matched).toEqual([expect.objectContaining({ match: expect.objectContaining({ providerPostId: "post-found" }) })]);
  });

  test("stops on an ambiguous match and never chooses a provider effect", async () => {
    const ambiguous: unknown[] = [];
    const reconciler = new ContentPublicationOutcomeReconciler(
      repository({ ambiguous }),
      { async listOwnContent() { return { data: [post("post-a", "Texte publié"), post("post-b", "Texte publié")], nextCursor: null }; } },
      { now: () => now },
    );
    expect(await reconciler.reconcile()).toBe(1);
    expect(ambiguous).toEqual([expect.objectContaining({ candidatesCount: 2 })]);
  });

  test("records a final absence only after the bounded observation window", async () => {
    const noMatches: any[] = [];
    const lease = durableLease({ windowEnd: new Date(now.getTime() - 1) });
    const reconciler = new ContentPublicationOutcomeReconciler(
      repository({ noMatches, lease }),
      { async listOwnContent() { return { data: [], nextCursor: null }; } },
      { now: () => now },
    );
    expect(await reconciler.reconcile()).toBe(1);
    expect(noMatches).toEqual([expect.objectContaining({ terminal: true, candidatesCount: 0 })]);
  });

  test("keeps provider failures retryable with an expurgated error code", async () => {
    const failures: any[] = [];
    const reconciler = new ContentPublicationOutcomeReconciler(
      repository({ failures }),
      { async listOwnContent() { throw Object.assign(new Error("response contains provider payload"), { code: "SOCIAL_RATE_LIMITED" }); } },
      { now: () => now, retryMs: 12_000 },
    );
    expect(await reconciler.reconcile()).toBe(0);
    expect(failures).toEqual([expect.objectContaining({ code: "SOCIAL_RATE_LIMITED", terminal: false, nextAttemptAt: new Date(now.getTime() + 12_000) })]);
    expect(JSON.stringify(failures)).not.toContain("provider payload");
  });
});

function repository(output: {
  matched?: unknown[];
  ambiguous?: unknown[];
  noMatches?: unknown[];
  failures?: unknown[];
  lease?: ContentPublicationReconciliationLease;
}): ContentPublicationReconciliationRepository {
  return {
    async listDue() { return [{ workspaceId: "workspace-fixture", reconciliationId: "reconciliation-fixture", publicationId: "publication-fixture" }]; },
    async acquire() { return output.lease ?? durableLease(); },
    async markMatched(input) { output.matched?.push(input); },
    async markNoMatch(input) { output.noMatches?.push(input); },
    async markAmbiguous(input) { output.ambiguous?.push(input); },
    async markProviderError(input) { output.failures?.push(input); },
  };
}

function durableLease(overrides: Partial<ContentPublicationReconciliationLease> = {}): ContentPublicationReconciliationLease {
  return {
    workspaceId: "workspace-fixture",
    reconciliationId: "reconciliation-fixture",
    publicationId: "publication-fixture",
    leaseToken: "lease-fixture",
    providerAccountId: "account-fixture",
    contentFingerprint: textFingerprint("Texte publié"),
    windowStart: new Date(now.getTime() - 30 * 60_000),
    windowEnd: new Date(now.getTime() + 30 * 60_000),
    attempt: 1,
    maxAttempts: 18,
    ...overrides,
  };
}

function post(providerPostId: string, text: string) {
  return {
    providerPostId,
    socialId: `urn:li:activity:${providerPostId}`,
    authorProviderId: "owner-fixture",
    text,
    url: `https://www.linkedin.com/feed/update/${providerPostId}`,
    publishedAt: now,
    observedAt: now,
  };
}
