import { describe, expect, test } from "bun:test";
import { RetryableAgentError } from "@outbound/application/gtm/product-research-ports";
import { ResearchBudget, ResearchBudgetExceededError } from "@outbound/infrastructure/ai/research-budget";
import {
  createResearchTools,
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
