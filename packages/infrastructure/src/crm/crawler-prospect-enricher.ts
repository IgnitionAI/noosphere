import type {
  ProspectEnricher,
  ProspectEnrichmentEvidence,
  ProspectEnrichmentInput,
  ProspectEnrichmentResult,
} from "@outbound/application/crm/prospect-enrichment-ports";
import {
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
} from "@outbound/domain/crm/normalization";
import type {
  ProspectChannel,
  ProspectChannels,
} from "@outbound/domain/crm/prospect-channels";
import type { CrawledPage, CrawlerSearchResult } from "@outbound/infrastructure/ai/crawler-client";

export interface ProspectEnrichmentCrawler {
  search(input: {
    query: string;
    limit: number;
    correlationId: string;
    searchDepth?: "basic" | "advanced";
  }): Promise<readonly CrawlerSearchResult[]>;
  discover(input: {
    url: string;
    maxPages: number;
    maxDepth: number;
    correlationId: string;
  }): Promise<readonly { url: string; title: string | null; depth: number; path: string }[]>;
  readPages(input: {
    urls: readonly string[];
    correlationId: string;
    requestKey?: string;
  }): Promise<readonly CrawledPage[]>;
}

const BLOCKED_WEBSITE_HOSTS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "societe.com",
  "pappers.fr",
  "verif.com",
  "kompass.com",
  "wikipedia.org",
];
const RELEVANT_PAGE = /contact|equipe|team|about|cabinet|associe|partner|people|avocat|direction|mentions/i;
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "orange.fr",
  "wanadoo.fr",
  "laposte.net",
]);
const GENERIC_EMAIL_LOCALS = new Set([
  "admin",
  "accueil",
  "bonjour",
  "commercial",
  "contact",
  "direction",
  "dpo",
  "hello",
  "info",
  "marketing",
  "office",
  "privacy",
  "recrutement",
  "secretariat",
  "support",
]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+\s?\d{1,3}[\s().-]*)?(?:\d[\s().-]*){8,14}\d/g;
const DIRECT_PHONE_LABEL = /whatsapp|mobile|portable|ligne\s+directe|tél(?:éphone)?\s+direct/i;

export class CrawlerProspectEnricher implements ProspectEnricher {
  constructor(private readonly crawler: ProspectEnrichmentCrawler) {}

  async enrich(input: ProspectEnrichmentInput): Promise<ProspectEnrichmentResult> {
    const queries = buildProspectQueries(input.fullName, input.companyName);
    const searchGroups = await Promise.all(
      queries.map((query, index) =>
        this.crawler.search({
          query,
          limit: 5,
          correlationId: `${input.correlationId}:search:${index + 1}`,
          searchDepth: "advanced",
        }).catch(() => []),
      ),
    );
    const results = deduplicateSearchResults(searchGroups.flat());
    const official = selectOfficialWebsite(results, input.companyName);
    const urls = new Set<string>();
    for (const result of results) {
      if (searchResultMentionsPerson(result, input.fullName) && isReadablePublicUrl(result.url)) {
        urls.add(result.canonicalUrl ?? result.url);
      }
      if (urls.size >= 2) break;
    }
    if (official) {
      urls.add(official);
      const discovered = await this.crawler.discover({
        url: official,
        maxPages: 12,
        maxDepth: 2,
        correlationId: `${input.correlationId}:discover`,
      }).catch(() => []);
      for (const page of discovered) {
        if (RELEVANT_PAGE.test(`${page.path} ${page.title ?? ""}`)) urls.add(page.url);
        if (urls.size >= 4) break;
      }
    }
    const selectedUrls = [...urls].slice(0, 4);
    const pages = selectedUrls.length
      ? await this.crawler.readPages({
          urls: selectedUrls,
          correlationId: `${input.correlationId}:pages`,
          requestKey: input.requestKey,
        }).catch(() => [])
      : [];
    const extracted = extractNamedContactEvidence(pages, input.fullName);
    const companyDomain = official ? safeDomain(official) : null;
    const email = extracted.emails[0] ?? null;
    const phone = extracted.phones[0] ?? null;
    const evidence: ProspectEnrichmentEvidence[] = [];
    if (official) {
      evidence.push({
        kind: "company_website",
        url: official,
        snippet: `Site officiel probable de ${input.companyName}`,
        collectedAt: null,
      });
    }
    if (email) evidence.push(email.evidence);
    if (phone) evidence.push(phone.evidence);
    return {
      companyWebsite: official,
      companyDomain,
      channels: {
        linkedin: input.channels.linkedin,
        email: keepOrFill(
          input.channels.email,
          email
            ? evidenceChannel(email.value, normalizeEmail(email.value), "found", "medium", email.evidence)
            : null,
        ),
        whatsapp: keepOrFill(
          input.channels.whatsapp,
          phone
            ? evidenceChannel(phone.value, normalizePhone(phone.value), "unverified", "low", phone.evidence)
            : null,
        ),
      },
      queries,
      evidence,
    };
  }
}

export function buildProspectQueries(fullName: string, companyName: string): readonly string[] {
  const person = quoteSearchTerm(fullName);
  const company = quoteSearchTerm(companyName);
  return [
    `${person} ${company} email`,
    `${person} ${company} téléphone`,
  ];
}

