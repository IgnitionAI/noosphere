const NEGATED_TERM = /(?:^|\s)-(?:"[^"]+"|'[^']+'|\S+)/g;
const PARENTHETICAL_GROUP = /\(([^()]*)\)/g;
const SEARCH_SYNTAX = /\b(?:AND|OR|NOT)\b|\b(?:site|location|headcount):\S+/gi;
const NOISY_GROUP = /\b(?:NAF|SIREN|SIRET|employ[eé]s?|employees?|headcount)\b|\b\d{2}(?:\.\d{2})?[A-Z]\b|\d+\s*\+/i;

/**
 * Compile LLM-authored Boolean research strategies into short discovery queries.
 * Metasearch engines lose recall when they receive the complete qualification
 * policy (titles, signals, exclusions and headcount) as one giant query. The
 * crawler discovers companies here; qualification remains a later step.
 */
export function buildCompanySearchQueries(
  query: string,
  sourceKinds: readonly string[],
  limit = 3,
): string[] {
  const positive = query
    .split(/\b(?:exclude|exclure|excluding)\b/i)[0]!
    .replace(NEGATED_TERM, " ");
  const groups = [...positive.matchAll(PARENTHETICAL_GROUP)]
    .map((match) => match[1] ?? "")
    .filter((group) => group && !NOISY_GROUP.test(group))
    .map((group) => group.split(/\s+OR\s+/i).map(cleanFragment).filter(Boolean))
    .filter((alternatives) => alternatives.length > 0)
    .slice(0, 2);
  const outsideGroups = cleanFragment(positive.replace(PARENTHETICAL_GROUP, " "));
  const variantCount = Math.max(1, Math.min(3, ...groups.map((group) => group.length)));
  const seeds = Array.from({ length: variantCount }, (_, index) => compactWords([
    outsideGroups,
    ...groups.map((group) => group[index % group.length]),
  ].filter(Boolean).join(" "))).filter(Boolean);
  const kinds = sourceKinds.length ? sourceKinds : ["web"];
  const compiled: string[] = [];
  for (let index = 0; compiled.length < limit && index < Math.max(seeds.length, kinds.length); index += 1) {
    const seed = seeds[index % seeds.length]!;
    const suffix = suffixFor(kinds[index % kinds.length]!);
    const value = compactWords(`${seed} ${suffix}`, 24, 220);
    if (value && !compiled.includes(value)) compiled.push(value);
  }
  return compiled;
}

function cleanFragment(value: string): string {
  return value
    .replace(SEARCH_SYNTAX, " ")
    .replace(/["'“”()\[\],;:]/g, " ")
    .replace(/\b(?:NAF|SIREN|SIRET)\s*[\d.A-Z-]+\b/gi, " ")
    .replace(/\b\d+\s*\+?\s*(?:employ[eé]s?|employees?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactWords(value: string, maxWords = 16, maxLength = 180): string {
  const seen = new Set<string>();
  const words = value.split(/\s+/).filter((word) => {
    const normalized = word.toLocaleLowerCase("fr");
    if (!word || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  let compact = "";
  for (const word of words.slice(0, maxWords)) {
    const next = compact ? `${compact} ${word}` : word;
    if (next.length > maxLength) break;
    compact = next;
  }
  return compact;
}

function suffixFor(kind: string): string {
  if (kind === "maps") return "adresse établissement";
  if (kind === "official_registry") return "registre officiel entreprise";
  if (kind === "professional_directory") return "annuaire professionnel";
  if (kind === "jobs") return "recrutement entreprise";
  if (kind === "news") return "actualité entreprise";
  return "site officiel entreprise équipe";
}
