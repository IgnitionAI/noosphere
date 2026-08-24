import type {
  CompanyPhoneObservation,
  CompanyProspectCandidate,
  CompanyProspectSearchResult,
  CompanyProspectSource,
} from "@outbound/application/crm/company-prospect-source";
import type {
  DailySourcingBudget,
  WhatsappReachabilityResolver,
  WhatsappReachabilityResult,
} from "@outbound/application/crm/whatsapp-sourcing-ports";
import {
  normalizeDomain,
  normalizeEmail,
} from "@outbound/domain/crm/normalization";
import {
  extractPublicWhatsappObservations,
  type PublicPhoneObservation,
} from "@outbound/domain/crm/whatsapp-sourcing";
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
import { buildCompanySearchQueries } from "./company-search-query-compiler";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
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
const NON_PERSON_EMAIL_TOKENS = new Set([
  "cabinet",
  "commercial",
  "communication",
  "comptabilite",
  "direction",
  "dpo",
  "equipe",
  "jobs",
  "privacy",
  "recrutement",
  "rgpd",
  "service",
]);
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "outlook.com",
  "proton.me",
  "yahoo.com",
]);
const PRIORITY_PATH = /(?:contact|equipe|team|cabinet|agence|implantation|bureau|about|mentions|legal)/i;

export class CrawlerCompanyProspectSource implements CompanyProspectSource {
  readonly #budget: DailySourcingBudget;
  readonly #reachability: WhatsappReachabilityResolver | null;
  readonly #now: () => Date;
  readonly #maxPagesPerCompany: number;

  constructor(
    private readonly crawler: CrawlerClient,
    private readonly prospectSource: () => ProspectSource,
    options: {
      budget?: DailySourcingBudget;
      reachability?: WhatsappReachabilityResolver | null;
      now?: () => Date;
      maxPagesPerCompany?: number;
    } = {},
  ) {
    this.#budget = options.budget ?? unlimitedBudget;
    this.#reachability = options.reachability ?? null;
    this.#now = options.now ?? (() => new Date());
    this.#maxPagesPerCompany = options.maxPagesPerCompany ?? 4;
  }

