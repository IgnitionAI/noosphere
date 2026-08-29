import { describe, expect, test } from "bun:test";
import {
  ExternalEffectPolicy,
  ExternalEffectStaleEvaluator,
  type ExternalEffectFacts,
  type ExternalEffectPolicyCode,
  type ExternalEffectPolicyInput,
  type ExternalEffectSourceSnapshot,
} from "@outbound/application/mcp/external-effect-policy";

const context = {
  userId: "user-1",
  workspaceId: "workspace-1",
  clientId: "client-1",
  role: "reviewer" as const,
  scopes: ["mcp:read", "mcp:write"] as const,
  audience: "noosphere",
};

function proposal(kind: ExternalEffectFacts["kind"], aggregateId = `${kind}-aggregate`) {
  return {
    proposalId: `${kind}-proposal`, workspaceId: context.workspaceId, kind,
    status: "approval_required" as const, approvalItemId: `${kind}-approval`,
    correlationId: `${kind}-correlation`, version: 1, revision: 3, sourceVersion: 7,
    createdAt: "2026-08-29T10:00:00.000Z", updatedAt: "2026-08-29T10:00:00.000Z",
    policyPreview: { factsVersion: 11 },
    aggregateId,
  };
}

function source(kind: ExternalEffectFacts["kind"]): ExternalEffectSourceSnapshot {
  return {
    kind, aggregateId: `${kind}-aggregate`, revision: 3, sourceVersion: 7, factsVersion: 11,
    sourceId: `${kind}-source`, sourceUpdatedAt: "2026-08-29T09:00:00.000Z",
    ...(kind === "content_publication" ? { assetId: "asset-1", publicationId: "publication-1", assetVersionId: "asset-v1", contentVersion: 1, assetReady: true, assetStatus: "ready", strategyActive: true, strategyDeleted: false, strategyVersion: 1 } : {}),
    ...(kind === "campaign_activation" ? { enrollmentFingerprint: "a".repeat(64), scheduleWindow: { start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z", timeZone: "UTC" }, accountHealth: { status: "healthy", checkedAt: "2026-08-29T09:00:00Z" } } : {}),
  };
}

function facts(kind: ExternalEffectFacts["kind"], extra: Record<string, unknown> = {}): ExternalEffectFacts {
  return {
    kind, aggregateId: `${kind}-aggregate`, revision: 3, sourceVersion: 7, factsVersion: 11,
    sourceId: `${kind}-source`, sourceUpdatedAt: "2026-08-29T09:00:00.000Z", evaluatedAt: "2026-08-29T10:00:00.000Z",
    adapterAvailable: true, accountHealthy: true, quotaAvailable: true,
    suppressed: false, humanReplyAt: null,
    status: kind === "campaign_activation" ? "active" : "ready",
    ...(kind === "content_publication" ? { assetId: "asset-1", publicationId: "publication-1", assetVersionId: "asset-v1", contentVersion: 1, policyVersion: "editorial-v1", assetReady: true, assetStatus: "ready", strategyActive: true, strategyDeleted: false, strategyVersion: 1 } : {}),
    ...(kind === "meeting_proposal" ? { slotPosition: 1, slotStart: "2026-09-01T10:00:00.000Z", slotEnd: "2026-09-01T10:30:00.000Z", timeZone: "UTC", expiresAt: "2026-09-02T00:00:00.000Z" } : {}),
    ...(kind === "campaign_activation" ? { policyVersion: "campaign-v1", automationStage: "ready", enrollmentFingerprint: "a".repeat(64), scheduleWindow: { start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z", timeZone: "UTC" }, accountHealth: { status: "healthy", checkedAt: "2026-08-29T09:00:00Z" } } : {}),
    ...extra,
  } as ExternalEffectFacts;
}

function input(kind: ExternalEffectFacts["kind"], _current: ExternalEffectFacts, phase: "preview" | "final" = "preview"): ExternalEffectPolicyInput {
  return { context, proposal: proposal(kind), phase, sourceSnapshot: source(kind) };
}

describe("ExternalEffectStaleEvaluator", () => {
  test("evaluates every closed effect kind as fresh from authoritative versions", async () => {
    for (const kind of ["conversation_reply", "content_publication", "meeting_proposal", "campaign_activation"] as const) {
      const current = facts(kind, kind === "campaign_activation" ? { adapterAvailable: true } : {});
      class StatefulReader {
        constructor(private readonly value: ExternalEffectFacts) {}

        async readFacts(): Promise<ExternalEffectFacts> {
          return this.value;
        }
      }
      const result = await new ExternalEffectStaleEvaluator(new StatefulReader(current)).evaluateByKind(input(kind, current));
      expect(result).toMatchObject({ stale: false, code: "OK", factsVersion: 11 });
    }
  });

  test("treats contact absence alone as fresh", async () => {
    const current = facts("conversation_reply", { contactPresent: false });
    const result = await new ExternalEffectStaleEvaluator({ read: async () => current }).evaluateByKind(input("conversation_reply", current));
    expect(result).toMatchObject({ stale: false, code: "OK" });
  });

  const cases: Array<[string, ExternalEffectFacts["kind"], Record<string, unknown>, ExternalEffectPolicyCode]> = [
    ["suppression", "conversation_reply", { suppressed: true }, "CONTACT_SUPPRESSED"],
    ["human reply", "conversation_reply", { humanReplyAt: "2026-08-29T11:00:00.000Z" }, "HUMAN_REPLY_ARRIVED"],
    ["source revision", "content_publication", { revision: 4 }, "SOURCE_STALE"],
    ["inactive campaign", "campaign_activation", { campaignActive: false }, "CAMPAIGN_NOT_ACTIVE"],
    ["unhealthy account", "conversation_reply", { accountHealthy: false }, "ACCOUNT_UNHEALTHY"],
    ["quota", "content_publication", { quotaAvailable: false }, "QUOTA_EXCEEDED"],
    ["missing adapter", "meeting_proposal", { adapterAvailable: false }, "ADAPTER_UNAVAILABLE"],
    ["unsupported policy", "content_publication", { policyVersion: "editorial-v9", supportedPolicyVersions: ["editorial-v1"] }, "POLICY_VERSION_UNSUPPORTED"],
    ["cancelled effect", "meeting_proposal", { cancelledAt: "2026-08-29T11:00:00.000Z" }, "EFFECT_CANCELLED"],
    ["expired effect", "meeting_proposal", { expiresAt: "2026-08-29T09:00:00.000Z", evaluatedAt: "2026-08-29T10:00:00.000Z" }, "EFFECT_EXPIRED"],
    ["idempotency conflict", "campaign_activation", { idempotencyConflict: true, adapterAvailable: true }, "IDEMPOTENCY_CONFLICT"],
  ];

  test.each(cases)("returns stable code for %s", async (_label, kind, extra, expectedCode) => {
    const current = facts(kind, extra);
    const result = await new ExternalEffectStaleEvaluator({ read: async () => current }).evaluateByKind(input(kind, current));
    expect(result.stale).toBe(true);
    expect(result.code).toBe(expectedCode);
    expect(result.factsVersion).toBe(11);
  });

  test("requires a stored source snapshot and version", async () => {
    const current = facts("conversation_reply");
    const result = await new ExternalEffectStaleEvaluator({ read: async () => current }).evaluateByKind({
      context, proposal: proposal("conversation_reply"), phase: "preview",
    });
    expect(result).toMatchObject({ stale: true, code: "SOURCE_STALE", factsVersion: 11 });
  });
});

describe("ExternalEffectPolicy", () => {
  test("uses the same evaluator and facts for preview and final", async () => {
    const current = facts("conversation_reply");
    const policy = new ExternalEffectPolicy({ read: async () => current });
    const preview = await policy.preview(input("conversation_reply", current, "preview"));
    const final = await policy.final(input("conversation_reply", current, "final"));
    expect(preview).toEqual(final);
    expect(preview).toEqual({ decision: "allow", code: "OK", factsVersion: 11 });
  });

  test("denies unsupported policy and missing adapter without exposing facts or secrets", async () => {
    const current = facts("campaign_activation", { adapterAvailable: false, providerToken: "secret", rawContent: "private" });
    const policy = new ExternalEffectPolicy({ read: async () => current });
    const result = await policy.final(input("campaign_activation", current, "final"));
    expect(result).toEqual({ decision: "deny", code: "ADAPTER_UNAVAILABLE", factsVersion: 11 });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  test("always reads authoritative facts and fails closed for reader failures", async () => {
    let reads = 0;
    const current = facts("conversation_reply");
    const policy = new ExternalEffectPolicy({
      read: async () => { reads += 1; return current; },
    });
    await policy.preview(input("conversation_reply", current));
    await policy.final(input("conversation_reply", current, "final"));
    expect(reads).toBe(2);
    const failed = new ExternalEffectPolicy({ read: async () => { throw new Error("provider secret"); } });
    await expect(failed.final(input("conversation_reply", current, "final"))).resolves.toEqual({ decision: "deny", code: "ADAPTER_UNAVAILABLE", factsVersion: 0 });
  });

  test("rejects malformed facts, kind/aggregate binding, and invalid dates", async () => {
    const current = facts("conversation_reply");
    const malformed = { ...current, factsVersion: 0 } as ExternalEffectFacts;
    await expect(new ExternalEffectPolicy({ read: async () => malformed }).final(input("conversation_reply", current, "final")))
      .resolves.toMatchObject({ decision: "deny", code: "ADAPTER_UNAVAILABLE" });
    const wrongKind = facts("content_publication", { adapterAvailable: true });
    await expect(new ExternalEffectPolicy({ read: async () => wrongKind }).final(input("conversation_reply", current, "final")))
      .resolves.toMatchObject({ decision: "deny", code: "SOURCE_STALE" });
    const invalidDate = facts("meeting_proposal", { expiresAt: "not-an-iso-date", evaluatedAt: "2026-08-29T10:00:00.000Z" });
    await expect(new ExternalEffectPolicy({ read: async () => invalidDate }).final(input("meeting_proposal", invalidDate, "final")))
      .resolves.toMatchObject({ decision: "deny", code: "ADAPTER_UNAVAILABLE" });
  });

  test("maps semantic reply and suppression facts before freshness", async () => {
    for (const [extra, code] of [
      [{ humanReply: true }, "HUMAN_REPLY_ARRIVED"],
      [{ suppressionStatus: "opted_out" }, "CONTACT_SUPPRESSED"],
    ] as const) {
      const current = facts("conversation_reply", extra);
      await expect(new ExternalEffectPolicy({ read: async () => current }).preview(input("conversation_reply", current)))
        .resolves.toMatchObject({ decision: "deny", code });
    }
    const current = facts("campaign_activation", { accountHealth: { status: "degraded", checkedAt: "2026-08-29T09:00:00Z" } });
    await expect(new ExternalEffectPolicy({ read: async () => current }).preview(input("campaign_activation", current)))
      .resolves.toMatchObject({ decision: "deny", code: "ACCOUNT_UNHEALTHY" });
  });

  test("enforces the persisted preview/final facts version chain", async () => {
    const current = facts("conversation_reply");
    const stalePreview = { ...proposal("conversation_reply"), policyPreview: { factsVersion: 10 } };
    await expect(new ExternalEffectPolicy({ read: async () => current }).preview({ context, proposal: stalePreview, phase: "preview", sourceSnapshot: source("conversation_reply") }))
      .resolves.toMatchObject({ decision: "deny", code: "SOURCE_STALE" });
    const finalAhead = { ...proposal("conversation_reply"), policyPreview: undefined, policyFinal: { factsVersion: 12 } };
    await expect(new ExternalEffectPolicy({ read: async () => current }).final({ context, proposal: finalAhead, phase: "final", sourceSnapshot: source("conversation_reply") }))
      .resolves.toMatchObject({ decision: "deny", code: "ADAPTER_UNAVAILABLE" });
  });

  test("rejects offset time zones even when Intl accepts them", async () => {
    const current = facts("meeting_proposal", { timeZone: "+01:00" });
    await expect(new ExternalEffectPolicy({ read: async () => current }).preview(input("meeting_proposal", current)))
      .resolves.toMatchObject({ decision: "deny", code: "ADAPTER_UNAVAILABLE" });
  });

  test("fails closed when content readiness facts are absent", async () => {
    const current = facts("content_publication");
    const incomplete = { ...current } as Record<string, unknown>;
    delete incomplete.assetReady;
    await expect(new ExternalEffectPolicy({ read: async () => incomplete }).preview(input("content_publication", current)))
      .resolves.toMatchObject({ decision: "deny", code: "ADAPTER_UNAVAILABLE" });
  });

  test("compares campaign enrollment fingerprint independently of factsVersion", async () => {
    const current = facts("campaign_activation", { adapterAvailable: true });
    const changed = { ...source("campaign_activation"), enrollmentFingerprint: "b".repeat(64) };
    await expect(new ExternalEffectPolicy({ read: async () => current }).preview({ context, proposal: proposal("campaign_activation"), sourceSnapshot: changed }))
      .resolves.toMatchObject({ decision: "deny", code: "SOURCE_STALE", factsVersion: 11 });
  });

  test.each([
    ["uppercase", "A".repeat(64)],
    ["too short", "a".repeat(63)],
    ["too long", "a".repeat(65)],
    ["non-hex", `${"a".repeat(63)}g`],
  ])("rejects campaign facts with %s enrollment fingerprint", async (_label, enrollmentFingerprint) => {
    const current = facts("campaign_activation", { adapterAvailable: true, enrollmentFingerprint });
    await expect(new ExternalEffectPolicy({ read: async () => current }).preview(input("campaign_activation", current)))
      .resolves.toMatchObject({ decision: "deny", code: "ADAPTER_UNAVAILABLE", factsVersion: 0 });
  });

  test("compares a valid campaign enrollment fingerprint from the source snapshot", async () => {
    const current = facts("campaign_activation", { adapterAvailable: true });
    const changed = { ...source("campaign_activation"), enrollmentFingerprint: "b".repeat(64) };
    await expect(new ExternalEffectPolicy({ read: async () => current }).preview({
      context, proposal: proposal("campaign_activation"), sourceSnapshot: changed,
    })).resolves.toMatchObject({ decision: "deny", code: "SOURCE_STALE", factsVersion: 11 });
  });

  test.each(["A".repeat(64), "a".repeat(63), "a".repeat(65)])("rejects a malformed enrollment fingerprint in the source snapshot: %s", async (enrollmentFingerprint) => {
    const current = facts("campaign_activation", { adapterAvailable: true });
    await expect(new ExternalEffectPolicy({ read: async () => current }).preview({
      context, proposal: proposal("campaign_activation"), sourceSnapshot: { ...source("campaign_activation"), enrollmentFingerprint },
    })).resolves.toMatchObject({ decision: "deny", code: "SOURCE_STALE", factsVersion: 11 });
  });
});
