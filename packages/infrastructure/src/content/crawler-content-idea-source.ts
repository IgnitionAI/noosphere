import { ContentIdeaSourceDeadlineError } from "@outbound/application/content/content-ideas";
import type { ContentIdeaEvidence, ContentIdeaSourceDiscovery, ContentIdeaSourceRequest } from "@outbound/application/content/content-ideas";
import type { CrawledPage, CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";

export class CrawlerContentIdeaSource implements ContentIdeaSourceDiscovery {
  constructor(private readonly crawler: Pick<CrawlerClient, "search" | "readPages">) {}

  async search(input: ContentIdeaSourceRequest): Promise<readonly ContentIdeaEvidence[]> {
    if (input.limit < 1) return [];
    const runDeadline = input.deadlineAt.getTime();
    if (!Number.isFinite(runDeadline)) throw new Error("CONTENT_SOURCE_DEADLINE_INVALID");
    const deadline = Math.min(runDeadline, Date.now() + 90_000);
    let runBudgetExpired = false;
    const operationSignal = (maxMs: number): AbortSignal => {
      const now = Date.now();
      const signal = AbortSignal.timeout(Math.max(1, Math.min(maxMs, deadline - now)));
      // Preserve the limiting budget's expiry even if wall-clock time is rounded
      // or adjusted backwards while the monotonic abort timer is running.
      if (runDeadline <= deadline && runDeadline - now <= maxMs) {
        signal.addEventListener("abort", () => { runBudgetExpired = true; }, { once: true });
      }
      return signal;
    };
    const checkRunDeadline = () => { if (runBudgetExpired || Date.now() >= runDeadline) throw new ContentIdeaSourceDeadlineError(); };
    checkRunDeadline();
    let results;
    try {
      results = (await this.crawler.search({ query: input.query, limit: Math.min(8, input.limit), correlationId: input.correlationId, searchDepth: "advanced", signal: operationSignal(30_000) })).slice(0, Math.min(8, input.limit));
    } catch (error) {
      checkRunDeadline();
      throw error;
    }
    checkRunDeadline();
    if (!results.length) return [];
    const urls = [...new Set(results.map((result) => result.canonicalUrl ?? result.url))];
    // Search snippets locate documents; they are not the documents' evidence.
    // The crawler owns URL/network safety. Bound the complete read, including polling.
    const pages: CrawledPage[] = [];
    const failures: unknown[] = [];
    let cursor = 0;
    const readNext = async () => {
      while (cursor < urls.length && !runBudgetExpired && Date.now() < deadline) {
        const url = urls[cursor++]!;
        try {
          pages.push(...await this.crawler.readPages({
            urls: [url],
            correlationId: `${input.correlationId}:sources`,
            retryFailed: true,
            requestKey: `content-source:${hash(`${input.correlationId}|${url}`)}`,
            signal: operationSignal(40_000),
          }));
        } catch (error) { failures.push(error); }
      }
    };
    await Promise.all([readNext(), readNext()]);
    if (!pages.length) checkRunDeadline();
    if (!pages.length && failures.length) throw failures[0];
    pages.sort((left, right) => urls.indexOf(left.url) - urls.indexOf(right.url));
    const evidence: ContentIdeaEvidence[] = [];
    for (const page of pages) {
      const result = results.find((item) => (item.canonicalUrl ?? item.url) === page.url);
      if (!result || !page.markdown.trim()) continue;
      const canonicalUrl = page.canonicalUrl ?? page.url;
      if (evidence.some((item) => item.canonicalUrl === canonicalUrl)) continue;
      const contentHash = hash(page.markdown);
      evidence.push({
        key: `public_web:${contentHash}`,
        type: "public_web",
        sourceRef: canonicalUrl.slice(0, 500),
        canonicalUrl,
        title: (page.title || result.title).slice(0, 500),
        excerpt: page.markdown.slice(0, 8_000),
        contentHash,
        collectedAt: page.collectedAt ? new Date(page.collectedAt) : new Date(),
      });
    }
    if (!evidence.length) {
      checkRunDeadline();
      throw new Error("CONTENT_SOURCE_READ_FAILED");
    }
    return evidence;
  }
}

function hash(value: string): string { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
