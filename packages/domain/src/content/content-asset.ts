export const MAX_CONTENT_FACTUAL_CLAIMS = 20;
import type { LinkedinContentFormat } from "@outbound/domain/content/content-brand-kit";

export const contentGenerationStages = ["brief", "writer", "audit", "critic", "completed"] as const;
export type ContentGenerationStage = (typeof contentGenerationStages)[number];

export const MAX_CONTENT_BODY_LENGTH = 1_500;

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
  /** Present on current complete audits; historical snapshots remain readable. */
  readonly coverage?: {
    readonly version: 1;
    readonly evidenceFingerprint: string;
    readonly passages: readonly {
      readonly field: string;
      readonly text: string;
      readonly classification: "factual" | "non_factual" | "mixed";
      readonly nonFactualReason: string | null;
      readonly claims: readonly {
        readonly statement: string;
        readonly kind: "factual" | "attribution";
        readonly sourceKeys: readonly string[];
        readonly verdict: "supported" | "unsupported";
        readonly reason: string;
      }[];
    }[];
  } | undefined;
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

export class ContentDraftUnsourcedNumberError extends Error {
  constructor(readonly locations: readonly { readonly field: string; readonly numbers: readonly string[] }[]) {
    super("CONTENT_DRAFT_UNSOURCED_NUMBER");
    this.name = "ContentDraftUnsourcedNumberError";
  }
}

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
    throw new ContentDraftUnsourcedNumberError(unsourcedNumberLocations(draft, new Set(bodyNumbers.filter(token => !groundedNumbers.has(token)))));
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

export function contentPublicText(draft: ContentDraftSnapshot, omitStructuralNumbers = false): string {
  return contentPublicFields(draft, omitStructuralNumbers).map(entry => entry.text).join("\n");
}

export function contentPublicFields(draft: ContentDraftSnapshot, omitStructuralNumbers = false) {
  const plan = normalizedMediaPlan(draft);
  const titles = plan.slides.map(slide => slide.title);
  const slideTitles = omitStructuralNumbers ? stripOrderedListMarkers(titles) : titles;
  const kickers = plan.slides.map(slide => slide.kicker ?? "");
  const slideKickers = omitStructuralNumbers ? stripSequenceKickers(kickers) : kickers;
  const fields: { field: string; text: string }[] = [];
  const add = (field: string, text: string | null | undefined) => { if (text) fields.push({ field, text }); };
  add("body", draft.body);
  add("mediaPlan.title", plan.title);
  add("mediaPlan.subtitle", plan.subtitle);
  plan.slides.forEach((slide, index) => {
    const prefix = `mediaPlan.slides[${index}]`;
    add(`${prefix}.kicker`, slideKickers[index]);
    add(`${prefix}.title`, slideTitles[index]);
    add(`${prefix}.body`, slide.body);
    add(`${prefix}.callout`, slide.callout);
    const items = slide.items ?? [];
    const labels = items.map(item => item.label);
    const itemLabels = omitStructuralNumbers ? stripOrderedItemLabels(labels) : labels;
    items.forEach((item, itemIndex) => {
      add(`${prefix}.items[${itemIndex}].label`, itemLabels[itemIndex]);
      add(`${prefix}.items[${itemIndex}].text`, item.text);
    });
  });
  plan.scenes.forEach((scene, index) => {
    add(`mediaPlan.scenes[${index}].title`, scene.title);
    add(`mediaPlan.scenes[${index}].body`, scene.body);
  });
  return fields;
}

function unsourcedNumberLocations(draft: ContentDraftSnapshot, unsupported: ReadonlySet<string>) {
  const lines = contentPublicFields(draft, true).flatMap(entry => entry.text.split("\n").map(text => ({ field: entry.field, text })));
  let text = lines.map(line => line.text).join("\n");
  // Preserve line ownership while excluding complete declared passages, including
  // historical scenarios spanning more than one public field.
  for (const scenario of draft.illustrativeScenarios ?? []) text = text.split(scenario).join(scenario.replace(/[^\n]/g, " "));
  const prose = stripOrderedListMarkers(text.replace(/https?:\/\/[^\s<>()[\]{}]+/g, "").split("\n"));
  const findings = new Map<string, Set<string>>();
  const joined = prose.join("\n");
  for (const match of numberTokenMatches(joined)) {
    if (!unsupported.has(match.token)) continue;
    const lineIndex = joined.slice(0, match.index).split("\n").length - 1;
    const field = lines[lineIndex]!.field;
    const values = findings.get(field) ?? new Set<string>();
    values.add(match.token);
    findings.set(field, values);
  }
  return [...findings].map(([field, numbers]) => ({ field, numbers: [...numbers] }));
}