export function selectOfficialWebsite(
  results: readonly CrawlerSearchResult[],
  companyName: string,
): string | null {
  const companyTokens = meaningfulTokens(companyName);
  const ranked = results.flatMap((result) => {
    const candidate = result.canonicalUrl ?? result.url;
    if (!isReadablePublicUrl(candidate)) return [];
    const url = new URL(candidate);
    if (BLOCKED_WEBSITE_HOSTS.some((host) => hostnameMatches(url.hostname, host))) return [];
    const haystack = normalizeText(`${url.hostname} ${result.title} ${result.description}`);
    const matches = companyTokens.filter((token) => haystack.includes(token)).length;
    if (companyTokens.length > 0 && matches === 0) return [];
    const coverage = companyTokens.length ? matches / companyTokens.length : 0;
    const pathPenalty = url.pathname.split("/").filter(Boolean).length * 0.1;
    return [{ url: url.origin, score: coverage + (url.pathname === "/" ? 0.25 : 0) - pathPenalty }];
  });
  ranked.sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  return ranked[0]?.url ?? null;
}

export function extractNamedContactEvidence(
  pages: readonly CrawledPage[],
  fullName: string,
): {
  emails: Array<{ value: string; evidence: ProspectEnrichmentEvidence }>;
  phones: Array<{ value: string; evidence: ProspectEnrichmentEvidence }>;
} {
  const emails = new Map<string, { value: string; evidence: ProspectEnrichmentEvidence }>();
  const phones = new Map<string, { value: string; evidence: ProspectEnrichmentEvidence }>();
  for (const page of pages) {
    const lines = page.markdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      if (!textMentionsPerson(lines[index]!, fullName)) continue;
      const context = lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 5)).join(" ");
      for (const value of context.match(EMAIL_PATTERN) ?? []) {
        const normalized = safeEmail(value);
        if (!normalized || !isNamedProfessionalEmail(normalized, fullName)) continue;
        emails.set(normalized, {
          value: value.trim(),
          evidence: evidenceFromPage("email", page, context),
        });
      }
      for (const value of context.match(PHONE_PATTERN) ?? []) {
        const normalized = safePhone(value);
        if (!normalized || !isDirectPhoneContext(context, lines[index]!, fullName)) continue;
        phones.set(normalized, {
          value: value.trim(),
          evidence: evidenceFromPage("phone", page, context),
        });
      }
    }
  }
  return { emails: [...emails.values()], phones: [...phones.values()] };
}

function evidenceFromPage(
  kind: "email" | "phone",
  page: CrawledPage,
  context: string,
): ProspectEnrichmentEvidence {
  return {
    kind,
    url: page.canonicalUrl ?? page.url,
    snippet: compactSnippet(context),
    collectedAt: page.collectedAt ?? null,
  };
}

function evidenceChannel(
  value: string,
  normalizedValue: string,
  status: ProspectChannel["status"],
  confidence: ProspectChannel["confidence"],
  evidence: ProspectEnrichmentEvidence,
): ProspectChannel {
  return {
    value,
    normalizedValue,
    status,
    confidence,
    source: "public_web",
    evidenceUrl: evidence.url,
    evidenceSnippet: evidence.snippet,
    observedAt: evidence.collectedAt,
  };
}

function keepOrFill(current: ProspectChannel, fallback: ProspectChannel | null): ProspectChannel {
  return current.status === "unavailable" && fallback ? fallback : current;
}

function isNamedProfessionalEmail(email: string, fullName: string): boolean {
  const [local = "", domain = ""] = email.split("@");
  if (PERSONAL_EMAIL_DOMAINS.has(domain) || GENERIC_EMAIL_LOCALS.has(local)) return false;
  const tokens = meaningfulTokens(fullName);
  const surname = tokens.at(-1);
  if (!surname) return false;
  const normalizedLocal = normalizeText(local).replaceAll(" ", "");
  return normalizedLocal.includes(surname.replaceAll(" ", ""));
}

function isDirectPhoneContext(context: string, nameLine: string, fullName: string): boolean {
  if (DIRECT_PHONE_LABEL.test(context)) return true;
  return textMentionsPerson(nameLine, fullName) && (nameLine.match(PHONE_PATTERN)?.length ?? 0) > 0;
}

function searchResultMentionsPerson(result: CrawlerSearchResult, fullName: string): boolean {
  return textMentionsPerson(`${result.title} ${result.description}`, fullName);
}

function textMentionsPerson(text: string, fullName: string): boolean {
  const haystack = normalizeText(text);
  const tokens = meaningfulTokens(fullName);
  const first = tokens[0];
  const last = tokens.at(-1);
  return Boolean(first && last && haystack.includes(first) && haystack.includes(last));
}

function deduplicateSearchResults(results: readonly CrawlerSearchResult[]): CrawlerSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const url = result.canonicalUrl ?? result.url;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function isReadablePublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function hostnameMatches(hostname: string, domain: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return normalized === domain || normalized.endsWith(`.${domain}`);
}

function safeDomain(url: string): string | null {
  try {
    return normalizeDomain(url);
  } catch {
    return null;
  }
}

function safeEmail(value: string): string | null {
  try {
    return normalizeEmail(value);
  } catch {
    return null;
  }
}

function safePhone(value: string): string | null {
  try {
    const normalized = normalizePhone(value);
    const digits = normalized.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? normalized : null;
  } catch {
    return null;
  }
}

function meaningfulTokens(value: string): string[] {
  return normalizeText(value).split(" ").filter((token) => token.length >= 3);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function quoteSearchTerm(value: string): string {
  return `"${value.replaceAll('"', "").trim()}"`;
}

function compactSnippet(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 320 ? `${compact.slice(0, 317)}...` : compact;
}
