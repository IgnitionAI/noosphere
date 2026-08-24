import type { ContentBrandLandingPageReader } from "@outbound/application/content/content-brand-kit";
import type { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";

export class CrawlerContentBrandLandingPageReader implements ContentBrandLandingPageReader {
  constructor(private readonly crawler: Pick<CrawlerClient, "readPages">) {}

  async read(input: Parameters<ContentBrandLandingPageReader["read"]>[0]) {
    const pages = await this.crawler.readPages({
      urls: [input.url],
      correlationId: input.correlationId,
      requestKey: input.correlationId,
    });
    const page = pages[0];
    if (!page) throw new Error("CONTENT_BRAND_LANDING_PAGE_EMPTY");
    return {
      url: page.canonicalUrl ?? page.url,
      title: page.title,
      markdown: page.markdown.slice(0, 20_000),
      collectedAt: page.collectedAt ?? null,
    };
  }
}