/** A review must cite the exact current public copy, not an earlier draft or its brief. */
export function invalidEditorialAssessmentCriteria(draft: ContentDraftSnapshot, critique: ContentEditorialCritique): readonly (typeof editorialQualityCriteria)[number][] {
  const publicText = contentPublicText(draft);
  return editorialQualityCriteria.filter(criterion => {
    const review = critique.qualityAssessment?.[criterion];
    return !review || !["pass", "revise"].includes(review.verdict)
      || typeof review.reason !== "string" || review.reason.trim().length < 20
      || !Array.isArray(review.excerpts) || review.excerpts.length === 0
      || review.excerpts.some(excerpt => typeof excerpt !== "string" || excerpt.trim().length < 12 || !publicText.includes(excerpt));
  });
}

// A narrowly identifiable explanatory question: third-person subject, one
// question, and explicit answers for both branches. Direct reader requests and
// incomplete answers retain the conservative punctuation check.
function isAnsweredDecisionQuestion(line: string): boolean {
  const parts = line.split("?");
  if (parts.length !== 2 || /\b(?:vous|votre|vos|tu|ton|ta|tes)\b/i.test(line)) return false;
  const question = parts[0]!;
  const answer = parts[1]!.trim();
  return /-(?:il|elle|ils|elles)\b/i.test(question)
    && /^(?:si oui|oui)\s*[:,]\s*(?:on|il|elle|ils|elles|le|la|les|un|une|des)\b[^.!;:,\n]+[.!;]\s+(?:si (?!oui\b)[^.!;?:,\n]+,|(?:sinon|non)\s*[:,])\s*(?:on|il|elle|ils|elles|le|la|les|un|une|des)\b[^.!;:,\n]+[.!]?$/i.test(answer)
    && answer.length >= 40;
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
  const assessment = input.critique.qualityAssessment;
  if (!assessment) blockers.add("editorial_assessment_missing");
  else {
    if (invalidEditorialAssessmentCriteria(input.draft, input.critique).length) blockers.add("editorial_assessment_invalid");
    for (const criterion of editorialQualityCriteria) {
      if (assessment[criterion]?.verdict === "revise") blockers.add(`editorial_${criterion}`);
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
  if (input.draft.body.trim().length > MAX_CONTENT_BODY_LENGTH) blockers.add("too_long");
  // A title quotation or a diagnostic checklist is not a competing CTA.
  // Editorial critique still checks whether the list supplies genuine reader value.
  const readerQuestions = input.draft.body
    .replace(/https?:\/\/[^\s<>"«»\)\]]+/gi, "")
    .replace(/«[^»]*»/g, "")
    .split("\n")
    .filter((line) => !/^[ \t]*\d{1,2}[.)][ \t]+/.test(line))
    .filter((line) => !isAnsweredDecisionQuestion(line))
    .join("\n");
  if ((readerQuestions.match(/\?/g) ?? []).length > 1) blockers.add("multiple_questions");
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
  if (!reviewedStatement.includes(draftStatement)) return false;
  const reviewedSources = new Set(reviewed.sourceKeys);
  return draftClaim.sourceKeys.every((key) => reviewedSources.has(key));
}

function numberTokens(value: string): readonly string[] {
  // Citation addresses and ordered-list markers describe the document's structure,
  // not a measured outcome. Numbers inside each list item still require evidence.
  const prose = stripOrderedListMarkers(value.replace(/https?:\/\/[^\s<>()[\]{}]+/g, "").split("\n")).join("\n");
  return numberTokenMatches(prose).map(match => match.token);
}

function numberTokenMatches(value: string) {
  return [...value.matchAll(/\b\d+(?:[.,]\d+)?(?:\s?%|\s?[kKmM€$])?\b/g)].map(match => ({ token: match[0]!.replace(/\s/g, "").toLowerCase(), index: match.index }));
}

function stripSequenceKickers(values: readonly string[]): readonly string[] {
  // Only a complete, ordered sequence of standalone navigation labels is structural.
  // Prose, quantities, percentages and numbers in the rest of the slide stay audited.
  const groups = new Map<string, Array<{ index: number; ordinal: number }>>();
  values.forEach((value, index) => {
    const match = value.trim().match(/^(branche|branch|étape|step|phase|partie|part)\s+([1-9]\d?)$/i);
    if (!match) return;
    const label = match[1]!.toLocaleLowerCase("fr-FR");
    const group = groups.get(label) ?? [];
    group.push({ index, ordinal: Number(match[2]) });
    groups.set(label, group);
  });
  const result = [...values];
  for (const [label, group] of groups) {
    if (group.length < 2 || !group.every((entry, index) => entry.ordinal === index + 1)) continue;
    for (const entry of group) result[entry.index] = label;
  }
  return result;
}

function stripOrderedItemLabels(values: readonly string[]): readonly string[] {
  const matches = values.map(value => value.match(/^([1-9]\d?)(?:[.)][ \t]+|[ \t]+[—–-][ \t]+)(.+)$/));
  if (matches.length < 2 || !matches.every((match, index) => match && Number(match[1]) === index + 1)) return values;
  return matches.map(match => match![2]!);
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
