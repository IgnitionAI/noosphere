import type {
  ChannelAssessmentEvidence,
  ChannelObservation,
  ChannelObservationSource,
  ChannelStrategy,
} from "@outbound/application/campaigns/channel-assessment";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import { normalizeLinkedinUrl } from "@outbound/domain/crm/normalization";
import type { CrawlerClient, CrawlerSearchResult } from "@outbound/infrastructure/ai/crawler-client";
import type { ProspectSource } from "@outbound/infrastructure/crm/unipile-prospect-source";
import { buildCompanySearchQueries } from "@outbound/infrastructure/crm/company-search-query-compiler";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+33|0033|0)[\s.()-]*[1-9](?:[\s.()-]*\d{2}){4}\b/g;
const EXCLUDED_EMAIL_LOCAL_PARTS = new Set([
  "contact",
  "info",
  "hello",
  "support",
  "admin",
  "noreply",
  "no-reply",
  "webmaster",
]);

export class RoutedChannelObservationSource implements ChannelObservationSource {
  constructor(
    private readonly crawler: CrawlerClient,
    private readonly prospectSource: (workspaceId: string) => ProspectSource,
  ) {}

  async observe(input: Parameters<ChannelObservationSource["observe"]>[0]): Promise<ChannelObservation> {
    return input.channel === "linkedin"
      ? this.#observeLinkedin(input)
      : this.#observeCompanies(input);
  }

  async #observeLinkedin(input: {
    workspaceId: string;
    assessmentId: string;
    channel: ProspectingChannel;
    strategy: ChannelStrategy;
    version: { readonly criteria: unknown; readonly buyingCommittee: unknown };
  }): Promise<ChannelObservation> {
    const source = this.prospectSource(input.workspaceId);
    const queries = buildLinkedinSearchQueries(input.strategy, input.version);
    const limitPerQuery = Math.min(
      10,
      Math.max(3, Math.ceil(input.strategy.sampleSize / queries.length)),
    );
    const candidates = [];
    for (const keywords of queries) {
      candidates.push(
        ...(await source.searchPeople({
          api: "classic",
          category: "people",
          keywords,
          limit: limitPerQuery,
          enrichContacts: false,
        })),
      );
      if (uniqueLinkedinCandidates(candidates).length >= input.strategy.sampleSize) break;
    }
    const found = uniqueLinkedinCandidates(candidates).slice(0, input.strategy.sampleSize);
    const eligible = found.filter((candidate) => {
      if (!candidate.linkedinUrl || (!candidate.headline && !candidate.companyName)) return false;
      try {
        normalizeLinkedinUrl(candidate.linkedinUrl);
        return true;
      } catch {
        return false;
      }
    });
    return {
      metrics: {
        sampleSize: input.strategy.sampleSize,
        accountsFound: new Set(found.map((candidate) => candidate.companyName).filter(Boolean)).size,
        peopleFound: found.length,
        eligibleIdentities: eligible.length,
        verifiedIdentities: eligible.filter(
          (candidate) => candidate.channels?.linkedin.status === "verified",
        ).length,
      },
      evidence: eligible.slice(0, 10).map((candidate): ChannelAssessmentEvidence => ({
        url: candidate.linkedinUrl,
        title: candidate.fullName,
        excerpt: [candidate.headline, candidate.companyName, candidate.location]
          .filter(Boolean)
          .join(" · "),
        kind: "profile",
      })),
    };
  }

  async #observeCompanies(input: {
    workspaceId: string;
    assessmentId: string;
    channel: ProspectingChannel;
    strategy: ChannelStrategy;
  }): Promise<ChannelObservation> {
    const searches = await Promise.all(
      buildCompanySearchQueries(input.strategy.query, input.strategy.sourceKinds).map((query, index) =>
        this.crawler.search({
          query,
          limit: Math.min(10, input.strategy.sampleSize),
          correlationId: `channel-assessment:${input.assessmentId}:search:${index}`,
        }),
      ),
    );
    const results = uniqueOfficialResults(searches.flat()).slice(0, input.strategy.sampleSize);
    const pages = results.length
      ? await this.crawler.readPages({
          urls: results.slice(0, 6).map((result) => result.canonicalUrl ?? result.url),
          correlationId: `channel-assessment:${input.assessmentId}:pages`,
          requestKey: `channel-assessment:${input.assessmentId}:pages`,
        })
      : [];
    const emails = unique(
      pages.flatMap((page) => page.markdown.match(EMAIL_PATTERN) ?? []).filter(isEligibleEmail),
    );
    const phones = unique(pages.flatMap((page) => page.markdown.match(PHONE_PATTERN) ?? []));
    const verifiedWhatsapp: string[] = [];
    if (input.channel === "whatsapp" && phones.length) {
      const source = this.prospectSource(input.workspaceId);
      if (source.verifyWhatsappNumber) {
        for (const phone of phones.slice(0, 5)) {
          try {
            const verification = await source.verifyWhatsappNumber(phone);
            if (verification.status === "verified") verifiedWhatsapp.push(phone);
          } catch {
            // One malformed or provider-rejected number must not invalidate the sample.
          }
        }
      }
    }
    const eligibleIdentities = input.channel === "email" ? emails.length : phones.length;
    const verifiedIdentities = input.channel === "email"
      ? emails.filter((email) => pages.some((page) => sameDomain(email, page.url))).length
      : verifiedWhatsapp.length;
    const evidence: ChannelAssessmentEvidence[] = [
      ...results.slice(0, 6).map((result) => ({
        url: result.canonicalUrl ?? result.url,
        title: result.title,
        excerpt: result.description.slice(0, 500),
        kind: "account" as const,
      })),
      ...(input.channel === "email"
        ? emails.slice(0, 6).map((email) => ({
            url: pageForValue(pages, email),
            title: email,
            excerpt: "Email professionnel observé sur une page publique.",
            kind: "email" as const,
          }))
        : phones.slice(0, 6).map((phone) => ({
            url: pageForValue(pages, phone),
            title: phone,
            excerpt: verifiedWhatsapp.includes(phone)
              ? "Numéro professionnel public vérifié sur WhatsApp."
              : "Numéro professionnel public, disponibilité WhatsApp non vérifiée.",
            kind: verifiedWhatsapp.includes(phone) ? "whatsapp" as const : "phone" as const,
          }))),
    ];
    return {
      metrics: {
        sampleSize: input.strategy.sampleSize,
        accountsFound: results.length,
        peopleFound: 0,
        eligibleIdentities,
        verifiedIdentities,
      },
      evidence,
    };
  }
}

