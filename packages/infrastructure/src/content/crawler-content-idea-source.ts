import type { ContentIdeaEvidence, ContentIdeaSourceDiscovery } from "@outbound/application/content/content-ideas";
import type { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";

export class CrawlerContentIdeaSource implements ContentIdeaSourceDiscovery {
  constructor(private readonly crawler: CrawlerClient) {}

  async search(input: { query: string; limit: number; correlationId: string }): Promise<readonly ContentIdeaEvidence[]> {
    if (input.limit < 1) return [];
    const results = await this.crawler.search({ query: input.query, limit: input.limit, correlationId: input.correlationId, searchDepth: "advanced" });
    return results.map((result) => {
      const canonicalUrl = result.canonicalUrl ?? result.url;
      const excerpt = (result.description || result.markdown || result.title).slice(0, 2_000);
      const contentHash = result.contentHash ?? hash(`${canonicalUrl}|${result.title}|${excerpt}`);
      return {
        key: `public_web:${contentHash}`,
        type: "public_web" as const,
        sourceRef: canonicalUrl.slice(0, 500),
        canonicalUrl,
        title: result.title.slice(0, 500),
        excerpt,
        contentHash,
        collectedAt: result.collectedAt ? new Date(result.collectedAt) : new Date(),
      };
    });
  }
}

function hash(value: string): string { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
