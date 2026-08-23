import { describe, expect, test } from "bun:test";
import {
  RetryableAgentError,
  TerminalAgentError,
  type ResearchToolRequestRegistry,
} from "@outbound/application/gtm/product-research-ports";
import { DefaultExternalQueryGuard } from "@outbound/infrastructure/ai/external-query-guard";
import { ResearchBudget, ResearchBudgetExceededError } from "@outbound/infrastructure/ai/research-budget";
import {
  createResearchTools,
  normalizeToolInput,
  UnavailableInternalDocumentSearch,
  type ResearchCrawler,
} from "@outbound/infrastructure/ai/research-tools";

describe("research AI tools crawler resilience", () => {
  function createHarness(crawler: ResearchCrawler) {
    return createResearchTools({
      crawler,
      documents: new UnavailableInternalDocumentSearch(),
      budget: new ResearchBudget({
        searches: 100,
        pages: 100,
        tokens: 100_000,
        durationMs: 60_000,
      }),
      workspaceId: crypto.randomUUID(),
      documentIds: [],
      runId: crypto.randomUUID(),
      correlationId: "test",
      signal: new AbortController().signal,
    });
  }

  test("returns a soft result on isolated crawler outages and rethrows after 5 consecutive failures", async () => {
    let calls = 0;
    const tools = createHarness({
      async search() {
        calls += 1;
        throw new RetryableAgentError("CRAWLER_UNAVAILABLE", "Crawler returned 429");
      },
      async readPages() {
        return [];
      },
      async discover() {
        return [];
      },
    });
    const search = tools.find((item) => item.name === "searchWeb")!;

    for (let failure = 0; failure < 4; failure += 1) {
      const soft = (await search.invoke({ query: "test query", limit: 1 })) as string;
      expect(JSON.parse(soft)).toMatchObject({ crawlerUnavailable: true });
    }
    await expect(search.invoke({ query: "test query", limit: 1 })).rejects.toBeInstanceOf(
      RetryableAgentError,
    );
    expect(calls).toBe(5);
  });

  test("resets the consecutive failure counter after a successful call", async () => {
    let calls = 0;
    const tools = createHarness({
      async search() {
        calls += 1;
        if (calls <= 3 || calls >= 5) {
          throw new RetryableAgentError("CRAWLER_UNAVAILABLE", "Crawler returned 429");
        }
        return [];
      },
      async readPages() {
        return [];
      },
      async discover() {
        return [];
      },
    });
    const search = tools.find((item) => item.name === "searchWeb")!;

    for (let failure = 0; failure < 3; failure += 1) {
      await search.invoke({ query: "test query", limit: 1 });
    }
    await search.invoke({ query: "test query", limit: 1 }); // success resets the counter
    const soft = (await search.invoke({ query: "test query", limit: 1 })) as string;
    expect(JSON.parse(soft)).toMatchObject({ crawlerUnavailable: true });
  });
});

