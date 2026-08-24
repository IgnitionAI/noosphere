import { describe, expect, test } from "bun:test";
import {
  LINKEDIN_CANARY_CONFIRMATION,
  assertLinkedinCanaryAuthorization,
  evaluateLinkedinCanary,
  type LinkedinCanaryEvidence,
} from "@outbound/application/product-truth/linkedin-canary";

const hash = "a".repeat(64);

describe("PTC-IN-LI-001 LinkedIn product truth", () => {
  test("never upgrades simulated evidence to product verified", () => {
    const verdict = evaluateLinkedinCanary(completeEvidence({ execution: "simulated" }));
    expect(verdict.state).toBe("implemented_unverified");
    expect(verdict.claims.find((claim) => claim.id === "authorized_real_publication")?.passed).toBe(false);
  });

  test("fails closed until the exact account and content hash are authorized", () => {
    expect(() => assertLinkedinCanaryAuthorization({
      confirmation: LINKEDIN_CANARY_CONFIRMATION,
      authorizedAccountId: "linkedin-authorized",
      selectedAccountId: "linkedin-other",
      authorizedContentHash: hash,
      selectedContentHash: hash,
    })).toThrow("LINKEDIN_CANARY_ACCOUNT_MISMATCH");
    expect(() => assertLinkedinCanaryAuthorization({
      confirmation: LINKEDIN_CANARY_CONFIRMATION,
      authorizedAccountId: "linkedin-authorized",
      selectedAccountId: "linkedin-authorized",
      authorizedContentHash: hash,
      selectedContentHash: "b".repeat(64),
    })).toThrow("LINKEDIN_CANARY_CONTENT_MISMATCH");
  });

  test("requires every real continuation before declaring product verified", () => {
    const partial = evaluateLinkedinCanary(completeEvidence({ bookingId: null }));
    expect(partial.state).toBe("partially_working");
    expect(partial.claims.find((claim) => claim.id === "attributed_booking")?.passed).toBe(false);

    const complete = evaluateLinkedinCanary(completeEvidence());
    expect(complete.state).toBe("product_verified");
    expect(complete.claims.every((claim) => claim.passed)).toBe(true);
  });

  test("treats a duplicate provider effect after restart as a failed L4 claim", () => {
    const verdict = evaluateLinkedinCanary(completeEvidence({ duplicateProviderPostCount: 1 }));
    expect(verdict.state).toBe("partially_working");
    expect(verdict.claims.find((claim) => claim.id === "restart_without_duplicate")?.passed).toBe(false);
  });
});

function completeEvidence(overrides: Partial<LinkedinCanaryEvidence> = {}): LinkedinCanaryEvidence {
  return {
    execution: "real",
    authorizationConfirmed: true,
    strategyVersionId: "strategy-version",
    ideaId: "idea",
    sourceCount: 2,
    briefId: "brief",
    assetVersionId: "asset-version",
    contentHash: hash,
    accountId: "linkedin-authorized",
    publicationId: "publication",
    providerPostId: "provider-post",
    providerUrl: "https://www.linkedin.com/feed/update/provider-post",
    publicationAttemptCount: 1,
    duplicateProviderPostCount: 0,
    restartObserved: true,
    interactionId: "interaction",
    providerInteractionId: "provider-interaction",
    contactId: "contact",
    socialSignalEligible: true,
    conversationId: "conversation",
    responseProviderMessageId: "provider-message",
    bookingId: "booking",
    bookingAttributionTouchId: "touch",
    ...overrides,
  };
}
