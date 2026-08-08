export type PopulationCriterion = {
  readonly id: string;
  readonly dimension: string;
  readonly operator: string;
  readonly expectedValue: unknown;
  readonly weight: number | null;
  readonly required: boolean;
  readonly exclusion: boolean;
};

export interface ProspectFacts {
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredChannel: string | null;
  readonly status: string;
  readonly source: string;
  readonly identities: Readonly<Record<string, readonly string[]>>;
  readonly company: Readonly<Record<string, unknown>> | null;
  readonly employment: Readonly<Record<string, unknown>> | null;
}

export interface PopulationExplanation {
  readonly facts: readonly { criterionId: string; dimension: string; value: unknown; expectedValue: unknown }[];
  readonly missing: readonly { criterionId: string; dimension: string; expectedValue: unknown }[];
  readonly exclusions: readonly { criterionId: string; dimension: string; reason: string; value?: unknown; expectedValue?: unknown }[];
}

export interface PopulationScore {
  readonly score: number;
  readonly eligible: boolean;
  readonly explanation: PopulationExplanation;
}

/** Deterministic, side-effect-free ICP criterion evaluator. */
export function scoreProspect(criteria: readonly PopulationCriterion[], facts: ProspectFacts): PopulationScore {
  const explanation: {
    facts: { criterionId: string; dimension: string; value: unknown; expectedValue: unknown }[];
    missing: { criterionId: string; dimension: string; expectedValue: unknown }[];
    exclusions: { criterionId: string; dimension: string; reason: string; value?: unknown; expectedValue?: unknown }[];
  } = { facts: [], missing: [], exclusions: [] };
  let earned = 0;
  let possible = 0;
  let eligible = true;
  for (const criterion of criteria) {
    const value = factForDimension(facts, criterion.dimension);
    const missing = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    const weight = criterion.weight === null || !Number.isFinite(criterion.weight) ? 1 : Math.max(0, criterion.weight);
    possible += weight;
    if (missing) {
      explanation.missing.push({ criterionId: criterion.id, dimension: criterion.dimension, expectedValue: criterion.expectedValue });
      if (criterion.required) {
        eligible = false;
        explanation.exclusions.push({ criterionId: criterion.id, dimension: criterion.dimension, reason: "required_data_missing", expectedValue: criterion.expectedValue });
      }
      continue;
    }
    const matched = evaluate(criterion.operator, value, criterion.expectedValue);
    if (matched) earned += weight;
    explanation.facts.push({ criterionId: criterion.id, dimension: criterion.dimension, value, expectedValue: criterion.expectedValue });
    if (criterion.required && !matched) {
      eligible = false;
      explanation.exclusions.push({ criterionId: criterion.id, dimension: criterion.dimension, reason: "required_criterion_not_met", value, expectedValue: criterion.expectedValue });
    }
    if (criterion.exclusion && matched) {
      eligible = false;
      explanation.exclusions.push({ criterionId: criterion.id, dimension: criterion.dimension, reason: "exclusion_criterion_matched", value, expectedValue: criterion.expectedValue });
    }
  }
  const raw = possible === 0 ? 0 : (earned / possible) * 100;
  return { score: Number(raw.toFixed(4)), eligible, explanation };
}

function factForDimension(facts: ProspectFacts, dimension: string): unknown {
  const key = dimension.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (key in facts && key !== "identities" && key !== "company" && key !== "employment") return (facts as unknown as Record<string, unknown>)[key];
  if (key === "first_name") return facts.firstName;
  if (key === "last_name") return facts.lastName;
  if (key === "preferred_channel" || key === "channel") return facts.preferredChannel;
  if (key === "contact_status" || key === "status") return facts.status;
  if (key === "crm_source" || key === "source") return facts.source;
  if (key.startsWith("identity.")) return facts.identities[key.slice("identity.".length)] ?? undefined;
  if (key.startsWith("company.")) return propertyValue(facts.company, key.slice("company.".length));
  if (key.startsWith("employment.")) return propertyValue(facts.employment, key.slice("employment.".length));
  if (facts.company && key in facts.company) return facts.company[key];
  if (facts.employment && key in facts.employment) return facts.employment[key];
  return undefined;
}

function propertyValue(object: Readonly<Record<string, unknown>> | null | undefined, key: string): unknown {
  if (!object) return undefined;
  if (key in object) return object[key];
  const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  if (camel in object) return object[camel];
  const matchingKey = Object.keys(object).find((candidate) => candidate.toLowerCase() === key.toLowerCase() || candidate.toLowerCase() === camel.toLowerCase());
  return matchingKey === undefined ? undefined : object[matchingKey];
}

function evaluate(operator: string, actual: unknown, expected: unknown): boolean {
  const normalized = operator.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (normalized === "exists") return actual !== undefined && actual !== null;
  if (normalized === "not_exists") return actual === undefined || actual === null;
  if (normalized === "in") return asArray(expected).some((value) => equals(actual, value));
  if (normalized === "not_in") return !asArray(expected).some((value) => equals(actual, value));
  if (normalized === "contains" || normalized === "includes") {
    if (Array.isArray(actual)) return actual.some((value) => equals(value, expected));
    return String(actual).toLocaleLowerCase().includes(String(expected).toLocaleLowerCase());
  }
  if (normalized === "gte" || normalized === "greater_than_or_equal") return numeric(actual) >= numeric(expected);
  if (normalized === "lte" || normalized === "less_than_or_equal") return numeric(actual) <= numeric(expected);
  if (normalized === "gt" || normalized === "greater_than") return numeric(actual) > numeric(expected);
  if (normalized === "lt" || normalized === "less_than") return numeric(actual) < numeric(expected);
  if (normalized === "neq" || normalized === "not_equals") return !equals(actual, expected);
  return equals(actual, expected);
}

function equals(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
  return JSON.stringify(left) === JSON.stringify(right);
}
function asArray(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [value]; }
function numeric(value: unknown): number { const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) ? number : Number.NaN; }
