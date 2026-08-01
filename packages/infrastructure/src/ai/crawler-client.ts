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
  /**
   * Keep one crawler slot free for discovery/other runs. Deep Agents may emit
   * many page reads in parallel, while the crawler intentionally has a small
   * browser pool.
   */
  readonly maxConcurrentPageReads?: number;
  readonly busyRetryAttempts?: number;
  readonly busyRetryDelayMs?: number;
}

export class CrawlerClient {
  readonly #baseUrl: string;
  readonly #requestTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #maxConcurrentPageReads: number;
  readonly #busyRetryAttempts: number;
  readonly #busyRetryDelayMs: number;
  #activePageReads = 0;
  readonly #pageReadWaiters: Array<() => void> = [];

  constructor(private readonly options: CrawlerClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 500;
    this.#maxConcurrentPageReads = options.maxConcurrentPageReads ?? 3;
    this.#busyRetryAttempts = options.busyRetryAttempts ?? 5;
    this.#busyRetryDelayMs = options.busyRetryDelayMs ?? 250;
    if (this.#maxConcurrentPageReads < 1) {
      throw new Error("maxConcurrentPageReads must be at least 1");
    }
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
    return this.#withPageReadSlot(input.signal, async () => {
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
    });
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
    const signal = init.signal ?? AbortSignal.timeout(this.#requestTimeoutMs);
    for (let attempt = 0; attempt < this.#busyRetryAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${this.#baseUrl}${path}`, {
          ...init,
          headers: {
            "content-type": "application/json",
            "x-api-key": this.options.apiKey,
            ...init.headers,
          },
          signal,
        });
      } catch (error) {
        throw new RetryableAgentError("CRAWLER_UNAVAILABLE", errorMessage(error));
      }
      if (response.status === 429 && attempt + 1 < this.#busyRetryAttempts) {
        await response.body?.cancel();
        await abortableSleep(this.#busyRetryDelayMs * (attempt + 1), signal);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        throw new RetryableAgentError("CRAWLER_UNAVAILABLE", `Crawler returned ${response.status}`);
      }
      if (!response.ok) {
        throw new TerminalAgentError("CRAWLER_REQUEST_REJECTED", `Crawler returned ${response.status}`);
      }
      return response;
    }
    throw new RetryableAgentError("CRAWLER_UNAVAILABLE", "Crawler remained busy");
  }

  async #withPageReadSlot<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    await this.#acquirePageReadSlot(signal);
    try {
      return await operation();
    } finally {
      this.#releasePageReadSlot();
    }
  }

  async #acquirePageReadSlot(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new RetryableAgentError("CRAWLER_ABORTED", "Crawler request was aborted");
    }
    if (this.#activePageReads < this.#maxConcurrentPageReads) {
      this.#activePageReads += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", abort);
        this.#activePageReads += 1;
        resolve();
      };
      const abort = () => {
        const index = this.#pageReadWaiters.indexOf(grant);
        if (index >= 0) this.#pageReadWaiters.splice(index, 1);
        reject(new RetryableAgentError("CRAWLER_ABORTED", "Crawler request was aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.#pageReadWaiters.push(grant);
    });
  }

  #releasePageReadSlot(): void {
    this.#activePageReads -= 1;
    const next = this.#pageReadWaiters.shift();
    next?.();
  }
}

async function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeout);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