  async searchCompanies(
    input: Parameters<CompanyProspectSource["searchCompanies"]>[0],
  ): Promise<CompanyProspectSearchResult> {
    const perQueryLimit = input.limit === null ? 10 : Math.min(10, input.limit);
    const searches = await Promise.all(
      buildCompanySearchQueries(input.query, input.sourceKinds).map((query, index) =>
        this.crawler.search({
          query,
          limit: perQueryLimit,
          searchDepth: "advanced",
          correlationId: `${input.correlationId}:search:${index + 1}`,
        }),
      ),
    );
    const uniqueResults = uniqueOfficialResults(roundRobin(searches));
    const officialResults = input.limit === null
      ? uniqueResults.slice(0, 30)
      : uniqueResults.slice(0, Math.min(30, Math.max(input.limit, input.limit * 2)));
    const candidates: CompanyProspectCandidate[] = [];
    const observations: CompanyPhoneObservation[] = [];
    const verified = new Set<string>();
    let pageAttemptCount = 0;
    let verificationAttemptCount = 0;
    let rawPhoneCount = 0;
    let admissiblePhoneCount = 0;
    const identitySource = input.channel === "whatsapp" ? this.prospectSource() : null;

    for (const [resultIndex, result] of officialResults.entries()) {
      if (input.limit !== null && candidates.length >= input.limit) break;
      const website = origin(result.canonicalUrl ?? result.url);
      const domain = normalizeDomain(website);
      if (!domain) continue;
      const companyName = companyNameFrom(result, domain);
      const pages = await this.#readCompanyPages({
        result,
        channel: input.channel,
        correlationId: `${input.correlationId}:company:${resultIndex + 1}`,
        sourcingCycleId: input.sourcingCycleId ?? null,
      });
      pageAttemptCount += pages.attemptCount;
      if (input.channel === "email") {
        for (const page of pages.pages) {
          for (const { email, personName } of extractEmails(page, domain)) {
            candidates.push(companyCandidate({
              companyName,
              website,
              domain,
              page,
              channel: evidenceChannel(email, normalizeEmail(email), "found", "medium", page),
              kind: "email",
              endpointKind: "person",
              providerData: { personName },
            }));
            if (input.limit !== null && candidates.length >= input.limit) break;
          }
        }
        continue;
      }
      if (!identitySource) continue;
      for (const page of pages.pages) {
        const extracted = extractPublicWhatsappObservations({
          markdown: page.markdown,
          sourceUrl: page.canonicalUrl ?? page.url,
          sourceTitle: page.title,
          companyName,
          companyDomain: domain,
          sourceKind: "web",
        });
        rawPhoneCount += extracted.length;
        for (const observation of extracted) {
          let reachability: WhatsappReachabilityResult | null = null;
          if (observation.attributionStatus === "strong" && observation.e164) {
            admissiblePhoneCount += 1;
            reachability = await this.#resolveReachability({
              input,
              identitySource,
              observation: { ...observation, e164: observation.e164 },
            });
            if (reachability.source === "live") verificationAttemptCount += 1;
          }
          observations.push(companyObservation({
            observation,
            companyName,
            domain,
            page,
            reachability,
          }));
          if (
            !observation.e164
            || observation.attributionStatus !== "strong"
            || reachability?.status !== "verified"
            || verified.has(observation.e164)
          ) continue;
          verified.add(observation.e164);
          candidates.push(companyCandidate({
            companyName,
            website,
            domain,
            page,
            channel: {
              value: observation.rawValue,
              normalizedValue: observation.e164,
              status: "verified",
              confidence: "high",
              source: reachability.source === "cache"
                ? "unipile_whatsapp_cache"
                : "unipile_whatsapp_profile",
              evidenceUrl: page.canonicalUrl ?? page.url,
              evidenceSnippet: observation.evidenceSnippet,
              observedAt: page.collectedAt ?? null,
            },
            kind: "whatsapp",
            endpointKind: observation.endpointKind,
            providerData: {
              personName: observation.personName,
              personRole: observation.personRole,
              attributionStatus: observation.attributionStatus,
              attributionReason: observation.attributionReason,
              providerAccountId: reachability.providerAccountId,
              reachabilityCheckedAt: reachability.checkedAt.toISOString(),
              reachabilityExpiresAt: reachability.expiresAt.toISOString(),
              reachabilitySource: reachability.source,
            },
          }));
          if (input.limit !== null && candidates.length >= input.limit) break;
        }
      }
    }
    const deduplicated = deduplicateCandidates(candidates, input.channel);
    return {
      candidates: deduplicated,
      observations,
      metrics: {
        searchResultCount: officialResults.length,
        pageAttemptCount,
        rawPhoneCount,
        admissiblePhoneCount,
        verificationAttemptCount,
        verifiedPhoneCount: verified.size,
      },
    };
  }

  async #readCompanyPages(input: {
    result: CrawlerSearchResult;
    channel: "email" | "whatsapp";
    correlationId: string;
    sourcingCycleId: string | null;
  }): Promise<{ pages: readonly CrawledPage[]; attemptCount: number }> {
    const initialUrl = input.result.canonicalUrl ?? input.result.url;
    const domain = hostname(initialUrl);
    const targeted = await this.crawler.search({
      query: input.channel === "email"
        ? `site:${domain} équipe associés direction contact email`
        : `site:${domain} contact téléphone mobile équipe`,
      limit: Math.max(3, this.#maxPagesPerCompany * 2),
      searchDepth: "basic",
      correlationId: `${input.correlationId}:pages-search`,
    }).catch(() => []);
    const sameDomainUrls = targeted
      .map((result) => result.canonicalUrl ?? result.url)
      .filter((url) => sameRegistrableHost(url, domain));
    const urls = prioritizedUrls(initialUrl, sameDomainUrls)
      .slice(0, this.#maxPagesPerCompany);
    const reserved: string[] = [];
    for (const url of urls) {
      const reservation = await this.#budget.reserve({
        cycleId: input.sourcingCycleId,
        resource: "page",
        amount: 1,
        now: this.#now(),
      });
      if (!reservation.accepted) break;
      reserved.push(url);
    }
    if (!reserved.length) return { pages: [], attemptCount: 0 };
    const pages = await this.crawler.readPages({
      urls: reserved,
      correlationId: `${input.correlationId}:pages`,
      requestKey: `${input.correlationId}:pages:v2`,
    }).catch(() => []);
    return { pages, attemptCount: reserved.length };
  }

  async #resolveReachability(input: {
    input: Parameters<CompanyProspectSource["searchCompanies"]>[0];
    identitySource: ProspectSource;
    observation: PublicPhoneObservation & { e164: string };
  }): Promise<WhatsappReachabilityResult> {
    const now = this.#now();
    if (this.#reachability) {
      return this.#reachability.resolve({
        workspaceId: input.input.workspaceId,
        phone: input.observation.rawValue,
        e164: input.observation.e164,
        sourcingCycleId: input.input.sourcingCycleId ?? null,
        now,
      });
    }
    const reservation = await this.#budget.reserve({
      cycleId: input.input.sourcingCycleId ?? null,
      resource: "whatsapp_verification",
      amount: 1,
      now,
    });
    if (!reservation.accepted) return unknownReachability(now, "SOURCING_VERIFICATION_BUDGET_EXHAUSTED");
    if (input.identitySource.verifyWhatsappReachability) {
      return input.identitySource.verifyWhatsappReachability(input.observation.rawValue);
    }
    const channel = await input.identitySource.verifyWhatsappNumber?.(input.observation.rawValue).catch(() => null);
    return {
      status: channel?.status === "verified" ? "verified" : "unknown",
      providerAccountId: null,
      checkedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
      source: "live",
      errorCode: channel ? null : "UNIPILE_VERIFICATION_UNAVAILABLE",
    };
  }
}

