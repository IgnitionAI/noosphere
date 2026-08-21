const DEFAULT_SIGNAL_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_SOCIAL_BOOST = 20;

export type SocialInteractionKind = "comment" | "reply" | "mention" | "reaction";

export interface SocialProspectSignalFact {
  readonly id: string;
  readonly type: SocialInteractionKind;
  readonly direction: string;
  readonly status: string;
  readonly body: string | null;
  readonly reaction: string | null;
  readonly occurredAt: Date;
  readonly identityCertainty: string;
  readonly identityRule: string;
  readonly identityConfidence: number;
  readonly identityProofType: string;
  readonly proofHref: string;
}

export interface EligibleSocialProspectSignal {
  readonly id: string;
  readonly type: Exclude<SocialInteractionKind, "reaction">;
  readonly summary: string;
  readonly occurredAt: Date;
  readonly contribution: number;
  readonly identityRule: string;
  readonly identityConfidence: number;
  readonly proofHref: string;
}

export interface IgnoredSocialProspectSignal {
  readonly id: string;
  readonly type: SocialInteractionKind;
  readonly occurredAt: Date;
  readonly reason:
    | "reaction_inert"
    | "not_incoming"
    | "removed"
    | "identity_not_exact"
    | "expired";
  readonly explanation: string;
  readonly proofHref: string;
}

export interface SocialProspectSignalAssessment {
  readonly evaluatedAt: Date;
  readonly baseScore: number | null;
  readonly socialBoost: number;
  readonly effectiveScore: number | null;
  readonly eligibleSignals: readonly EligibleSocialProspectSignal[];
  readonly ignoredSignals: readonly IgnoredSocialProspectSignal[];
  readonly openLinkedinConversation: boolean;
  readonly decisionImpact: "boosted" | "conversation_open" | "none";
}

/**
 * Projects proved LinkedIn intent onto an ICP score without changing ICP
 * eligibility. Reactions are deliberately inert: a like can never create an
 * outbound action.
 */
export function assessSocialProspectSignals(input: {
  readonly now: Date;
  readonly baseScore: number | null;
  readonly signals: readonly SocialProspectSignalFact[];
  readonly openLinkedinConversation: boolean;
  readonly signalTtlMs?: number;
}): SocialProspectSignalAssessment {
  const ttlMs = input.signalTtlMs ?? DEFAULT_SIGNAL_TTL_MS;
  const eligibleSignals: EligibleSocialProspectSignal[] = [];
  const ignoredSignals: IgnoredSocialProspectSignal[] = [];
  const seen = new Set<string>();

  for (const signal of [...input.signals].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())) {
    if (seen.has(signal.id)) continue;
    seen.add(signal.id);
    const ignored = ignoredReason(signal, input.now, ttlMs);
    if (ignored) {
      ignoredSignals.push({
        id: signal.id,
        type: signal.type,
        occurredAt: signal.occurredAt,
        reason: ignored.reason,
        explanation: ignored.explanation,
        proofHref: signal.proofHref,
      });
      continue;
    }
    const type = signal.type as EligibleSocialProspectSignal["type"];
    eligibleSignals.push({
      id: signal.id,
      type,
      summary: signal.body?.trim() || explicitSignalLabel(type),
      occurredAt: signal.occurredAt,
      contribution: contribution(type),
      identityRule: signal.identityRule,
      identityConfidence: signal.identityConfidence,
      proofHref: signal.proofHref,
    });
  }

  const socialBoost = Math.min(
    MAX_SOCIAL_BOOST,
    eligibleSignals.reduce((total, signal) => total + signal.contribution, 0),
  );
  return {
    evaluatedAt: input.now,
    baseScore: input.baseScore,
    socialBoost,
    effectiveScore: input.baseScore === null ? null : Math.min(100, input.baseScore + socialBoost),
    eligibleSignals,
    ignoredSignals,
    openLinkedinConversation: input.openLinkedinConversation,
    decisionImpact: input.openLinkedinConversation
      ? "conversation_open"
      : socialBoost > 0
        ? "boosted"
        : "none",
  };
}

function ignoredReason(
  signal: SocialProspectSignalFact,
  now: Date,
  ttlMs: number,
): Pick<IgnoredSocialProspectSignal, "reason" | "explanation"> | null {
  if (signal.type === "reaction") {
    return { reason: "reaction_inert", explanation: "Une réaction seule ne modifie ni le score ni la prochaine action." };
  }
  if (signal.direction !== "incoming") {
    return { reason: "not_incoming", explanation: "Le signal ne provient pas du prospect." };
  }
  if (signal.status !== "observed") {
    return { reason: "removed", explanation: "Le signal n’est plus observable chez le provider." };
  }
  if (
    signal.identityCertainty !== "evidence"
    || signal.identityProofType !== "contact_identity"
    || !signal.identityRule.includes("_exact_")
    || signal.identityConfidence < 0.95
  ) {
    return { reason: "identity_not_exact", explanation: "L’identité LinkedIn exacte du prospect n’est pas prouvée." };
  }
  const ageMs = now.getTime() - signal.occurredAt.getTime();
  if (ageMs < 0 || ageMs > ttlMs) {
    return { reason: "expired", explanation: "Le signal est trop ancien pour influencer une décision actuelle." };
  }
  return null;
}

function contribution(type: EligibleSocialProspectSignal["type"]): number {
  if (type === "reply") return 12;
  if (type === "mention") return 10;
  return 8;
}

function explicitSignalLabel(type: EligibleSocialProspectSignal["type"]): string {
  if (type === "reply") return "Réponse LinkedIn explicite";
  if (type === "mention") return "Mention LinkedIn explicite";
  return "Commentaire LinkedIn explicite";
}
