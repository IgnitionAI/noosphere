import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const METROPOLITAN_MOBILE_PATTERN = /(?:\+33|0033|0)[\s.()\/-]*(?:6|7)(?:[\s.()\/-]*\d{2}){4}/g;
const PROFESSIONAL_CONTEXT_PATTERN = /\b(?:portable|mobile|whats\s?app|t(?:é|e)l(?:éphone)?|contact|joindre|appel(?:er)?)\b/i;

export type PhoneAttributionStatus = "strong" | "weak" | "conflict" | "rejected";
export type PhoneEndpointKind = "person" | "company";

export interface PublicPhoneObservation {
  readonly rawValue: string;
  readonly e164: string | null;
  readonly endpointKind: PhoneEndpointKind;
  readonly personName: string | null;
  readonly personRole: string | null;
  readonly attributionStatus: PhoneAttributionStatus;
  readonly attributionReason: string;
  readonly rejectionReason: string | null;
  readonly evidenceSnippet: string;
}

export function extractPublicWhatsappObservations(input: {
  readonly markdown: string;
  readonly sourceUrl: string;
  readonly sourceTitle: string | null;
  readonly companyName: string;
  readonly companyDomain: string;
  readonly sourceKind: string;
}): readonly PublicPhoneObservation[] {
  const observations: PublicPhoneObservation[] = [];
  const seen = new Set<string>();
  for (const match of input.markdown.matchAll(METROPOLITAN_MOBILE_PATTERN)) {
    const rawValue = match[0].trim();
    const e164 = normalizeMetropolitanFrenchMobile(rawValue);
    const snippet = visibleContext(input.markdown, match.index ?? 0, rawValue.length);
    const key = e164 ?? `rejected:${rawValue.replace(/\s+/g, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!e164) {
      observations.push(rejected(rawValue, snippet, "NOT_METROPOLITAN_FRENCH_MOBILE"));
      continue;
    }
    if (!PROFESSIONAL_CONTEXT_PATTERN.test(snippet)) {
      observations.push(rejected(rawValue, snippet, "PROFESSIONAL_CONTEXT_MISSING", e164));
      continue;
    }
    const sameOfficialDomain = sameHostname(input.sourceUrl, input.companyDomain);
    if (input.sourceKind === "web" && !sameOfficialDomain) {
      observations.push({
        rawValue,
        e164,
        endpointKind: "company",
        personName: null,
        personRole: null,
        attributionStatus: "weak",
        attributionReason: "Le numéro est public mais la page n’appartient pas au domaine officiel résolu.",
        rejectionReason: "COMPANY_ATTRIBUTION_WEAK",
        evidenceSnippet: snippet,
      });
      continue;
    }
    const namedPerson = personContext(snippet, input.companyName);
    observations.push({
      rawValue,
      e164,
      endpointKind: namedPerson ? "person" : "company",
      personName: namedPerson?.name ?? null,
      personRole: namedPerson?.role ?? null,
      attributionStatus: "strong",
      attributionReason: namedPerson
        ? "Le nom, la fonction et l’entreprise sont adjacents au mobile sur une page publique officielle."
        : "Le mobile est présenté comme point de contact professionnel sur le domaine officiel de l’entreprise.",
      rejectionReason: null,
      evidenceSnippet: snippet,
    });
  }
  return observations;
}

export function normalizeMetropolitanFrenchMobile(value: string): string | null {
  try {
    const parsed = parsePhoneNumberFromString(value, "FR");
    if (!parsed || !parsed.isValid() || parsed.country !== "FR") return null;
    if (parsed.getType() !== "MOBILE") return null;
    if (!/^[67]\d{8}$/.test(parsed.nationalNumber)) return null;
    return parsed.number;
  } catch {
    return null;
  }
}

function rejected(
  rawValue: string,
  evidenceSnippet: string,
  rejectionReason: string,
  e164: string | null = null,
): PublicPhoneObservation {
  return {
    rawValue,
    e164,
    endpointKind: "company",
    personName: null,
    personRole: null,
    attributionStatus: "rejected",
    attributionReason: "Le numéro ne satisfait pas les règles déterministes de la V1.",
    rejectionReason,
    evidenceSnippet,
  };
}

function visibleContext(markdown: string, index: number, length: number): string {
  const start = Math.max(0, index - 220);
  const end = Math.min(markdown.length, index + length + 220);
  return markdown
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 520);
}

function sameHostname(sourceUrl: string, expectedDomain: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    return host === expectedDomain || host.endsWith(`.${expectedDomain}`);
  } catch {
    return false;
  }
}

function personContext(
  snippet: string,
  companyName: string,
): { name: string; role: string } | null {
  if (!snippet.toLocaleLowerCase("fr").includes(companyName.toLocaleLowerCase("fr"))) return null;
  const match = snippet.match(
    /\b([A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÿ'’-]{1,40}\s+[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÿ'’-]{1,60})\s*[·|,—-]\s*([^|,;]{3,100})/,
  );
  if (!match) return null;
  const role = match[2]!.trim();
  if (!/\b(?:dirigeant|directeur|directrice|associ(?:é|ée)|fondateur|fondatrice|consultant|consultante|avocat|avocate|responsable|gérant|gérante)\b/i.test(role)) {
    return null;
  }
  return { name: match[1]!.trim(), role };
}
