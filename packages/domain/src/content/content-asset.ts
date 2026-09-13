import type { LinkedinContentFormat } from "@outbound/domain/content/content-brand-kit";

export const contentGenerationStages = ["brief", "writer", "audit", "critic", "completed"] as const;
export type ContentGenerationStage = (typeof contentGenerationStages)[number];

export const CONTENT_EDITORIAL_POLICY_VERSION = "linkedin-editorial-v4";

export const editorialQualityCriteria = ["audienceRelevance", "readerValue", "coherence", "sourceAttribution", "ctaTruthfulness", "brandVoice", "distinctness"] as const;
export type ContentQualityAssessment = Readonly<Record<(typeof editorialQualityCriteria)[number], {
  readonly verdict: "pass" | "revise";
  readonly reason: string;
  readonly excerpts: readonly string[];
}>>;

export type ContentGenerationStatus = "queued" | "running" | "ready" | "blocked" | "failed";

export interface ContentBriefSnapshot {
  readonly objective: "educate" | "challenge" | "explain" | "prove";
  readonly audience: string;
  readonly problem: string;
  readonly angle: string;
  readonly format: LinkedinContentFormat;
  readonly evidenceKeys: readonly string[];
  readonly allowedClaimIds: readonly string[];
  readonly callToAction: string | null;
  readonly constraints: readonly string[];
}

export interface ContentMediaPlan {
  readonly format: LinkedinContentFormat;
  readonly visualTone: "editorial" | "technical" | "bold" | "minimal";
  readonly title: string | null;
  readonly subtitle: string | null;
  readonly altText: string | null;
  readonly slides: readonly {
    readonly title: string;
    readonly body: string;
    /** Optional for backward compatibility with the first rich-media snapshots. */
    readonly layout?: "auto" | "cover" | "insight" | "checklist" | "framework" | "comparison" | "process" | "closing";
    readonly kicker?: string | null;
    readonly callout?: string | null;
    readonly items?: readonly {
      readonly label: string;
      readonly text: string;
    }[];
  }[];
  readonly scenes: readonly {
    readonly title: string;
    readonly body: string;
    readonly durationSeconds: number;
  }[];
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
  /** Explicitly labelled invented inputs; independent audit is required before readiness. */
  readonly illustrativeScenarios?: readonly string[] | undefined;
  /** Optional only for backward-compatible stored V1 text drafts. New drafts always provide it. */
  readonly mediaPlan?: ContentMediaPlan;
}

export interface ContentEvidenceAudit {
  readonly reviewedScenarios?: readonly {
    readonly statement: string;
    readonly verdict: "hypothetical" | "misleading";
    readonly reason: string;
  }[] | undefined;
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
  /** Absent only on historical snapshots, which require reassessment before reuse. */
  readonly qualityAssessment?: ContentQualityAssessment | undefined;
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
  const publicText = contentPublicText(draft);
  const normalizedBody = normalize(publicText);
  for (const claim of draft.factualClaims) {
    if (!claim.statement.trim() || claim.sourceKeys.length === 0 || claim.sourceKeys.some((key) => !available.has(key))) {
      throw new Error("CONTENT_DRAFT_UNRESOLVED_CLAIM");
    }
    if (!normalizedBody.includes(normalize(claim.statement))) {
      throw new Error("CONTENT_DRAFT_CLAIM_NOT_IN_BODY");
    }
  }

  let factualText = contentPublicText(draft, true);
  for (const scenario of draft.illustrativeScenarios ?? []) {
    if (!/^(?:Exemple fictif|Scénario fictif|Hypothetical example)\s*:/i.test(scenario)
      || !publicText.includes(scenario)) throw new Error("CONTENT_DRAFT_SCENARIO_INVALID");
    factualText = factualText.split(scenario).join("");
  }
  const bodyNumbers = numberTokens(factualText);
  const groundedNumbers = new Set(draft.factualClaims.flatMap((claim) => numberTokens(claim.statement)));
  if (bodyNumbers.some((token) => !groundedNumbers.has(token))) {
    throw new Error("CONTENT_DRAFT_UNSOURCED_NUMBER");
  }
}

