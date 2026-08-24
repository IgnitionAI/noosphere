export interface EvaluationOutput {
  readonly classification?: string;
  readonly ctaPresent?: boolean;
  readonly knowledgeClaimIds?: readonly string[];
  readonly [key: string]: unknown;
}

export interface DeterministicEvaluationScore {
  readonly exactness: number;
  readonly ctaQuality: number;
  readonly messageQuality: number;
  readonly claimCompliance: number;
  readonly hallucinationCount: number;
  readonly hallucinationRate: number;
}

export function scoreEvaluationOutput(input: {
  readonly actual: EvaluationOutput;
  readonly expected: EvaluationOutput;
  readonly criteria?: Readonly<Record<string, unknown>>;
  readonly authorizedKnowledgeClaimIds: readonly string[];
}): DeterministicEvaluationScore {
  const comparable = Object.entries(input.expected).filter(([key, value]) => key !== "ctaPresent" && isScalar(value));
  const exactness = comparable.length === 0 ? 1 : comparable.filter(([key, value]) => input.actual[key] === value).length / comparable.length;
  const expectedCta = input.expected.ctaPresent;
  const ctaQuality = expectedCta === undefined
    ? 1
    : Number(input.actual.ctaPresent === expectedCta);
  const emittedClaims = uniqueStrings(input.actual.knowledgeClaimIds);
  const authorized = new Set(input.authorizedKnowledgeClaimIds);
  const hallucinationCount = emittedClaims.filter((claimId) => !authorized.has(claimId)).length;
  const hallucinationRate = emittedClaims.length === 0 ? 0 : hallucinationCount / emittedClaims.length;
  const messageQuality = deterministicMessageQuality(input.actual.content, input.criteria);

  return {
    exactness,
    ctaQuality,
    messageQuality,
    claimCompliance: emittedClaims.length === 0 ? 1 : 1 - hallucinationRate,
    hallucinationCount,
    hallucinationRate,
  };
}

function deterministicMessageQuality(content: unknown, criteria: Readonly<Record<string, unknown>> | undefined): number {
  const rules: boolean[] = [];
  const message = typeof content === "string" ? content : "";
  const normalized = message.toLocaleLowerCase("fr");
  const minLength = typeof criteria?.minLength === "number" ? criteria.minLength : null;
  const maxLength = typeof criteria?.maxLength === "number" ? criteria.maxLength : null;
  if (minLength !== null) rules.push(message.length >= minLength);
  if (maxLength !== null) rules.push(message.length <= maxLength);
  for (const term of stringList(criteria?.requiredTerms)) rules.push(normalized.includes(term.toLocaleLowerCase("fr")));
  for (const term of stringList(criteria?.forbiddenTerms)) rules.push(!normalized.includes(term.toLocaleLowerCase("fr")));
  return rules.length === 0 ? 1 : rules.filter(Boolean).length / rules.length;
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

export function assertSyntheticEvaluationCase(input: { readonly input: unknown; readonly expected: unknown }): void {
  const serialized = JSON.stringify(input);
  if (containsPersonalData(serialized)) throw new Error("EVALUATION_CASE_PII_FORBIDDEN");
}

export interface PromptVersion {
  readonly id: string;
  readonly version: number;
  readonly content: string;
  readonly createdAt: Date;
  readonly previousVersionId?: string;
}

export function createNextPromptVersion(
  current: PromptVersion,
  successor: { readonly id: string; readonly content: string; readonly createdAt: Date },
): PromptVersion {
  if (!successor.content.trim()) throw new Error("PROMPT_CONTENT_REQUIRED");
  return {
    id: successor.id,
    version: current.version + 1,
    content: successor.content,
    createdAt: successor.createdAt,
    previousVersionId: current.id,
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))];
}

function containsPersonalData(value: string): boolean {
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const linkedInPerson = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w%-]+/i;
  const phone = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){3,}\d{2,4}/;
  return email.test(value) || linkedInPerson.test(value) || phone.test(value);
}