function uniqueOfficialResults(results: readonly CrawlerSearchResult[]): CrawlerSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    try {
      const hostname = new URL(result.canonicalUrl ?? result.url).hostname.replace(/^www\./, "");
      if (["linkedin.com", "facebook.com", "instagram.com", "x.com", "youtube.com"].some(
        (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
      )) return false;
      if (seen.has(hostname)) return false;
      seen.add(hostname);
      return true;
    } catch {
      return false;
    }
  });
}

function isEligibleEmail(email: string): boolean {
  const local = email.toLowerCase().split("@")[0] ?? "";
  return !EXCLUDED_EMAIL_LOCAL_PARTS.has(local);
}

function sameDomain(email: string, pageUrl: string): boolean {
  try {
    const emailDomain = email.toLowerCase().split("@")[1] ?? "";
    const hostname = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === emailDomain || hostname.endsWith(`.${emailDomain}`);
  } catch {
    return false;
  }
}

function pageForValue(
  pages: readonly { url: string; markdown: string }[],
  value: string,
): string | null {
  return pages.find((page) => page.markdown.includes(value))?.url ?? null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function compactLinkedinKeywords(query: string, maxLength = 180): string {
  const positiveQuery = query.split(/\bNOT\b/i)[0] ?? query;
  const groups = positiveQuery
    .split(/\bAND\b/i)
    .map((group) =>
      group
        .split(/\bOR\b/i)
        .map((part) => normalizeLinkedinTerm(part))
        .filter(Boolean),
    )
    .filter((group) => group.length > 0);
  const ordered: string[] = [];
  const seen = new Set<string>();
  const widestGroup = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < widestGroup; index += 1) {
    for (const group of groups) {
      const term = group[index];
      if (!term || seen.has(term.toLowerCase())) continue;
      seen.add(term.toLowerCase());
      ordered.push(term);
    }
  }
  const selected: string[] = [];
  for (const term of ordered) {
    const candidate = [...selected, term].join(" ");
    if (candidate.length > maxLength) continue;
    selected.push(term);
  }
  return selected.join(" ") || normalizeLinkedinTerm(positiveQuery).slice(0, maxLength);
}

export function buildLinkedinSearchQueries(
  strategy: ChannelStrategy,
  version: { readonly criteria: unknown; readonly buyingCommittee: unknown },
): string[] {
  const criteria = asRecord(version.criteria);
  const prospecting = asRecord(criteria?.prospecting);
  const titles = firstStringArray(version.buyingCommittee, prospecting?.jobTitles);
  const industries = firstStringArray(prospecting?.industries, criteria?.industries);
  const geographies = firstStringArray(prospecting?.geographies, criteria?.geographies);
  const industry = industries[0] ?? "";
  const geography = geographies[0] ?? stringValue(criteria?.geography) ?? "France";
  const queries = titles.slice(0, 4).map((title) =>
    compactLinkedinKeywords([title, industry, geography].filter(Boolean).join(" "), 120),
  );
  return unique(queries.length ? queries : [compactLinkedinKeywords(strategy.query, 120)]);
}

function uniqueLinkedinCandidates<T extends {
  linkedinUrl: string | null;
  fullName: string;
  companyName: string | null;
}>(candidates: readonly T[]): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.linkedinUrl?.toLowerCase() ??
      `${candidate.fullName}:${candidate.companyName ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstStringArray(...values: readonly unknown[]): string[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const strings = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (strings.length) return strings;
  }
  return [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLinkedinTerm(value: string): string {
  return value
    .replace(/[()"“”]/g, " ")
    .replace(/[^\p{L}\p{N}&+.'/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
