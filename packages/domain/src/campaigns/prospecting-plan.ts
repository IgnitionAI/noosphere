export const PROSPECTING_CHANNELS = ["linkedin", "email", "whatsapp"] as const;
export type ProspectingChannel = (typeof PROSPECTING_CHANNELS)[number];

export type ChannelRecommendation = "recommended" | "optional" | "unsuitable";

export interface ChannelAssessmentMetrics {
  readonly sampleSize: number;
  readonly accountsFound: number;
  readonly peopleFound: number;
  readonly eligibleIdentities: number;
  readonly verifiedIdentities: number;
}

export interface ChannelAssessmentDecision {
  readonly recommendation: ChannelRecommendation;
  readonly score: number;
  readonly rationale: string;
}

export function decideChannelRecommendation(
  channel: ProspectingChannel,
  metrics: ChannelAssessmentMetrics,
): ChannelAssessmentDecision {
  const sampleSize = Math.max(1, metrics.sampleSize);
  const eligibleCoverage = metrics.eligibleIdentities / sampleSize;
  const verifiedCoverage = metrics.verifiedIdentities / sampleSize;
  const accountCoverage = metrics.accountsFound / sampleSize;

  if (channel === "linkedin") {
    const score = boundedScore(55 * eligibleCoverage + 25 * accountCoverage + 20 * verifiedCoverage);
    if (metrics.eligibleIdentities >= 3 && eligibleCoverage >= 0.3) {
      return {
        recommendation: "recommended",
        score,
        rationale: `${metrics.eligibleIdentities} profils LinkedIn éligibles observés sur ${metrics.sampleSize}.`,
      };
    }
    if (metrics.eligibleIdentities > 0) {
      return {
        recommendation: "optional",
        score,
        rationale: "Des profils existent, mais la couverture observée reste trop faible pour automatiser une campagne.",
      };
    }
    return {
      recommendation: "unsuitable",
      score,
      rationale: "Aucun profil LinkedIn éligible n’a été observé pendant le test.",
    };
  }

  if (channel === "email") {
    const score = boundedScore(45 * accountCoverage + 35 * eligibleCoverage + 20 * verifiedCoverage);
    if (metrics.accountsFound >= 3 && metrics.eligibleIdentities >= 2) {
      return {
        recommendation: "recommended",
        score,
        rationale: `${metrics.accountsFound} entreprises et ${metrics.eligibleIdentities} emails professionnels éligibles observés.`,
      };
    }
    if (metrics.accountsFound > 0) {
      return {
        recommendation: "optional",
        score,
        rationale: "Des entreprises sont accessibles, mais la couverture email doit encore être enrichie.",
      };
    }
    return {
      recommendation: "unsuitable",
      score,
      rationale: "Aucune entreprise vérifiable n’a été observée pendant le test email.",
    };
  }

  const score = boundedScore(35 * accountCoverage + 25 * eligibleCoverage + 40 * verifiedCoverage);
  if (metrics.verifiedIdentities >= 2) {
    return {
      recommendation: "recommended",
      score,
      rationale: `${metrics.verifiedIdentities} identités WhatsApp professionnelles vérifiées pendant le test.`,
    };
  }
  if (metrics.eligibleIdentities > 0) {
    return {
      recommendation: "optional",
      score,
      rationale: "Des numéros professionnels sont sourcés, mais leur couverture WhatsApp vérifiée est insuffisante.",
    };
  }
  return {
    recommendation: "unsuitable",
    score,
    rationale: "Aucune identité WhatsApp professionnelle attribuable n’a été observée.",
  };
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