export function normalizedMediaPlan(draft: ContentDraftSnapshot): ContentMediaPlan {
  return draft.mediaPlan ?? {
    format: "linkedin_text",
    visualTone: "editorial",
    title: null,
    subtitle: null,
    altText: null,
    slides: [],
    scenes: [],
  };
}

export function assertMediaPlanMatchesBrief(brief: ContentBriefSnapshot, draft: ContentDraftSnapshot): void {
  const plan = normalizedMediaPlan(draft);
  if (plan.format !== brief.format) throw new Error("CONTENT_MEDIA_FORMAT_MISMATCH");
  if (plan.format === "linkedin_text") {
    if (plan.title || plan.subtitle || plan.altText || plan.slides.length || plan.scenes.length) throw new Error("CONTENT_MEDIA_PLAN_INVALID");
    return;
  }
  if (!plan.title || !plan.altText) throw new Error("CONTENT_MEDIA_PLAN_INVALID");
  if (plan.format === "linkedin_image") {
    if (plan.slides.length || plan.scenes.length) throw new Error("CONTENT_MEDIA_PLAN_INVALID");
    return;
  }
  if (plan.format === "linkedin_document") {
    if (plan.slides.length < 3 || plan.slides.length > 9 || plan.scenes.length) throw new Error("CONTENT_MEDIA_PLAN_INVALID");
    return;
  }
  const duration = plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  if (plan.slides.length || plan.scenes.length < 3 || plan.scenes.length > 8 || duration < 12 || duration > 60) {
    throw new Error("CONTENT_MEDIA_PLAN_INVALID");
  }
}

function contentPublicText(draft: ContentDraftSnapshot, omitStructuralNumbers = false): string {
  const plan = normalizedMediaPlan(draft);
  const slideTitles = omitStructuralNumbers
    ? stripOrderedListMarkers(plan.slides.map((slide) => slide.title))
    : plan.slides.map((slide) => slide.title);
  return [
    draft.body,
    plan.title,
    plan.subtitle,
    ...plan.slides.flatMap((slide, index) => [
      slide.kicker,
      slideTitles[index],
      slide.body,
      slide.callout,
      ...(slide.items ?? []).flatMap((item) => [item.label, item.text]),
    ]),
    ...plan.scenes.flatMap((scene) => [scene.title, scene.body]),
  ].filter((value): value is string => Boolean(value)).join("\n");
}

export function wrapCarouselText(value: string, maxCharacters: number, maxLines: number): readonly string[] {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    for (const piece of splitLongToken(word, maxCharacters)) {
      const current = lines.at(-1);
      if (!current || `${current} ${piece}`.length > maxCharacters) lines.push(piece);
      else lines[lines.length - 1] = `${current} ${piece}`;
    }
    if (lines.length > maxLines) break;
  }
  const retained = lines.slice(0, maxLines);
  if (lines.length > maxLines && retained.length) retained[retained.length - 1] = `${retained.at(-1)!.replace(/[.…]+$/, "")}…`;
  return retained.length ? retained : [""];
}

