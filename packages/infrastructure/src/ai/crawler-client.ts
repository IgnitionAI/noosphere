import { z } from "zod";
import { RetryableAgentError, TerminalAgentError } from "@outbound/application/gtm/product-research-ports";

const searchResultSchema = z.object({
  url: z.string().url(),
  canonicalUrl: z.string().url().nullable().optional(),
  title: z.string(),
  description: z.string(),
  markdown: z.string().nullable().optional(),
  contentHash: z.string().nullable().optional(),
  collectedAt: z.string().nullable().optional(),
  provider: z.string(),
});
const searchResponseSchema = z.object({
  success: z.literal(true),
  query: z.string(),
  results: z.array(searchResultSchema),
  provider: z.string(),
  correlationId: z.string().nullable().optional(),
  errors: z.array(z.string()).default([]),
});
const startResponseSchema = z.object({ success: z.literal(true), id: z.string() });
const crawledPageSchema = z.object({
  url: z.string().url(),
  canonicalUrl: z.string().url().nullable().optional(),
  title: z.string().nullable(),
  markdown: z.string(),
  contentHash: z.string().nullable().optional(),
  collectedAt: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
});
const statusResponseSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  error: z.string().nullable(),
  result: z
    .object({
      data: z.array(crawledPageSchema),
      errors: z.array(z.string()),
    })
    .nullable(),
});
const discoverResponseSchema = z.object({
  success: z.literal(true),
  pages: z.array(
    z.object({
      url: z.string().url(),
      title: z.string().nullable(),
      depth: z.number().int(),
      path: z.string(),
    }),
  ),
});

export type CrawlerSearchResult = z.infer<typeof searchResultSchema>;
export type CrawledPage = z.infer<typeof crawledPageSchema>;

export interface CrawlerClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly requestTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export class CrawlerClient {
  readonly #baseUrl: string;
  readonly #requestTimeoutMs: number;
  readonly #pollIntervalMs: number;

  constructor(private readonly options: CrawlerClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  async search(input: {
    query: string;
    limit: number;
    correlationId: string;
    searchDepth?: "basic" | "advanced";
  }): Promise<readonly CrawlerSearchResult[]> {
    const response = await this.#request("/crawl/search", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        searchDepth: input.searchDepth ?? "advanced",
        scrapeContent: false,
      }),
    });
    return searchResponseSchema.parse(await response.json()).results;
  }

  async readPages(input: {
    urls: readonly string[];
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<readonly CrawledPage[]> {
    const response = await this.#request("/crawl/pages", {
      method: "POST",
      body: JSON.stringify({
        urls: input.urls,
        includeImages: false,
        correlationId: input.correlationId,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const started = startResponseSchema.parse(await response.json());
    return this.#poll(started.id, input.signal);
  }

  async discover(input: {
    url: string;
    maxPages: number;
    maxDepth: number;
    correlationId: string;
  }): Promise<readonly { url: string; title: string | null; depth: number; path: string }[]> {
    const response = await this.#request("/crawl/discover", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        sameDomain: true,
        excludePatterns: [],
        includePatterns: [],
      }),
    });
    return discoverResponseSchema.parse(await response.json()).pages;
  }

  async #poll(jobId: string, signal?: AbortSignal): Promise<readonly CrawledPage[]> {
    while (!signal?.aborted) {
      const response = await this.#request(
        `/crawl/${jobId}`,
        signal ? { signal } : {},
      );
      const status = statusResponseSchema.parse(await response.json());
      if (status.status === "completed") return status.result?.data ?? [];
      if (status.status === "failed" || status.status === "cancelled") {
        throw new RetryableAgentError(
          "CRAWLER_JOB_LOST",
          status.error ?? `Crawler job ${status.status}`,
        );
      }
      await Bun.sleep(this.#pollIntervalMs);
    }
    throw new RetryableAgentError("CRAWLER_ABORTED", "Crawler request was aborted");
  }

  async #request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.options.apiKey,
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      throw new RetryableAgentError("CRAWLER_UNAVAILABLE", errorMessage(error));
    }
    if (response.status === 429 || response.status >= 500) {
      throw new RetryableAgentError("CRAWLER_UNAVAILABLE", `Crawler returned ${response.status}`);
    }
    if (!response.ok) {
      throw new TerminalAgentError("CRAWLER_REQUEST_REJECTED", `Crawler returned ${response.status}`);
    }
    return response;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
