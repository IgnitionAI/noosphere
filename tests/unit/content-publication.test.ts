import { describe, expect, test } from "bun:test";
import { ContentPublicationJobProcessor } from "@outbound/application/content/content-publications";
import { SocialProviderError } from "@outbound/application/content/social-ports";

describe("PUB-101 durable LinkedIn publication", () => {
  test("does not call the provider again after a worker lease was lost", async () => {
    let providerCalls = 0;
    const acknowledgements: string[] = [];
    const processor = new ContentPublicationJobProcessor(
      { async inspectExecution() { return "unknown"; } } as never,
      { async resolveLinkedin() { throw new Error("must not resolve"); } },
      { async observeCapabilities() { throw new Error("must not observe"); }, async publishText() { providerCalls += 1; throw new Error("must not publish"); } },
      queue({ acknowledgements }),
      () => now,
    );

    await processor.process(job());
    expect(providerCalls).toBe(0);
    expect(acknowledgements).toEqual(["job-fixture"]);
  });

  test("publishes the immutable snapshot and persists provider identity before acknowledging", async () => {
    const transitions: unknown[] = [];
    const acknowledgements: string[] = [];
    const processor = new ContentPublicationJobProcessor(
      {
        async inspectExecution() { return "ready"; },
        async claimExecution(input: { executionToken: string }) {
          transitions.push(["claimed", input.executionToken]);
          return { publicationId, executionToken: input.executionToken, accountId: "account_fixture", text: "Texte figé", requestKey: "publish-fixture-1", attempt: 1 };
        },
        async markPublished(input: unknown) { transitions.push(["published", input]); },
      } as never,
      accountResolver(),
      {
        async observeCapabilities() { return capability(); },
        async publishText(input) {
          transitions.push(["provider", input]);
          return { providerPostId: "post_fixture", socialId: "social_fixture", url: "https://www.linkedin.com/feed/update/fixture", publishedAt: now };
        },
      },
      queue({ acknowledgements }),
      () => now,
    );

    await processor.process(job());
    expect((transitions[0] as unknown[])[0]).toBe("claimed");
    expect((transitions[1] as unknown[])[0]).toBe("provider");
    expect((transitions[2] as unknown[])[0]).toBe("published");
    expect(acknowledgements).toEqual(["job-fixture"]);
  });

  test("marks a provider 5xx outcome unknown and never schedules a replay", async () => {
    const unknown: unknown[] = [];
    const retries: unknown[] = [];
    const acknowledgements: string[] = [];
    const processor = new ContentPublicationJobProcessor(
      {
        async inspectExecution() { return "ready"; },
        async claimExecution(input: { executionToken: string }) { return { publicationId, executionToken: input.executionToken, accountId: "account_fixture", text: "Texte figé", requestKey: "publish-fixture-2", attempt: 1 }; },
        async markUnknown(input: unknown) { unknown.push(input); },
      } as never,
      accountResolver(),
      {
        async observeCapabilities() { return capability(); },
        async publishText() { throw new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", "fixture 503", "unknown", false); },
      },
      queue({ acknowledgements, retries }),
      () => now,
    );

    await processor.process(job());
    expect(unknown).toHaveLength(1);
    expect(retries).toHaveLength(0);
    expect(acknowledgements).toEqual(["job-fixture"]);
  });

  test("retries a rate limit only when the provider guarantees not sent", async () => {
    const repositoryRetries: unknown[] = [];
    const queueRetries: unknown[] = [];
    const acknowledgements: string[] = [];
    const processor = new ContentPublicationJobProcessor(
      {
        async inspectExecution() { return "ready"; },
        async claimExecution(input: { executionToken: string }) { return { publicationId, executionToken: input.executionToken, accountId: "account_fixture", text: "Texte figé", requestKey: "publish-fixture-3", attempt: 1 }; },
        async markRetry(input: unknown) { repositoryRetries.push(input); },
      } as never,
      accountResolver(),
      {
        async observeCapabilities() { return capability(); },
        async publishText() { throw new SocialProviderError("SOCIAL_RATE_LIMITED", "fixture 429", "not_sent", true, 7_000); },
      },
      queue({ acknowledgements, retries: queueRetries }),
      () => now,
    );

    await processor.process(job());
    expect(repositoryRetries).toHaveLength(1);
    expect(queueRetries).toHaveLength(1);
    expect(acknowledgements).toHaveLength(0);
    expect((queueRetries[0] as { availableAt: Date }).availableAt).toEqual(new Date(now.getTime() + 7_000));
  });

  test("loads, verifies and publishes an immutable media attachment", async () => {
    const bytes = new TextEncoder().encode("fixture-image-bytes");
    const checksumSha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const published: unknown[] = [];
    const transitions: unknown[] = [];
    const acknowledgements: string[] = [];
    const processor = new ContentPublicationJobProcessor(
      {
        async inspectExecution() { return "ready"; },
        async claimExecution(input: { executionToken: string }) {
          return {
            publicationId,
            executionToken: input.executionToken,
            accountId: "account_fixture",
            text: "Texte et image figés",
            requestKey: "publish-media-fixture-1",
            attempt: 1,
            attachments: [mediaSnapshot({ checksumSha256, sizeBytes: bytes.byteLength })],
          };
        },
        async markPublished(input: unknown) { transitions.push(input); },
      } as never,
      accountResolver(),
      {
        async observeCapabilities() { return capabilityWithMedia(); },
        async publishText() { throw new Error("must not publish text-only"); },
        async publish(input) {
          published.push(input);
          return { providerPostId: "post-media-fixture", socialId: "social-media-fixture", url: null, publishedAt: now };
        },
      },
      queue({ acknowledgements }),
      () => now,
      {
        async put() { throw new Error("must not write"); },
        async get(input) {
          expect(input).toEqual({ objectKey: "workspace-fixture/content-media/run-fixture/media.png", maxBytes: 100 * 1024 * 1024 });
          return bytes;
        },
      },
    );

    await processor.process(job());
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      text: "Texte et image figés",
      attachments: [{ kind: "image", filename: "linkedin-image.png", mimeType: "image/png" }],
    });
    expect((published[0] as { attachments: { content: Uint8Array }[] }).attachments[0]!.content).toEqual(bytes);
    expect(transitions).toHaveLength(1);
    expect(acknowledgements).toEqual(["job-fixture"]);
  });

  test("fails closed before the provider when stored media integrity changed", async () => {
    let providerCalls = 0;
    const failures: unknown[] = [];
    const unknown: unknown[] = [];
    const acknowledgements: string[] = [];
    const processor = new ContentPublicationJobProcessor(
      {
        async inspectExecution() { return "ready"; },
        async claimExecution(input: { executionToken: string }) {
          return {
            publicationId,
            executionToken: input.executionToken,
            accountId: "account_fixture",
            text: "Texte figé",
            requestKey: "publish-media-fixture-2",
            attempt: 1,
            attachments: [mediaSnapshot({ checksumSha256: "0".repeat(64), sizeBytes: 8 })],
          };
        },
        async markFailed(input: unknown) { failures.push(input); },
        async markUnknown(input: unknown) { unknown.push(input); },
      } as never,
      accountResolver(),
      {
        async observeCapabilities() { return capabilityWithMedia(); },
        async publishText() { providerCalls += 1; throw new Error("must not publish"); },
        async publish() { providerCalls += 1; throw new Error("must not publish"); },
      },
      queue({ acknowledgements }),
      () => now,
      {
        async put() { throw new Error("must not write"); },
        async get() { return new TextEncoder().encode("tampered"); },
      },
    );

    await processor.process(job());
    expect(providerCalls).toBe(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ code: "CONTENT_MEDIA_INTEGRITY_MISMATCH" });
    expect(unknown).toHaveLength(0);
    expect(acknowledgements).toEqual(["job-fixture"]);
  });
});