describe("research AI tools", () => {
  test("blocks secrets and internal passages before any external request", async () => {
    const sensitivePassage = "Confidential roadmap delta seven is reserved for internal review";
    const guard = new DefaultExternalQueryGuard();
    expect(await guard.authorize({
      channel: "web",
      payload: { query: sensitivePassage },
      sensitiveTerms: [sensitivePassage],
    })).toEqual({ allowed: false, reason: "INTERNAL_DOCUMENT_TERM_DETECTED" });
    expect(await guard.authorize({
      channel: "web",
      payload: { query: "api_key=abcdefghijk123456" },
      sensitiveTerms: [],
    })).toEqual({ allowed: false, reason: "SECRET_PATTERN_DETECTED" });
    expect(await guard.authorize({
      channel: "web",
      payload: { query: "France document management market" },
      sensitiveTerms: [sensitivePassage],
    })).toEqual({ allowed: true });
  });

  test("redacts a DLP-blocked query from traces and never calls the crawler", async () => {
    const sensitivePassage = "Confidential roadmap delta seven is reserved for internal review";
    let crawlerCalls = 0;
    const recorded: Array<Record<string, unknown>> = [];
    const tools = createResearchTools({
      crawler: {
        async search() {
          crawlerCalls += 1;
          return [];
        },
        async readPages() {
          crawlerCalls += 1;
          return [];
        },
        async discover() {
          crawlerCalls += 1;
          return [];
        },
      },
      documents: new UnavailableInternalDocumentSearch(),
      budget: new ResearchBudget({ searches: 1, pages: 1, tokens: 100, durationMs: 60_000 }),
      workspaceId: crypto.randomUUID(),
      documentIds: [],
      runId: crypto.randomUUID(),
      correlationId: "test",
      signal: new AbortController().signal,
      externalQueryGuard: new DefaultExternalQueryGuard(),
      sensitiveTerms: [sensitivePassage],
      recorder: {
        async record(input) {
          recorded.push(input);
        },
      },
    });

    await expect(tools.find((item) => item.name === "searchWeb")!.invoke({
      query: sensitivePassage,
      limit: 1,
    })).rejects.toBeInstanceOf(TerminalAgentError);

    expect(crawlerCalls).toBe(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      status: "failed",
      errorCode: "EXTERNAL_QUERY_BLOCKED",
      toolInput: { blocked: true },
    });
    expect(JSON.stringify(recorded)).not.toContain(sensitivePassage);
  });

  test("normalizes equivalent tool inputs before durable cache lookup", () => {
    expect(normalizeToolInput({ limit: 5, query: "  buyer   workflow " })).toEqual({
      limit: 5,
      query: "buyer workflow",
    });
  });

  test("reuses a successful tool output without calling the crawler again", async () => {
    let crawlerCalls = 0;
    const entries = new Map<string, { output: string; contentHash: string }>();
    const leases = new Map<string, string>();
    const registry: ResearchToolRequestRegistry = {
      async claim(input) {
        const cached = entries.get(input.normalizedInputHash);
        if (cached) return { kind: "cache_hit" as const, ...cached };
        const leaseToken = crypto.randomUUID();
        leases.set(leaseToken, input.normalizedInputHash);
        return { kind: "execute" as const, leaseToken };
      },
      async complete(input) {
        const key = leases.get(input.leaseToken)!;
        entries.set(key, { output: input.output, contentHash: input.contentHash });
      },
      async fail() {},
    };
    const tools = createResearchTools({
      crawler: {
        async search() {
          crawlerCalls += 1;
          return [];
        },
        async readPages() { return []; },
        async discover() { return []; },
      },
      documents: new UnavailableInternalDocumentSearch(),
      budget: new ResearchBudget({ searches: 5, pages: 5, tokens: 100, durationMs: 60_000 }),
      workspaceId: crypto.randomUUID(),
      documentIds: [],
      runId: crypto.randomUUID(),
      correlationId: "test",
      signal: new AbortController().signal,
      registry,
    });
    const search = tools.find((item) => item.name === "searchWeb")!;

    await search.invoke({ query: "buyer workflow", limit: 1 });
    await search.invoke({ query: "  buyer   workflow ", limit: 1 });

    expect(crawlerCalls).toBe(1);
  });

  test("bounds page markdown before adding it to the model context", async () => {
    const tools = createResearchTools({
      crawler: {
        async search() {
          return [];
        },
        async readPages() {
          return [
            {
              url: "https://example.com/long",
              canonicalUrl: "https://example.com/long",
              title: "Long page",
              markdown: "x".repeat(25_000),
              contentHash: "hash",
              collectedAt: new Date().toISOString(),
              metadata: {},
            },
          ];
        },
        async discover() {
          return [];
        },
      },
      documents: new UnavailableInternalDocumentSearch(),
      budget: new ResearchBudget({
        searches: 1,
        pages: 10,
        tokens: 100,
        durationMs: 60_000,
      }),
      workspaceId: crypto.randomUUID(),
      documentIds: [],
      runId: crypto.randomUUID(),
      correlationId: "test",
      signal: new AbortController().signal,
    });
    const read = tools.find((item) => item.name === "readWebPage")!;

    const output = JSON.parse(
      (await read.invoke({ url: "https://example.com/long" })) as string,
    );

    expect(output.markdown).toHaveLength(20_000);
    expect(output.markdownTruncated).toBe(true);
    expect(output.markdownOriginalCharacters).toBe(25_000);
  });

  test("hashes selective-page idempotency keys so valid URL batches fit the crawler contract", async () => {
    const requestKeys: string[] = [];
    const runId = crypto.randomUUID();
    const stageRunId = crypto.randomUUID();
    const tools = createResearchTools({
      crawler: {
        async search() { return []; },
        async readPages(input) {
          requestKeys.push(input.requestKey ?? "");
          return [];
        },
        async discover() { return []; },
      },
      documents: new UnavailableInternalDocumentSearch(),
      budget: new ResearchBudget({ searches: 1, pages: 8, tokens: 100, durationMs: 60_000 }),
      workspaceId: crypto.randomUUID(),
      documentIds: [],
      runId,
      researchStageRunId: stageRunId,
      correlationId: "test",
      signal: new AbortController().signal,
    });
    const read = tools.find((item) => item.name === "readWebsitePages")!;
    const urls = Array.from({ length: 4 }, (_, index) =>
      `https://example.com/${index}/${"long-path-segment-".repeat(20)}`,
    );

    await read.invoke({ urls });
    await read.invoke({ urls });

    expect(requestKeys).toHaveLength(2);
    expect(requestKeys[0]).toBe(requestKeys[1]);
    expect(requestKeys[0]?.startsWith(`${runId}:${stageRunId}:pages:`)).toBe(true);
    expect(requestKeys[0]!.length).toBeLessThanOrEqual(500);
    expect(requestKeys[0]).not.toContain("long-path-segment");
  });

  test("enforces the web search budget before calling the crawler", async () => {
    let calls = 0;
    const crawler = {
      async search() {
        calls += 1;
        return [];
      },
      async readPages() {
        return [];
      },
      async discover() {
        return [];
      },
    };
    const budget = new ResearchBudget({
      searches: 1,
      pages: 1,
      tokens: 100,
      durationMs: 60_000,
    });
    const tools = createResearchTools({
      crawler,
      documents: new UnavailableInternalDocumentSearch(),
      budget,
      workspaceId: crypto.randomUUID(),
      documentIds: [],
      runId: crypto.randomUUID(),
      correlationId: "test",
      signal: new AbortController().signal,
    });
    const search = tools.find((item) => item.name === "searchWeb");
    expect(search).toBeDefined();
    await search!.invoke({ query: "first query", limit: 1 });
    expect(calls).toBe(1);
    const exhausted = (await search!.invoke({ query: "second query", limit: 1 })) as string;
    expect(JSON.parse(exhausted)).toMatchObject({
      budgetExhausted: true,
      resource: "searches",
    });
    expect(calls).toBe(1);
  });

  test("does not expose a generic fetch or write tool", () => {
    const tools = createResearchTools({
      crawler: {
        async search() {
          return [];
        },
        async readPages() {
          return [];
        },
        async discover() {
          return [];
        },
      },
      documents: new UnavailableInternalDocumentSearch(),
      budget: new ResearchBudget({
        searches: 1,
        pages: 1,
        tokens: 100,
        durationMs: 60_000,
      }),
      workspaceId: crypto.randomUUID(),
      documentIds: [],
      runId: crypto.randomUUID(),
      correlationId: "test",
      signal: new AbortController().signal,
    });
    expect(tools.map((item) => item.name)).toEqual([
      "searchWeb",
      "readWebPage",
      "discoverWebsite",
      "readWebsitePages",
      "searchInternalDocuments",
      "readInternalDocument",
    ]);
  });

  test("attributes every tool call to the durable research stage attempt", async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const researchStageRunId = crypto.randomUUID();
    const tools = createResearchTools({
      crawler: {
        async search() {
          return [];
        },
        async readPages() {
          return [];
        },
        async discover() {
          return [];
        },
      },
      documents: new UnavailableInternalDocumentSearch(),
      budget: new ResearchBudget({
        searches: 1,
        pages: 1,
        tokens: 100,
        durationMs: 60_000,
      }),
      workspaceId: crypto.randomUUID(),
      documentIds: [],
      runId: crypto.randomUUID(),
      researchStageRunId,
      correlationId: "test",
      signal: new AbortController().signal,
      recorder: {
        async record(input) {
          recorded.push(input);
        },
      },
    });
    await tools.find((item) => item.name === "searchWeb")!.invoke({
      query: "buyer workflow",
      limit: 1,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      researchStageRunId,
      toolName: "searchWeb",
      status: "completed",
    });
  });

  test("a soft token budget records usage beyond the limit without throwing", () => {
    const budget = new ResearchBudget(
      { searches: 1, pages: 1, tokens: 10, durationMs: 60_000 },
      { softTokens: true },
    );
    expect(() => budget.recordTokens(500)).not.toThrow();
    expect(budget.snapshot().tokens).toBe(500);
  });

  test("a hard token budget throws beyond the limit", () => {
    const budget = new ResearchBudget({
      searches: 1,
      pages: 1,
      tokens: 10,
      durationMs: 60_000,
    });
    expect(() => budget.recordTokens(500)).toThrow(ResearchBudgetExceededError);
  });
});
