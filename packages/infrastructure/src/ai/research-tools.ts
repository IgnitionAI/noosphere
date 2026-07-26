import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { CrawledPage, CrawlerSearchResult } from "./crawler-client";
import { RetryableAgentError } from "@outbound/application/gtm/product-research-ports";
import { ResearchBudgetExceededError } from "./research-budget";
import type { ResearchBudget } from "./research-budget";

const MAX_CONSECUTIVE_CRAWLER_FAILURES = 5;

export interface InternalDocumentSearch {
  search(input: {
    workspaceId: string;
    documentIds: readonly string[];
    query: string;
    limit: number;
  }): Promise<readonly Record<string, unknown>[]>;
  read(input: {
    workspaceId: string;
    documentIds: readonly string[];
    chunkId: string;
    contextWindow: number;
  }): Promise<Readonly<Record<string, unknown>> | null>;
}

export interface ResearchCrawler {
  search(input: {
    query: string;
    limit: number;
    correlationId: string;
    searchDepth?: "basic" | "advanced";
  }): Promise<readonly CrawlerSearchResult[]>;
  readPages(input: {
    urls: readonly string[];
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<readonly CrawledPage[]>;
  discover(input: {
    url: string;
    maxPages: number;
    maxDepth: number;
    correlationId: string;
  }): Promise<readonly { url: string; title: string | null; depth: number; path: string }[]>;
}

export class UnavailableInternalDocumentSearch implements InternalDocumentSearch {
  async search(): Promise<readonly Record<string, unknown>[]> {
    return [];
  }
  async read(): Promise<null> {
    return null;
  }
}

export interface ResearchToolRunRecorder {
  record(input: {
    workspaceId: string;
    runId: string;
    correlationId: string;
    toolName: string;
    status: "completed" | "failed" | "budget_exhausted" | "crawler_error";
    toolInput: Readonly<Record<string, unknown>>;
    outputMetadata: Readonly<Record<string, unknown>>;
    latencyMs: number;
    errorCode: string | null;
  }): Promise<void>;
}

export function createResearchTools(input: {
  crawler: ResearchCrawler;
  documents: InternalDocumentSearch;
  budget: ResearchBudget;
  workspaceId: string;
  documentIds: readonly string[];
  correlationId: string;
  runId: string;
  signal: AbortSignal;
  recorder?: ResearchToolRunRecorder;
}) {
  const state = { consecutiveCrawlerFailures: 0 };
  const searchWeb = tool(
    async ({ query, limit }) =>
      executeTool(input, state, "searchWeb", { query, limit }, async () => {
        input.budget.consumeSearches();
        const results = await input.crawler.search({
          query,
          limit,
          correlationId: input.correlationId,
        });
        return JSON.stringify(results);
      }),
    {
      name: "searchWeb",
      description: "Discover current public sources. Returns metadata and excerpts, not authoritative full page content.",
      schema: z.object({
        query: z.string().min(2).max(500),
        limit: z.number().int().min(1).max(10).default(5),
      }),
    },
  );

  const readWebPage = tool(
    async ({ url }) =>
      executeTool(input, state, "readWebPage", { url }, async () => {
        input.budget.consumePages();
        const pages = await input.crawler.readPages({
          urls: [url],
          correlationId: input.correlationId,
          signal: input.signal,
        });
        return JSON.stringify(pages[0] ?? { error: "Page could not be read", url });
      }),
    {
      name: "readWebPage",
      description: "Read and normalize one public page through the private Outbound crawler.",
      schema: z.object({ url: z.string().url() }),
    },
  );

  const discoverWebsite = tool(
    async ({ url, maxPages, maxDepth }) =>
      executeTool(input, state, "discoverWebsite", { url, maxPages, maxDepth }, async () => {
        input.budget.consumePages(Math.min(maxPages, 10));
        return JSON.stringify(
          await input.crawler.discover({
            url,
            maxPages,
            maxDepth,
            correlationId: input.correlationId,
          }),
        );
      }),
    {
      name: "discoverWebsite",
      description: "Discover relevant pages on one public website without returning their full content.",
      schema: z.object({
        url: z.string().url(),
        maxPages: z.number().int().min(1).max(30).default(10),
        maxDepth: z.number().int().min(1).max(3).default(2),
      }),
    },
  );

  const readWebsitePages = tool(
    async ({ urls }) =>
      executeTool(input, state, "readWebsitePages", { urls }, async () => {
        input.budget.consumePages(urls.length);
        return JSON.stringify(
          await input.crawler.readPages({
            urls,
            correlationId: input.correlationId,
            signal: input.signal,
          }),
        );
      }),
    {
      name: "readWebsitePages",
      description: "Read up to four selected public pages through the private Outbound crawler.",
      schema: z.object({ urls: z.array(z.string().url()).min(1).max(4) }),
    },
  );

  const searchInternalDocuments = tool(
    async ({ query, limit }) =>
      executeTool(input, state, "searchInternalDocuments", { query, limit }, async () =>
        JSON.stringify(await input.documents.search({
          workspaceId: input.workspaceId,
          documentIds: input.documentIds,
          query,
          limit,
        })),
      ),
    {
      name: "searchInternalDocuments",
      description: "Search only the internal documents explicitly attached to this research run.",
      schema: z.object({
        query: z.string().min(2).max(500),
        limit: z.number().int().min(1).max(10).default(5),
      }),
    },
  );

  const readInternalDocument = tool(
    async ({ chunkId, contextWindow }) =>
      executeTool(input, state, "readInternalDocument", { chunkId, contextWindow }, async () =>
        JSON.stringify((await input.documents.read({
          workspaceId: input.workspaceId,
          documentIds: input.documentIds,
          chunkId,
          contextWindow,
        })) ?? { error: "Chunk not found" }),
      ),
    {
      name: "readInternalDocument",
      description: "Read a matched internal document passage and its neighboring chunks.",
      schema: z.object({
        chunkId: z.string().uuid(),
        contextWindow: z.number().int().min(0).max(3).default(1),
      }),
    },
  );

  return [
    searchWeb,
    readWebPage,
    discoverWebsite,
    readWebsitePages,
    searchInternalDocuments,
    readInternalDocument,
  ] as const;
}

async function executeTool(
  input: Parameters<typeof createResearchTools>[0],
  state: { consecutiveCrawlerFailures: number },
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
  operation: () => Promise<string>,
): Promise<string> {
  const startedAt = Date.now();
  try {
    const output = await operation();
    state.consecutiveCrawlerFailures = 0;
    await input.recorder?.record({
      workspaceId: input.workspaceId,
      runId: input.runId,
      correlationId: input.correlationId,
      toolName,
      status: "completed",
      toolInput,
      outputMetadata: { outputCharacters: output.length },
      latencyMs: Date.now() - startedAt,
      errorCode: null,
    });
    return output;
  } catch (error) {
    if (
      error instanceof RetryableAgentError &&
      error.code === "CRAWLER_UNAVAILABLE"
    ) {
      state.consecutiveCrawlerFailures += 1;
      if (state.consecutiveCrawlerFailures >= MAX_CONSECUTIVE_CRAWLER_FAILURES) {
        await input.recorder?.record({
          workspaceId: input.workspaceId,
          runId: input.runId,
          correlationId: input.correlationId,
          toolName,
          status: "failed",
          toolInput,
          outputMetadata: {},
          latencyMs: Date.now() - startedAt,
          errorCode: error.code,
        });
        throw error;
      }
      // Isolated crawler outage (rate limit, transient timeout): hand a soft
      // error back to the agent so it can try another source instead of
      // losing the whole stage execution.
      await input.recorder?.record({
        workspaceId: input.workspaceId,
        runId: input.runId,
        correlationId: input.correlationId,
        toolName,
        status: "crawler_error",
        toolInput,
        outputMetadata: {},
        latencyMs: Date.now() - startedAt,
        errorCode: error.code,
      });
      return JSON.stringify({
        crawlerUnavailable: true,
        message:
          "This source could not be retrieved right now (temporary crawler outage or rate limit). Continue with other sources, retry later in your plan, or mark the related claims as hypotheses.",
      });
    }
    if (error instanceof ResearchBudgetExceededError) {
      // Budget exhaustion must not kill the stage: hand control back to the
      // agent so it synthesizes its structured answer from what it collected.
      await input.recorder?.record({
        workspaceId: input.workspaceId,
        runId: input.runId,
        correlationId: input.correlationId,
        toolName,
        status: "budget_exhausted",
        toolInput,
        outputMetadata: {},
        latencyMs: Date.now() - startedAt,
        errorCode: error.name,
      });
      return JSON.stringify({
        budgetExhausted: true,
        resource: error.resource,
        message:
          "The research budget for this tool category is exhausted. Do not call research tools again: synthesize the final structured answer now, using only the evidence already collected and marking weakly supported claims as hypotheses.",
      });
    }
    await input.recorder?.record({
      workspaceId: input.workspaceId,
      runId: input.runId,
      correlationId: input.correlationId,
      toolName,
      status: "failed",
      toolInput,
      outputMetadata: {},
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : "TOOL_FAILED",
    });
    throw error;
  }
}
