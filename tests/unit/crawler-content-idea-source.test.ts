import { expect, test } from "bun:test";
import { CrawlerContentIdeaSource } from "@outbound/infrastructure/content/crawler-content-idea-source";

const url = "https://example.com/support";
const query = { workspaceId: "workspace-a", deadlineAt: new Date(Date.now() + 60_000), query: "support knowledge", limit: 2, correlationId: "editorial-test" };
const searchResult = { url, title: "Truncated title ...", description: "Search snippet, not a verified passage", provider: "searxng" };
const markdown = "# A documented support procedure\n\nThe procedure requires the operator to compare the ticket configuration with the current approved documentation before choosing the escalation path.";

test("reads the discovered page before using it as editorial evidence", async () => {
  let read = false;
  const source = new CrawlerContentIdeaSource({
    async search() { return [searchResult]; },
    async readPages(input) {
      read = true;
      expect(input.urls).toEqual([url]);
      expect(input.signal).toBeDefined();
      expect(input.retryFailed).toBe(true);
      return [{ url, canonicalUrl: url, title: "A documented support procedure", markdown, metadata: {} }];
    },
  });
  const evidence = await source.search(query);
  expect(read).toBe(true);
  expect(evidence[0]).toMatchObject({ title: "A documented support procedure", excerpt: markdown, canonicalUrl: url });
  expect(evidence[0]?.contentHash).toBe(new Bun.CryptoHasher("sha256").update(markdown).digest("hex"));
});

test("does not promote unread or unrelated pages into source evidence", async () => {
  const source = new CrawlerContentIdeaSource({
    async search() { return [searchResult]; },
    async readPages() { return [{ url: "https://unrelated.example", title: "Other page", markdown, metadata: {} }]; },
  });
  await expect(source.search(query)).rejects.toThrow("CONTENT_SOURCE_READ_FAILED");
});

test("retains successful page reads without substituting snippets for failed pages", async () => {
  const source = new CrawlerContentIdeaSource({
    async search() { return [searchResult, {...searchResult,url:url+"/missing"}]; },
    async readPages() { return [{ url, title: "Document", markdown, metadata: {} }]; },
  });
  expect(await source.search(query)).toHaveLength(1);
});

test("a failed individual read does not discard another page and retries use stable request keys", async () => {
  const requests: string[] = [];
  const source = new CrawlerContentIdeaSource({
    async search() { return [searchResult, {...searchResult,url:url+"/slow"}]; },
    async readPages(input) {
      expect(input.urls).toHaveLength(1);
      expect(input.requestKey).toBeDefined();
      requests.push(input.requestKey!);
      if (input.urls[0]!.endsWith('/slow')) throw new Error('read timed out');
      return [{url,title:'Document',markdown,metadata:{}}];
    },
  });
  expect(await source.search(query)).toHaveLength(1);
  const first=[...requests];
  expect(await source.search(query)).toHaveLength(1);
  expect(requests.slice(2)).toEqual(first);
});

test("an empty extraction is a read failure, not a successful empty search", async () => {
  const source = new CrawlerContentIdeaSource({async search(){return [searchResult];},async readPages(){return [];}});
  await expect(source.search(query)).rejects.toThrow('CONTENT_SOURCE_READ_FAILED');
  const noResults = new CrawlerContentIdeaSource({async search(){return [];},async readPages(){throw new Error('must not read');}});
  expect(await noResults.search(query)).toEqual([]);
});

test("does not start discovery after the study deadline", async () => {
  let searched = false;
  const source = new CrawlerContentIdeaSource({
    async search() { searched = true; return []; },
    async readPages() { throw new Error("must not read"); },
  });
  await expect(source.search({ ...query, workspaceId: "workspace-a", deadlineAt: new Date(0) })).rejects.toThrow("CONTENT_SOURCE_DEADLINE_EXCEEDED");
  expect(searched).toBe(false);
});

test("the discovery deadline aborts search and prevents page reads", async () => {
  let read = false;
  const source = new CrawlerContentIdeaSource({
    async search(input) {
      expect(input.signal).toBeDefined();
      await new Promise<void>(resolve => input.signal!.addEventListener("abort", () => resolve(), { once: true }));
      return [searchResult];
    },
    async readPages() { read = true; return []; },
  });
  await expect(source.search({ ...query, workspaceId: "workspace-a", deadlineAt: new Date(Date.now() + 30) })).rejects.toThrow("CONTENT_SOURCE_DEADLINE_EXCEEDED");
  expect(read).toBe(false);
});

test("empty extracted pages do not turn global budget expiry into a provider failure", async () => {
  const { ContentIdeaSourceDeadlineError } = await import("@outbound/application/content/content-ideas");
  const source = new CrawlerContentIdeaSource({
    async search() { return [searchResult, { ...searchResult, url: url + "/slow" }]; },
    async readPages(input) {
      if (input.urls[0] === url) return [{ url, title: "Empty", markdown: "", metadata: {} }];
      await new Promise<void>(resolve => input.signal!.addEventListener("abort", () => resolve(), { once: true }));
      throw new Error("CRAWLER_UNAVAILABLE");
    },
  });
  await expect(source.search({ ...query, deadlineAt: new Date(Date.now() + 30) })).rejects.toBeInstanceOf(ContentIdeaSourceDeadlineError);
});
