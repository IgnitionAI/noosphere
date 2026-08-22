export const contentGenerationStages = ["brief", "writer", "audit", "critic", "completed"] as const;
export type ContentGenerationStage = (typeof contentGenerationStages)[number];

export const CONTENT_EDITORIAL_POLICY_VERSION = "linkedin-editorial-v2";

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

const internalAuditPhrases = [
  "ce qui est documenté",
  "notre analyse",
  "ne constitue pas une garantie",
  "n'est pas une garantie",
  "n’est pas une garantie",
  "la seule affirmation factuelle",
  "registre de preuves",
  "ce que la source ne dit pas",
  "dans les preuves fournies",
  "source fournie",
  "preuve fournie",
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
  readonly recentBodies: readonly string[];
}): { readonly ready: boolean; readonly blockers: readonly string[] } {
  assertGroundedContentDraft(input.draft, input.availableEvidenceKeys);
  const blockers = new Set<string>();
  const available = new Set(input.availableEvidenceKeys);

  for (const claim of input.draft.factualClaims) {
    if (!input.audit.reviewedClaims.some((reviewed) => reviewedClaimCoversDraftClaim(reviewed, claim))) {
      blockers.add("unaudited_claim");
    }
  }

  for (const claim of input.audit.reviewedClaims) {
    if (claim.verdict !== "supported" || claim.sourceKeys.some((key) => !available.has(key))) {
      blockers.add("unsupported_claim");
    }
  }
  if (input.audit.ungroundedStatements.length > 0) blockers.add("ungrounded_statement");
  if (input.audit.forbiddenTopicMatches.length > 0) blockers.add("forbidden_topic");
  for (const phrase of forbiddenGenericPhrases) {
    if (normalize(input.draft.body).includes(normalize(phrase))) blockers.add("generic_language");
  }
  if (internalAuditPhrases.filter((phrase) => normalize(input.draft.body).includes(normalize(phrase))).length >= 2) {
    blockers.add("audit_language");
  }
  if (input.draft.body.trim().length > 1_500) blockers.add("too_long");
  if ((input.draft.body.match(/\?/g) ?? []).length > 1) blockers.add("multiple_questions");
  if (
    input.critique.repeatedConcepts.length > 0
    || !input.critique.distinctFromHistory
    || input.recentBodies.some((body) => substantiallySimilar(input.draft.body, body))
  ) blockers.add("repetition");
  if (!input.critique.callToActionAligned) blockers.add("cta_misaligned");
  if (input.critique.issues.some((issue) => issue.severity === "blocker")) blockers.add("editorial_blocker");

  return { ready: blockers.size === 0, blockers: [...blockers] };
}

function reviewedClaimCoversDraftClaim(
  reviewed: ContentEvidenceAudit["reviewedClaims"][number],
  draftClaim: ContentDraftSnapshot["factualClaims"][number],
): boolean {
  const reviewedStatement = normalize(reviewed.statement);
  const draftStatement = normalize(draftClaim.statement);
  if (!reviewedStatement.includes(draftStatement) && !draftStatement.includes(reviewedStatement)) return false;
  const reviewedSources = new Set(reviewed.sourceKeys);
  return draftClaim.sourceKeys.every((key) => reviewedSources.has(key));
}

function numberTokens(value: string): readonly string[] {
  return [...value.matchAll(/\b\d+(?:[.,]\d+)?(?:\s?%|\s?[kKmM€$])?\b/g)].map((match) => match[0]!.replace(/\s/g, "").toLowerCase());
}

function substantiallySimilar(left: string, right: string): boolean {
  const leftTokens = lexicalTokens(left);
  const rightTokens = lexicalTokens(right);
  if (leftTokens.length < 6 || rightTokens.length < 6) return normalizeForComparison(left) === normalizeForComparison(right);
  if (jaccard(ngrams(leftTokens, 2), ngrams(rightTokens, 2)) >= 0.62) return true;
  const leftMeaningful = new Set(leftTokens.filter((token) => token.length >= 4 && !similarityStopWords.has(token)));
  const rightMeaningful = new Set(rightTokens.filter((token) => token.length >= 4 && !similarityStopWords.has(token)));
  return Math.min(leftMeaningful.size, rightMeaningful.size) >= 6 && jaccard(leftMeaningful, rightMeaningful) >= 0.82;
}

const similarityStopWords = new Set([
  "avec", "avoir", "cette", "comme", "dans", "elle", "elles", "entre", "etre", "faire", "leur", "leurs", "mais", "nous", "pour", "plus", "sans", "sont", "tout", "tous", "une", "vous",
]);

function lexicalTokens(value: string): readonly string[] {
  return normalizeForComparison(value).match(/[a-z0-9]{2,}/g) ?? [];
}

function normalizeForComparison(value: string): string {
  return normalize(value).replace(/[’']/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function ngrams(tokens: readonly string[], size: number): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index <= tokens.length - size; index += 1) result.add(tokens.slice(index, index + size).join(" "));
  return result;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}
