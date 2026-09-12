import type { ContentIdeaEvidence, ContentIdeaSourceDiscovery } from "@outbound/application/content/content-ideas";
import type { CrawledPage, CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";

export class CrawlerContentIdeaSource implements ContentIdeaSourceDiscovery {
  constructor(private readonly crawler: Pick<CrawlerClient, "search" | "readPages">) {}

  async search(input: { query: string; limit: number; correlationId: string }): Promise<readonly ContentIdeaEvidence[]> {
    if (input.limit < 1) return [];
    const results = (await this.crawler.search({ query: input.query, limit: Math.min(8, input.limit), correlationId: input.correlationId, searchDepth: "advanced" })).slice(0, Math.min(8, input.limit));
    if (!results.length) return [];
    const urls = [...new Set(results.map((result) => result.canonicalUrl ?? result.url))];
    // Search snippets locate documents; they are not the documents' evidence.
    // The crawler owns URL/network safety. Bound the complete read, including polling.
    const deadline = Date.now() + 90_000;
    const pages: CrawledPage[] = [];
    const failures: unknown[] = [];
    let cursor = 0;
    const readNext = async () => {
      while (cursor < urls.length && Date.now() < deadline) {
        const url = urls[cursor++]!;
        try {
          pages.push(...await this.crawler.readPages({
            urls: [url],
            correlationId: `${input.correlationId}:sources`,
            retryFailed: true,
            requestKey: `content-source:${hash(`${input.correlationId}|${url}`)}`,
            signal: AbortSignal.timeout(Math.max(1, Math.min(40_000, deadline - Date.now()))),
          }));
        } catch (error) { failures.push(error); }
      }
    };
    await Promise.all([readNext(), readNext()]);
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
    if (!evidence.length) throw new Error("CONTENT_SOURCE_READ_FAILED");
    return evidence;
  }
}

function hash(value: string): string { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