export function evaluateContentReadiness(input: {
  readonly draft: ContentDraftSnapshot;
  readonly audit: ContentEvidenceAudit;
  readonly critique: ContentEditorialCritique;
  readonly availableEvidenceKeys: readonly string[];
  readonly recentBodies: readonly string[];
  readonly evidenceExcerpts?: readonly string[];
}): { readonly ready: boolean; readonly blockers: readonly string[] } {
  assertGroundedContentDraft(input.draft, input.availableEvidenceKeys);
  const blockers = new Set<string>();
  const assessment = input.critique.qualityAssessment;
  if (!assessment) blockers.add("editorial_assessment_missing");
  else {
    const publicText = contentPublicText(input.draft);
    for (const criterion of editorialQualityCriteria) {
      const review = assessment[criterion];
      if (!review || !["pass", "revise"].includes(review.verdict)
        || typeof review.reason !== "string" || review.reason.trim().length < 20
        || !Array.isArray(review.excerpts) || review.excerpts.length === 0
        || review.excerpts.some((excerpt) => typeof excerpt !== "string" || excerpt.trim().length < 12 || !publicText.includes(excerpt))) {
        blockers.add("editorial_assessment_invalid");
      }
      if (review?.verdict === "revise") blockers.add(`editorial_${criterion}`);
    }
  }
  const declaredScenarios = new Set(input.draft.illustrativeScenarios ?? []);
  for (const reviewed of input.audit.reviewedScenarios ?? []) {
    if (reviewed.verdict === "misleading") blockers.add("misleading_scenario");
    if (!declaredScenarios.has(reviewed.statement) || reviewed.reason.trim().length < 20) blockers.add("scenario_audit_invalid");
  }
  for (const scenario of input.draft.illustrativeScenarios ?? []) {
    const reviewed = input.audit.reviewedScenarios?.filter((item) => item.statement === scenario) ?? [];
    if (!reviewed.length) blockers.add("unaudited_scenario");
    if (reviewed.some((item) => item.verdict !== "hypothetical" || item.reason.trim().length < 20)) blockers.add("misleading_scenario");
  }
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
  // A title quotation or a diagnostic checklist is not a competing CTA.
  // Editorial critique still checks whether the list supplies genuine reader value.
  const readerQuestions = input.draft.body
    .replace(/«[^»]*»/g, "")
    .split("\n")
    .filter((line) => !/^[ \t]*\d{1,2}[.)][ \t]+/.test(line))
    .join("\n");
  if ((readerQuestions.match(/\?/g) ?? []).length > 1) blockers.add("multiple_questions");
  if (
    input.critique.repeatedConcepts.length > 0
    || !input.critique.distinctFromHistory
    || input.recentBodies.some((body) => substantiallySimilar(input.draft.body, body))
  ) blockers.add("repetition");
  if (!input.critique.callToActionAligned) blockers.add("cta_misaligned");
  if (input.critique.issues.some((issue) => issue.severity === "blocker")) blockers.add("editorial_blocker");
  if (isSourceParaphrase(input.draft.body, input.evidenceExcerpts ?? [])) blockers.add("source_paraphrase");
  if (unpublishableMediaReasons(input.draft).length > 0) blockers.add("unpublishable_media");

  return { ready: blockers.size === 0, blockers: [...blockers] };
}

function unpublishableMediaReasons(draft: ContentDraftSnapshot): readonly string[] {
  const plan = normalizedMediaPlan(draft);
  if (plan.format === "linkedin_text") return [];
  const reasons: string[] = [];
  if (!plan.title || genericVisualTitle(plan.title)) reasons.push("generic_title");
  if (plan.format === "linkedin_image") {
    if ((plan.subtitle ?? "").length > 220) reasons.push("too_dense");
    return reasons;
  }
  if (plan.format === "linkedin_video") {
    if (plan.scenes.some((scene) => scene.body.length > 180 || scene.title.length > 80)) reasons.push("too_dense");
    return reasons;
  }
  const slides = plan.slides;
  const titles = slides.map((slide) => normalize(slide.title));
  if (new Set(titles).size !== titles.length) reasons.push("duplicate_slide");
  if (slides.some((slide) => substantiallySimilar(slide.body, draft.body))) reasons.push("visual_copies_body");
  const middleLayouts = [...new Set(slides.slice(1, -1).map((slide, index) => inferredSlideLayout(slide, index + 1, slides.length)))];
  const structured = slides.filter((slide) => (slide.items?.length ?? 0) >= 2 && (slide.items?.length ?? 0) <= 4);
  if (middleLayouts.length < 2 || structured.length < 1) reasons.push("monotone_carousel");
  if (slides.some((slide) => slideTooDense(slide))) reasons.push("too_dense");
  return reasons;
}

