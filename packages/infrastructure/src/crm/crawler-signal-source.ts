import type { SignalSource, SignalSourceObservation, SignalTarget } from "@outbound/application/crm/signal-source";
import { expirationForSignalType, type SignalType } from "@outbound/domain/crm/intent-signal";
import type { CrawlerSearchResult } from "@outbound/infrastructure/ai/crawler-client";

export interface SignalCrawler {
  search(input: {
    query: string;
    limit: number;
    correlationId: string;
    searchDepth?: "basic" | "advanced";
  }): Promise<readonly CrawlerSearchResult[]>;
}
const patterns: Readonly<Record<Exclude<SignalType, "competitor">, RegExp>> = {
  hiring: /(?:hiring|recruit(?:ing|ment)|job openings?|careers?|we(?:'|’)re looking for)/i,
  funding: /(?:raised|raising|funding|series [a-f]|seed round|investment|investor)/i,
  job_change: /(?:appointed|joins?|joined|new role|starts as|promoted|named .* as)/i,
  leadership_change: /(?:appoint(?:ed|ment)|new (?:ceo|cto|cfo|founder)|leadership|executive)/i,
  geographic_expansion: /(?:expan(?:ding|ded|sion)|opens? (?:an? )?(?:office|location)|new market|international)/i,
  public_activity: /(?:launch(?:ed|es)?|announc(?:ed|es)|event|conference|webinar|award)/i,
  technology: /(?:adopt(?:ed|s|ing)|uses?|powered by|technology|stack|platform|api)/i,
};

const queries: Readonly<Record<Exclude<SignalType, "competitor">, string>> = {
  hiring: "hiring recruitment careers jobs",
  funding: "funding investment raised series seed",
  job_change: "appointed joins promoted new role",
  leadership_change: "new CEO CTO leadership executive appointed",
  geographic_expansion: "expansion new office market international",
  public_activity: "announcement launch event conference award",
  technology: "technology platform API stack adopted",
};

export class CrawlerSignalSource implements SignalSource {
  readonly name = "crawler";
  readonly supportedTypes = Object.keys(patterns) as SignalType[];

  constructor(private readonly crawler: SignalCrawler) {}

  async collect(input: Parameters<SignalSource["collect"]>[0]): Promise<readonly SignalSourceObservation[]> {
    const requested = input.signalTypes.filter((type): type is Exclude<SignalType, "competitor"> =>
      type !== "competitor" && type in patterns && !(input.entityType === "contact" && type === "funding")
    );
    const groups = await Promise.all(requested.map((type) => this.crawler.search({
      query: buildTargetedQuery(input.target, input.entityType, queries[type]),
      limit: 10, correlationId: `${input.correlationId}:${type}`, searchDepth: "advanced",
    })));
    const seen = new Set<string>();
    const observations: SignalSourceObservation[] = [];
    for (let index = 0; index < requested.length; index += 1) {
      const type = requested[index]!;
      for (const result of groups[index] ?? []) {
        const haystack = `${result.title} ${result.description} ${result.markdown ?? ""}`;
        if (!patterns[type].test(haystack)) continue;
        if (!evidenceMatchesTarget(input.target, input.entityType, result, patterns[type])) continue;
        const observedAt = result.collectedAt ? new Date(result.collectedAt) : new Date();
        if (Number.isNaN(observedAt.getTime())) continue;
        const deduplicationKey = `${input.entityType}:${input.entityId}:${type}:${result.canonicalUrl ?? result.url}:${observedAt.toISOString().slice(0, 10)}`.slice(0, 700);
        if (seen.has(deduplicationKey)) continue;
        seen.add(deduplicationKey);
        observations.push({
          signalType: type, entityType: input.entityType, entityId: input.entityId,
          companyId: input.companyId, contactId: input.contactId, source: this.name,
          providerEventId: result.contentHash ?? null, evidenceUrl: result.canonicalUrl ?? result.url,
          evidenceSnippet: `${result.title}: ${result.description}`.slice(0, 2000), observedAt,
          expiresAt: expirationForSignalType(type, observedAt), confidence: "medium", deduplicationKey,
          legalBasis: "public_professional_information", sourceAuthorized: true,
        });
      }
    }
    return observations;
  }
}

function buildTargetedQuery(target: SignalTarget, entityType: "company" | "contact", signalQuery: string): string {
  const aliases = uniqueSearchTerms(target.aliases.length > 0 ? target.aliases : [target.displayName]);
  const domains = uniqueSearchTerms(target.domains.map(normalizeDomain).filter(Boolean));
  const identity = entityType === "company"
    ? [...aliases.map(quoteSearchTerm), ...domains.map((domain) => `site:${domain}`)].join(" OR ")
    : aliases.map(quoteSearchTerm).join(" OR ");
  const context = entityType === "contact"
    ? uniqueSearchTerms([...(target.contextTerms ?? []), ...domains]).map(quoteSearchTerm).join(" OR ")
    : "";
  return `(${identity})${context ? ` (${context})` : ""} ${signalQuery}`.trim();
}

function evidenceMatchesTarget(
  target: SignalTarget,
  entityType: "company" | "contact",
  result: Pick<CrawlerSearchResult, "url" | "canonicalUrl" | "title" | "description" | "markdown">,
  signalPattern: RegExp,
): boolean {
  const aliases = uniqueSearchTerms(target.aliases.length > 0 ? target.aliases : [target.displayName]);
  const normalizedAliases = aliases.map(normalizeComparable).filter(Boolean);
  const segments = evidenceSegments(result);
  if (segments.some((segment) => {
    if (!signalPattern.test(segment)) return false;
    const normalizedSegment = normalizeComparable(segment);
    return normalizedAliases.some((alias) => containsNormalizedPhrase(normalizedSegment, alias));
  })) return true;
  if (entityType === "contact") return false;
  const resultHost = safeHostname(result.canonicalUrl ?? result.url);
  return target.domains.some((domain) => hostMatchesDomain(resultHost, normalizeDomain(domain)))
    && segments.some((segment) => signalPattern.test(segment));
}

function evidenceSegments(result: Pick<CrawlerSearchResult, "title" | "description" | "markdown">): string[] {
  const summary = `${result.title} ${result.description}`.trim();
  const markdownSegments = (result.markdown ?? "").split(/\n{2,}|(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  return [summary, ...markdownSegments].filter(Boolean);
}

function uniqueSearchTerms(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function quoteSearchTerm(value: string): string {
  const safe = value.replace(/["\\\r\n()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return `"${safe}"`;
}

function normalizeComparable(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function containsNormalizedPhrase(evidence: string, phrase: string): boolean {
  return Boolean(phrase && ` ${evidence} `.includes(` ${phrase} `));
}

function normalizeDomain(value: string): string {
  const candidate = value.trim().toLocaleLowerCase("en-US").replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
  return candidate.replace(/[^a-z0-9.-]/g, "");
}

function safeHostname(value: string): string {
  try { return new URL(value).hostname.toLocaleLowerCase("en-US").replace(/^www\./, ""); }
  catch { return ""; }
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return Boolean(host && domain && (host === domain || host.endsWith(`.${domain}`)));
}