const now = new Date("2026-08-20T10:00:00.000Z");
const publicationId = "33000000-0000-4000-8000-000000000001";

function job() { return { id: "job-fixture", workspaceId: "workspace-fixture", type: "content.publication.publish", payload: { publicationId }, idempotencyKey: "job-publication-fixture", correlationId: "fixture", maxAttempts: 4, availableAt: now, priority: 10, attempts: 1, lockedBy: "worker-fixture", lockedUntil: new Date(now.getTime() + 60_000) }; }
function accountResolver() { return { async resolveLinkedin() { return { accountId: "account_fixture", displayName: "Fixture", selectionVersion: now.toISOString() }; } }; }
function capability() { return { network: "linkedin" as const, accountId: "account_fixture", accountHealthy: true, textPublishing: "available" as const, observedAt: now }; }
function capabilityWithMedia() { return { ...capability(), mediaPublishing: { image: "available" as const, document: "available" as const, video: "available" as const } }; }
function mediaSnapshot(overrides: { checksumSha256: string; sizeBytes: number }) {
  return {
    id: "media-fixture",
    kind: "image" as const,
    objectKey: "workspace-fixture/content-media/run-fixture/media.png",
    mimeType: "image/png" as const,
    filename: "linkedin-image.png",
    checksumSha256: overrides.checksumSha256,
    sizeBytes: overrides.sizeBytes,
    width: 1080,
    height: 1350,
    pageCount: null,
    durationSeconds: null,
    altText: "Carte Noosphere",
  };
}
function queue(output: { acknowledgements: string[]; retries?: unknown[] }) { return { async acknowledge(id: string) { output.acknowledgements.push(id); }, async retry(input: unknown) { output.retries?.push(input); return "scheduled" as const; } } as never; }