function inferredSlideLayout(
  slide: ContentMediaPlan["slides"][number],
  index: number,
  total: number,
): "cover" | "insight" | "checklist" | "framework" | "comparison" | "process" | "closing" {
  if (index === 0) return "cover";
  if (index === total - 1) return "closing";
  if (slide.layout && slide.layout !== "auto" && slide.layout !== "cover" && slide.layout !== "closing") return slide.layout;
  const count = slide.items?.length ?? 0;
  if (count === 2) return "comparison";
  if (count >= 3) return index % 2 === 0 ? "framework" : "process";
  if (slide.callout) return "insight";
  return index % 2 === 0 ? "checklist" : "insight";
}

function slideTooDense(slide: ContentMediaPlan["slides"][number]): boolean {
  const itemText = (slide.items ?? []).reduce((sum, item) => sum + item.label.length + item.text.length, 0);
  return slide.title.length > 80 || slide.body.length > 220 || itemText > 520 || Boolean(slide.callout && slide.callout.length > 160);
}

function genericVisualTitle(title: string): boolean {
  return ["insight", "idee", "point cle", "carousel", "carrousel", "slide", "titre", "visual", "visuel"].includes(normalize(title));
}

function isSourceParaphrase(body: string, excerpts: readonly string[]): boolean {
  const combined = excerpts.map((excerpt) => excerpt.trim()).filter(Boolean).join("\n");
  if (!combined) return false;
  if (excerpts.some((excerpt) => excerpt.trim().length >= 40 && substantiallySimilar(body, excerpt))) return true;
  const bodyTokens = meaningfulTokens(body);
  const sourceTokens = meaningfulTokens(combined);
  if (bodyTokens.size < 8 || sourceTokens.size === 0) return false;
  let overlap = 0;
  for (const token of bodyTokens) if (sourceTokens.has(token)) overlap += 1;
  return overlap / bodyTokens.size >= 0.72;
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(lexicalTokens(value).filter((token) => token.length >= 4 && !similarityStopWords.has(token)));
}

function splitLongToken(word: string, maxCharacters: number): readonly string[] {
  if (word.length <= maxCharacters) return [word];
  const parts: string[] = [];
  for (let index = 0; index < word.length; index += maxCharacters) parts.push(word.slice(index, index + maxCharacters));
  return parts;
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
  // Citation addresses and ordered-list markers describe the document's structure,
  // not a measured outcome. Numbers inside each list item still require evidence.
  const prose = stripOrderedListMarkers(value.replace(/https?:\/\/[^\s<>()[\]{}]+/g, "").split("\n")).join("\n");
  return [...prose.matchAll(/\b\d+(?:[.,]\d+)?(?:\s?%|\s?[kKmM€$])?\b/g)].map((match) => match[0]!.replace(/\s/g, "").toLowerCase());
}

function stripOrderedListMarkers(values: readonly string[]): readonly string[] {
  const lines = [...values];
  for (let start = 0; start < lines.length; start++) {
    if (!/^[ \t]*1[.)][ \t]+/.test(lines[start]!)) continue;
    const indices = [start];
    for (let next = start + 1; next < lines.length; next++) {
      if (!lines[next]!.trim()) continue;
      const marker = lines[next]!.match(/^[ \t]*(\d{1,2})[.)][ \t]+/);
      if (!marker || Number(marker[1]) !== indices.length + 1) break;
      indices.push(next);
    }
    if (indices.length < 2) continue;
    for (const index of indices) lines[index] = lines[index]!.replace(/^[ \t]*\d{1,2}[.)][ \t]+/, "");
    start = indices[indices.length - 1]!;
  }
  return lines;
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
