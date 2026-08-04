import type {
  CompanyProspectCandidate,
  CompanyProspectSource,
} from "@outbound/application/crm/company-prospect-source";
import {
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
} from "@outbound/domain/crm/normalization";
import {
  emptyProspectChannels,
  type ProspectChannel,
} from "@outbound/domain/crm/prospect-channels";
import type {
  CrawledPage,
  CrawlerClient,
  CrawlerSearchResult,
} from "@outbound/infrastructure/ai/crawler-client";
import type { ProspectSource } from "./unipile-prospect-source";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+\s?\d{1,3}[\s().-]*)?(?:\d[\s().-]*){8,14}\d/g;
const BLOCKED_HOSTS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "youtube.com",
  "wikipedia.org",
];
const GENERIC_EMAILS = new Set([
  "admin",
  "contact",
  "hello",
  "info",
  "noreply",
  "no-reply",
  "support",
  "webmaster",
]);
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "outlook.com",
  "proton.me",
  "yahoo.com",
]);

export class CrawlerCompanyProspectSource implements CompanyProspectSource {
  constructor(
    private readonly crawler: CrawlerClient,
    private readonly prospectSource: () => ProspectSource,
  ) {}

  async searchCompanies(
    input: Parameters<CompanyProspectSource["searchCompanies"]>[0],
  ): Promise<readonly CompanyProspectCandidate[]> {
    const perQueryLimit = input.limit === null ? 20 : Math.min(20, input.limit);
    const searches = await Promise.all(
      buildQueries(input.query, input.sourceKinds).map((query, index) =>
        this.crawler.search({
          query,
          limit: perQueryLimit,
          searchDepth: "advanced",
          correlationId: `${input.correlationId}:search:${index + 1}`,
        }),
      ),
    );
    const uniqueResults = uniqueOfficialResults(searches.flat());
    const officialResults = input.limit === null ? uniqueResults : uniqueResults.slice(0, input.limit);
    if (!officialResults.length) return [];
    const pages = await this.crawler.readPages({
      urls: officialResults.map((result) => result.canonicalUrl ?? result.url),
      correlationId: `${input.correlationId}:pages`,
      requestKey: `${input.correlationId}:pages:v1`,
    });
    const pageByHost = new Map(
      pages.map((page) => [hostname(page.canonicalUrl ?? page.url), page] as const),
    );
    const candidates: CompanyProspectCandidate[] = [];
    const identitySource = input.channel === "whatsapp" ? this.prospectSource() : null;
    for (const result of officialResults) {
      if (input.limit !== null && candidates.length >= input.limit) break;
      const website = origin(result.canonicalUrl ?? result.url);
      const domain = normalizeDomain(website);
      if (!domain) continue;
      const page = pageByHost.get(domain);
      if (!page) continue;
      const companyName = companyNameFrom(result, domain);
      if (input.channel === "email") {
        for (const email of extractEmails(page)) {
          candidates.push(companyCandidate({
            companyName,
            website,
            domain,
            page,
            channel: evidenceChannel(
              email,
              normalizeEmail(email),
              "found",
              "medium",
              page,
            ),
            kind: "email",
          }));
          if (input.limit !== null && candidates.length >= input.limit) break;
        }
        continue;
      }
      if (!identitySource?.verifyWhatsappNumber) continue;
      for (const phone of extractPhones(page)) {
        const verified = await identitySource.verifyWhatsappNumber(phone).catch(() => null);
        if (!verified || verified.status !== "verified") continue;
        candidates.push(companyCandidate({
          companyName,
          website,
          domain,
          page,
          channel: {
            ...verified,
            evidenceUrl: page.canonicalUrl ?? page.url,
            evidenceSnippet: `Numéro professionnel public observé sur ${companyName}.`,
            observedAt: page.collectedAt ?? null,
          },
          kind: "whatsapp",
        }));
        if (input.limit !== null && candidates.length >= input.limit) break;
      }
    }
    return deduplicateCandidates(candidates, input.channel);
  }
}

function companyCandidate(input: {
  companyName: string;
  website: string;
  domain: string;
  page: CrawledPage;
  channel: ProspectChannel;
  kind: "email" | "whatsapp";
}): CompanyProspectCandidate {
  const channels = emptyProspectChannels();
  return {
    fullName: input.companyName,
    companyName: input.companyName,
    companyWebsite: input.website,
    companyDomain: input.domain,
    location: null,
    channels: { ...channels, [input.kind]: input.channel },
    providerData: {
      candidateKind: "company",
      source: "public_web",
      evidenceUrl: input.page.canonicalUrl ?? input.page.url,
      contentHash: input.page.contentHash ?? null,
      collectedAt: input.page.collectedAt ?? null,
    },
  };
}

function buildQueries(query: string, sourceKinds: readonly string[]): string[] {
  const suffixes = sourceKinds.map((kind) => {
    if (kind === "maps") return "adresse téléphone établissement";
    if (kind === "official_registry") return "registre officiel entreprise";
    if (kind === "professional_directory") return "annuaire professionnel";
    return "site officiel entreprise contact";
  });
  return [...new Set((suffixes.length ? suffixes : ["site officiel entreprise contact"])
    .map((suffix) => `${query} ${suffix}`))].slice(0, 3);
}

function uniqueOfficialResults(results: readonly CrawlerSearchResult[]): CrawlerSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    try {
      const host = hostname(result.canonicalUrl ?? result.url);
      if (!host || BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
        return false;
      }
      if (seen.has(host)) return false;
      seen.add(host);
      return true;
    } catch {
      return false;
    }
  });
}

function extractEmails(page: CrawledPage): string[] {
  return [...new Set(page.markdown.match(EMAIL_PATTERN) ?? [])].filter((value) => {
    try {
      const email = normalizeEmail(value);
      const [local = "", domain = ""] = email.split("@");
      return !GENERIC_EMAILS.has(local) && !PERSONAL_EMAIL_DOMAINS.has(domain);
    } catch {
      return false;
    }
  });
}

function extractPhones(page: CrawledPage): string[] {
  const normalized = new Map<string, string>();
  for (const value of page.markdown.match(PHONE_PATTERN) ?? []) {
    try {
      const fingerprint = normalizePhone(value);
      const digits = fingerprint.replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 15) normalized.set(fingerprint, value.trim());
    } catch {
      // Ignore malformed public values.
    }
  }
  return [...normalized.values()];
}

function evidenceChannel(
  value: string,
  normalizedValue: string,
  status: ProspectChannel["status"],
  confidence: ProspectChannel["confidence"],
  page: CrawledPage,
): ProspectChannel {
  return {
    value,
    normalizedValue,
    status,
    confidence,
    source: "public_web",
    evidenceUrl: page.canonicalUrl ?? page.url,
    evidenceSnippet: "Coordonnée professionnelle observée sur le site public de l’entreprise.",
    observedAt: page.collectedAt ?? null,
  };
}

function deduplicateCandidates(
  candidates: readonly CompanyProspectCandidate[],
  channel: "email" | "whatsapp",
): CompanyProspectCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const value = candidate.channels[channel].normalizedValue;
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function companyNameFrom(result: CrawlerSearchResult, domain: string): string {
  const title = result.title.split(/[|–—-]/)[0]?.trim();
  return title || domain.split(".")[0]!.replaceAll("-", " ");
}

function hostname(value: string): string {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function origin(value: string): string {
  return new URL(value).origin;
}
