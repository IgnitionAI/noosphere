import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { CrawledPage, CrawlerSearchResult } from "./crawler-client";
import {
  RetryableAgentError,
  TerminalAgentError,
  type ResearchToolRequestRegistry,
  type ExternalQueryGuard,
} from "@outbound/application/gtm/product-research-ports";
import { ResearchBudgetExceededError } from "./research-budget";
import type { ResearchBudget } from "./research-budget";

const MAX_CONSECUTIVE_CRAWLER_FAILURES = 5;
const MAX_MARKDOWN_CHARACTERS_PER_TOOL_PAGE = 20_000;

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
    requestKey?: string;
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
    researchStageRunId: string | null;
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
  researchStageRunId?: string;
  signal: AbortSignal;
  recorder?: ResearchToolRunRecorder;
  registry?: ResearchToolRequestRegistry;
  externalQueryGuard?: ExternalQueryGuard;
  sensitiveTerms?: readonly string[];
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
          requestKey: `${input.runId}:${input.researchStageRunId ?? "stage"}:page:${url}`,
          signal: input.signal,
        });
        return JSON.stringify(
          pages[0] ? compactPageForAgent(pages[0]) : { error: "Page could not be read", url },
        );
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
        const pages = await input.crawler.readPages({
          urls,
          correlationId: input.correlationId,
          requestKey: await crawlerPageRequestKey(
            input.runId,
            input.researchStageRunId ?? "stage",
            urls,
          ),
          signal: input.signal,
        });
        return JSON.stringify(pages.map(compactPageForAgent));
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

function compactPageForAgent(page: CrawledPage): CrawledPage & {
  readonly markdownTruncated: boolean;
  readonly markdownOriginalCharacters: number;
} {
  return {
    ...page,
    markdown: page.markdown.slice(0, MAX_MARKDOWN_CHARACTERS_PER_TOOL_PAGE),
    markdownTruncated: page.markdown.length > MAX_MARKDOWN_CHARACTERS_PER_TOOL_PAGE,
    markdownOriginalCharacters: page.markdown.length,
  };
}

async function executeTool(
  input: Parameters<typeof createResearchTools>[0],
  state: { consecutiveCrawlerFailures: number },
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
  operation: () => Promise<string>,
): Promise<string> {
  const startedAt = Date.now();
  let registryLeaseToken: string | null = null;
  try {
    if (input.externalQueryGuard && isExternalTool(toolName)) {
      const authorization = await input.externalQueryGuard.authorize({
        channel: "web",
        payload: toolInput,
        sensitiveTerms: input.sensitiveTerms ?? [],
      });
      if (!authorization.allowed) {
        throw new TerminalAgentError(
          "EXTERNAL_QUERY_BLOCKED",
          `Outbound query rejected by DLP policy: ${authorization.reason}`,
        );
      }
    }
    if (input.registry) {
      const normalizedInput = normalizeToolInput(toolInput);
      const normalizedInputHash = await sha256(stableJson(normalizedInput));
      const claim = await input.registry.claim({
        workspaceId: input.workspaceId,
        runId: input.runId,
        toolName,
        normalizedInputHash,
        normalizedInput,
        now: new Date(),
        leaseMs: 5 * 60_000,
      });
      if (claim.kind === "cache_hit") {
        await recordCompleted(input, toolName, toolInput, startedAt, claim.output, true);
        return claim.output;
      }
      if (claim.kind === "in_progress") {
        throw new RetryableAgentError(
          "RESEARCH_TOOL_REQUEST_IN_PROGRESS",
          `An identical ${toolName} request is already running until ${claim.retryAt.toISOString()}`,
        );
      }
      registryLeaseToken = claim.leaseToken;
    }
    const output = await operation();
    if (input.registry && registryLeaseToken) {
      await input.registry.complete({
        leaseToken: registryLeaseToken,
        output,
        contentHash: await sha256(output),
        now: new Date(),
      });
    }
    state.consecutiveCrawlerFailures = 0;
    await recordCompleted(input, toolName, toolInput, startedAt, output, false);
    return output;
  } catch (error) {
    if (error instanceof TerminalAgentError && error.code === "EXTERNAL_QUERY_BLOCKED") {
      // Never persist the rejected payload: it may contain the exact internal
      // passage or credential that caused the policy to block the request.
      await input.recorder?.record({
        workspaceId: input.workspaceId,
        runId: input.runId,
        researchStageRunId: input.researchStageRunId ?? null,
        correlationId: input.correlationId,
        toolName,
        status: "failed",
        toolInput: { blocked: true },
        outputMetadata: {},
        latencyMs: Date.now() - startedAt,
        errorCode: error.code,
      });
      throw error;
    }
    if (input.registry && registryLeaseToken) {
      await input.registry.fail({
        leaseToken: registryLeaseToken,
        retryable:
          error instanceof RetryableAgentError || error instanceof ResearchBudgetExceededError,
        errorCode: error instanceof Error ? error.name : "TOOL_FAILED",
        now: new Date(),
      });
      registryLeaseToken = null;
    }
    if (
      error instanceof RetryableAgentError &&
      error.code === "CRAWLER_UNAVAILABLE"
    ) {
      state.consecutiveCrawlerFailures += 1;
      if (state.consecutiveCrawlerFailures >= MAX_CONSECUTIVE_CRAWLER_FAILURES) {
        await input.recorder?.record({
          workspaceId: input.workspaceId,
          runId: input.runId,
          researchStageRunId: input.researchStageRunId ?? null,
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
        researchStageRunId: input.researchStageRunId ?? null,
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
        researchStageRunId: input.researchStageRunId ?? null,
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
      researchStageRunId: input.researchStageRunId ?? null,
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

function isExternalTool(toolName: string): boolean {
  return ["searchWeb", "readWebPage", "discoverWebsite", "readWebsitePages"].includes(toolName);
}

async function recordCompleted(
  input: Parameters<typeof createResearchTools>[0],
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
  startedAt: number,
  output: string,
  cacheHit: boolean,
): Promise<void> {
  await input.recorder?.record({
    workspaceId: input.workspaceId,
    runId: input.runId,
    researchStageRunId: input.researchStageRunId ?? null,
    correlationId: input.correlationId,
    toolName,
    status: "completed",
    toolInput,
    outputMetadata: { outputCharacters: output.length, cacheHit },
    latencyMs: Date.now() - startedAt,
    errorCode: null,
  });
}

export function normalizeToolInput(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return normalizeValue(input) as Readonly<Record<string, unknown>>;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizeValue(child)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function crawlerPageRequestKey(
  runId: string,
  stageRunId: string,
  urls: readonly string[],
): Promise<string> {
  const digest = await sha256(stableJson(urls));
  return `${runId}:${stageRunId}:pages:${digest}`;
}
