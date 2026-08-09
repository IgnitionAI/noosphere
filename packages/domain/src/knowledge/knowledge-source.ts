export type KnowledgeSourceStatus = "draft" | "validated" | "expired" | "withdrawn";
export type KnowledgeSourceTransition = "validate" | "expire" | "withdraw";
export type KnowledgeClaimStatus = "draft" | "validated" | "needs_resourcing";

const TRANSITIONS: Record<KnowledgeSourceStatus, Partial<Record<KnowledgeSourceTransition, KnowledgeSourceStatus>>> = {
  draft: { validate: "validated" },
  validated: { expire: "expired", withdraw: "withdrawn" },
  expired: {},
  withdrawn: {},
};

export function transitionKnowledgeSource(
  current: KnowledgeSourceStatus,
  transition: KnowledgeSourceTransition,
): KnowledgeSourceStatus {
  const next = TRANSITIONS[current][transition];
  if (!next) throw new Error("KNOWLEDGE_SOURCE_TRANSITION_INVALID");
  return next;
}

export function assertKnowledgeSourceCanBeValidated(input: {
  readonly freshnessUntil: Date | null;
  readonly now: Date;
}): void {
  if (!input.freshnessUntil) throw new Error("KNOWLEDGE_FRESHNESS_REQUIRED");
  if (input.freshnessUntil <= input.now) throw new Error("KNOWLEDGE_SOURCE_ALREADY_EXPIRED");
}

export function deriveKnowledgeClaimStatus(
  persistedStatus: "draft" | "validated",
  sources: readonly { readonly status: KnowledgeSourceStatus; readonly freshnessUntil: Date | null }[],
  now: Date,
): KnowledgeClaimStatus {
  if (persistedStatus === "draft") return "draft";
  const hasFreshValidatedSource = sources.some(
    (source) => source.status === "validated" && source.freshnessUntil !== null && source.freshnessUntil > now,
  );
  return hasFreshValidatedSource ? "validated" : "needs_resourcing";
}

export function assertKnowledgeContentHasNoProspectPii(value: string): void {
  const normalized = value.normalize("NFKC");
  const containsEmail = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(normalized);
  const containsLinkedinProfile = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\//i.test(normalized);
  const containsPhone = /(?:^|\D)(?:\+\d{1,3}[ .()-]*)?(?:\d[ .()-]*){9,14}(?:\D|$)/.test(normalized);
  if (containsEmail || containsLinkedinProfile || containsPhone) {
    throw new Error("KNOWLEDGE_PROSPECT_PII_DETECTED");
  }
}
