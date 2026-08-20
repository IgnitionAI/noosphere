export const contentGenerationStages = ["brief", "writer", "audit", "critic", "completed"] as const;
export type ContentGenerationStage = (typeof contentGenerationStages)[number];

export type ContentGenerationStatus = "queued" | "running" | "ready" | "blocked" | "failed";

export interface ContentBriefSnapshot {
  readonly objective: "educate" | "challenge" | "explain" | "prove";
  readonly audience: string;
  readonly problem: string;
  readonly angle: string;
  readonly format: "linkedin_text";
  readonly evidenceKeys: readonly string[];
  readonly allowedClaimIds: readonly string[];
  readonly callToAction: string | null;
  readonly constraints: readonly string[];
}

export interface ContentDraftSnapshot {
  readonly hook: string;
  readonly body: string;
  readonly callToAction: string | null;
  readonly factualClaims: readonly {
    readonly statement: string;
    readonly sourceKeys: readonly string[];
  }[];
  readonly opinionStatements: readonly string[];
}

export interface ContentEvidenceAudit {
  readonly reviewedClaims: readonly {
    readonly statement: string;
    readonly sourceKeys: readonly string[];
    readonly verdict: "supported" | "unsupported";
    readonly reason: string;
  }[];
  readonly ungroundedStatements: readonly string[];
  readonly forbiddenTopicMatches: readonly string[];
}

export interface ContentEditorialCritique {
  readonly genericPhrases: readonly string[];
  readonly repeatedConcepts: readonly string[];
  readonly callToActionAligned: boolean;
  readonly distinctFromHistory: boolean;
  readonly issues: readonly {
    readonly severity: "advice" | "blocker";
    readonly code: string;
    readonly message: string;
  }[];
  readonly summary: string;
}

const forbiddenGenericPhrases = [
  "dans un monde en constante évolution",
  "à l'ère du digital",
  "à l’ère du digital",
  "plus que jamais",
  "game changer",
  "révolutionner votre",
  "il est essentiel de",
] as const;

export function assertGroundedContentDraft(
  draft: ContentDraftSnapshot,
  availableEvidenceKeys: readonly string[],
): void {
  const available = new Set(availableEvidenceKeys);
  const normalizedBody = normalize(draft.body);
  for (const claim of draft.factualClaims) {
    if (!claim.statement.trim() || claim.sourceKeys.length === 0 || claim.sourceKeys.some((key) => !available.has(key))) {
      throw new Error("CONTENT_DRAFT_UNRESOLVED_CLAIM");
    }
    if (!normalizedBody.includes(normalize(claim.statement))) {
      throw new Error("CONTENT_DRAFT_CLAIM_NOT_IN_BODY");
    }
  }

  const bodyNumbers = numberTokens(draft.body);
  const groundedNumbers = new Set(draft.factualClaims.flatMap((claim) => numberTokens(claim.statement)));
  if (bodyNumbers.some((token) => !groundedNumbers.has(token))) {
    throw new Error("CONTENT_DRAFT_UNSOURCED_NUMBER");
  }
}

export function evaluateContentReadiness(input: {
  readonly draft: ContentDraftSnapshot;
  readonly audit: ContentEvidenceAudit;
  readonly critique: ContentEditorialCritique;
  readonly availableEvidenceKeys: readonly string[];
}): { readonly ready: boolean; readonly blockers: readonly string[] } {
  assertGroundedContentDraft(input.draft, input.availableEvidenceKeys);
  const blockers = new Set<string>();
  const available = new Set(input.availableEvidenceKeys);
  const reviewedClaims = new Map(input.audit.reviewedClaims.map((claim) => [normalize(claim.statement), claim]));

  for (const claim of input.draft.factualClaims) {
    if (!reviewedClaims.has(normalize(claim.statement))) blockers.add("unaudited_claim");
  }

  for (const claim of input.audit.reviewedClaims) {
    if (claim.verdict !== "supported" || claim.sourceKeys.length === 0 || claim.sourceKeys.some((key) => !available.has(key))) {
      blockers.add("unsupported_claim");
    }
  }
  if (input.audit.ungroundedStatements.length > 0) blockers.add("ungrounded_statement");
  if (input.audit.forbiddenTopicMatches.length > 0) blockers.add("forbidden_topic");
  for (const phrase of forbiddenGenericPhrases) {
    if (normalize(input.draft.body).includes(normalize(phrase))) blockers.add("generic_language");
  }
  if (input.critique.genericPhrases.length > 0) blockers.add("generic_language");
  if (input.critique.repeatedConcepts.length > 0 || !input.critique.distinctFromHistory) blockers.add("repetition");
  if (!input.critique.callToActionAligned) blockers.add("cta_misaligned");
  if (input.critique.issues.some((issue) => issue.severity === "blocker")) blockers.add("editorial_blocker");

  return { ready: blockers.size === 0, blockers: [...blockers] };
}

function numberTokens(value: string): readonly string[] {
  return [...value.matchAll(/\b\d+(?:[.,]\d+)?(?:\s?%|\s?[kKmM€$])?\b/g)].map((match) => match[0]!.replace(/\s/g, "").toLowerCase());
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}
