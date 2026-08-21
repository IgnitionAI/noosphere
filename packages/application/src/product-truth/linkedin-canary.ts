export const LINKEDIN_CANARY_CONFIRMATION = "PUBLISH_ONE_AUTHORIZED_LINKEDIN_CANARY";

export type ProductTruthState =
  | "implemented_unverified"
  | "partially_working"
  | "blocked_unverified"
  | "product_verified";

export interface LinkedinCanaryAuthorization {
  readonly confirmation: string;
  readonly authorizedAccountId: string;
  readonly selectedAccountId: string;
  readonly authorizedContentHash: string;
  readonly selectedContentHash: string;
}

export interface LinkedinCanaryEvidence {
  readonly execution: "simulated" | "real";
  readonly authorizationConfirmed: boolean;
  readonly strategyVersionId: string | null;
  readonly ideaId: string | null;
  readonly sourceCount: number;
  readonly briefId: string | null;
  readonly assetVersionId: string | null;
  readonly contentHash: string | null;
  readonly accountId: string | null;
  readonly publicationId: string | null;
  readonly providerPostId: string | null;
  readonly providerUrl: string | null;
  readonly publicationAttemptCount: number;
  readonly duplicateProviderPostCount: number;
  readonly restartObserved: boolean;
  readonly interactionId: string | null;
  readonly providerInteractionId: string | null;
  readonly contactId: string | null;
  readonly socialSignalEligible: boolean;
  readonly conversationId: string | null;
  readonly responseProviderMessageId: string | null;
  readonly bookingId: string | null;
  readonly bookingAttributionTouchId: string | null;
}

export interface ProductTruthClaim {
  readonly id:
    | "grounded_content_chain"
    | "authorized_real_publication"
    | "restart_without_duplicate"
    | "real_interaction_and_crm_signal"
    | "conversation_and_response"
    | "attributed_booking";
  readonly requiredLevel: "L2" | "L4";
  readonly passed: boolean;
  readonly evidenceRefs: readonly string[];
}

export interface LinkedinCanaryVerdict {
  readonly contractId: "PTC-IN-LI-001";
  readonly state: ProductTruthState;
  readonly claims: readonly ProductTruthClaim[];
}

export function assertLinkedinCanaryAuthorization(input: LinkedinCanaryAuthorization): void {
  if (input.confirmation !== LINKEDIN_CANARY_CONFIRMATION) {
    throw new Error("LINKEDIN_CANARY_CONFIRMATION_REQUIRED");
  }
  if (!input.authorizedAccountId || input.authorizedAccountId !== input.selectedAccountId) {
    throw new Error("LINKEDIN_CANARY_ACCOUNT_MISMATCH");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.authorizedContentHash)) {
    throw new Error("LINKEDIN_CANARY_CONTENT_HASH_INVALID");
  }
  if (input.authorizedContentHash.toLowerCase() !== input.selectedContentHash.toLowerCase()) {
    throw new Error("LINKEDIN_CANARY_CONTENT_MISMATCH");
  }
}

export function evaluateLinkedinCanary(evidence: LinkedinCanaryEvidence): LinkedinCanaryVerdict {
  const claims: ProductTruthClaim[] = [
    claim("grounded_content_chain", "L2", Boolean(
      evidence.strategyVersionId
      && evidence.ideaId
      && evidence.sourceCount > 0
      && evidence.briefId
      && evidence.assetVersionId
      && evidence.contentHash,
    ), [
      evidence.strategyVersionId,
      evidence.ideaId,
      evidence.briefId,
      evidence.assetVersionId,
      evidence.contentHash,
    ]),
    claim("authorized_real_publication", "L4", Boolean(
      evidence.execution === "real"
      && evidence.authorizationConfirmed
      && evidence.accountId
      && evidence.publicationId
      && evidence.providerPostId
      && evidence.providerUrl,
    ), [evidence.accountId, evidence.publicationId, evidence.providerPostId, evidence.providerUrl]),
    claim("restart_without_duplicate", "L4", Boolean(
      evidence.execution === "real"
      && evidence.restartObserved
      && evidence.publicationId
      && evidence.publicationAttemptCount >= 1
      && evidence.duplicateProviderPostCount === 0,
    ), [evidence.publicationId, `attempts:${evidence.publicationAttemptCount}`, `duplicates:${evidence.duplicateProviderPostCount}`]),
    claim("real_interaction_and_crm_signal", "L4", Boolean(
      evidence.execution === "real"
      && evidence.interactionId
      && evidence.providerInteractionId
      && evidence.contactId
      && evidence.socialSignalEligible,
    ), [evidence.interactionId, evidence.providerInteractionId, evidence.contactId]),
    claim("conversation_and_response", "L4", Boolean(
      evidence.execution === "real"
      && evidence.conversationId
      && evidence.responseProviderMessageId,
    ), [evidence.conversationId, evidence.responseProviderMessageId]),
    claim("attributed_booking", "L4", Boolean(
      evidence.execution === "real"
      && evidence.bookingId
      && evidence.bookingAttributionTouchId,
    ), [evidence.bookingId, evidence.bookingAttributionTouchId]),
  ];

  const allPassed = claims.every((item) => item.passed);
  const realStarted = evidence.execution === "real" && claims.some((item) => item.requiredLevel === "L4" && item.passed);
  return {
    contractId: "PTC-IN-LI-001",
    state: allPassed
      ? "product_verified"
      : evidence.execution === "simulated"
        ? "implemented_unverified"
        : !evidence.authorizationConfirmed || !realStarted
          ? "blocked_unverified"
          : "partially_working",
    claims,
  };
}

function claim(
  id: ProductTruthClaim["id"],
  requiredLevel: ProductTruthClaim["requiredLevel"],
  passed: boolean,
  evidenceRefs: readonly (string | null)[],
): ProductTruthClaim {
  return {
    id,
    requiredLevel,
    passed,
    evidenceRefs: evidenceRefs.filter((value): value is string => Boolean(value)),
  };
}