function companyCandidate(input: {
  companyName: string;
  website: string;
  domain: string;
  page: CrawledPage;
  channel: ProspectChannel;
  kind: "email" | "whatsapp";
  endpointKind: "person" | "company";
  providerData?: Record<string, unknown>;
}): CompanyProspectCandidate {
  const channels = emptyProspectChannels();
  const collective = input.endpointKind === "company";
  return {
    fullName: collective ? input.companyName : (input.providerData?.personName as string | null) ?? input.companyName,
    companyName: input.companyName,
    companyWebsite: input.website,
    companyDomain: input.domain,
    location: null,
    channels: { ...channels, [input.kind]: input.channel },
    providerData: {
      candidateKind: collective ? "company_endpoint" : "person",
      source: "public_web",
      evidenceUrl: input.page.canonicalUrl ?? input.page.url,
      evidenceSnippet: input.channel.evidenceSnippet,
      contentHash: input.page.contentHash ?? null,
      collectedAt: input.page.collectedAt ?? null,
      ...input.providerData,
    },
  };
}

function companyObservation(input: {
  observation: PublicPhoneObservation;
  companyName: string;
  domain: string;
  page: CrawledPage;
  reachability: WhatsappReachabilityResult | null;
}): CompanyPhoneObservation {
  return {
    rawValue: input.observation.rawValue,
    e164: input.observation.e164,
    endpointKind: input.observation.endpointKind,
    companyName: input.companyName,
    companyDomain: input.domain,
    personName: input.observation.personName,
    personRole: input.observation.personRole,
    attributionStatus: input.observation.attributionStatus,
    attributionReason: input.observation.attributionReason,
    rejectionReason: input.observation.rejectionReason,
    sourceKind: "web",
    sourceUrl: input.page.canonicalUrl ?? input.page.url,
    evidenceSnippet: input.observation.evidenceSnippet,
    contentHash: input.page.contentHash ?? null,
    observedAt: input.page.collectedAt ?? null,
    reachabilityStatus: input.reachability?.status ?? "unknown",
    providerAccountId: input.reachability?.providerAccountId ?? null,
    reachabilityCheckedAt: input.reachability?.checkedAt.toISOString() ?? null,
    reachabilityExpiresAt: input.reachability?.expiresAt.toISOString() ?? null,
  };
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

function roundRobin<T>(groups: readonly (readonly T[])[]): T[] {
  const output: T[] = [];
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      const value = group[index];
      if (value !== undefined) output.push(value);
    }
  }
  return output;
}

function extractEmails(page: CrawledPage, companyDomain: string): { email: string; personName: string }[] {
  return [...new Set(page.markdown.match(EMAIL_PATTERN) ?? [])].flatMap((value) => {
    try {
      const email = normalizeEmail(value);
      const [local = "", domain = ""] = email.split("@");
      if (
        GENERIC_EMAILS.has(local)
        || PERSONAL_EMAIL_DOMAINS.has(domain)
        || !sameDomain(domain, companyDomain)
      ) return [];
      const personName = personNameFromEmailLocal(local);
      return personName ? [{ email, personName }] : [];
    } catch {
      return [];
    }
  });
}

function personNameFromEmailLocal(local: string): string | null {
  const tokens = local
    .split(/[._-]+/)
    .map((token) => token.trim())
    .filter((token) => /^[a-z]{2,}$/i.test(token));
  if (tokens.length < 2 || tokens.some((token) => NON_PERSON_EMAIL_TOKENS.has(token.toLocaleLowerCase("fr")))) {
    return null;
  }
  return tokens
    .map((token) => `${token[0]!.toLocaleUpperCase("fr")}${token.slice(1).toLocaleLowerCase("fr")}`)
    .join(" ");
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

function prioritizedUrls(initialUrl: string, discovered: readonly string[]): string[] {
  const unique = [...new Set([initialUrl, ...discovered])];
  return unique.sort((left, right) => Number(PRIORITY_PATH.test(new URL(right).pathname)) - Number(PRIORITY_PATH.test(new URL(left).pathname)));
}

function companyNameFrom(result: CrawlerSearchResult, domain: string): string {
  const title = result.title.split(/[|–—-]/)[0]?.trim();
  return title || domain.split(".")[0]!.replaceAll("-", " ");
}

function hostname(value: string): string {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function sameRegistrableHost(value: string, expectedHost: string): boolean {
  try {
    const candidate = hostname(value);
    return candidate === expectedHost
      || candidate.endsWith(`.${expectedHost}`)
      || expectedHost.endsWith(`.${candidate}`);
  } catch {
    return false;
  }
}

function sameDomain(candidate: string, expected: string): boolean {
  const left = candidate.toLocaleLowerCase("en").replace(/^www\./, "");
  const right = expected.toLocaleLowerCase("en").replace(/^www\./, "");
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function origin(value: string): string {
  return new URL(value).origin;
}

function unknownReachability(now: Date, errorCode: string): WhatsappReachabilityResult {
  return {
    status: "unknown",
    providerAccountId: null,
    checkedAt: now,
    expiresAt: now,
    source: "live",
    errorCode,
  };
}

const unlimitedBudget: DailySourcingBudget = {
  async reserve() {
    return { accepted: true, remaining: null, deadlineAt: null };
  },
};
