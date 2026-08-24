import { afterEach, describe, expect, test } from "bun:test";
import { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("CrawlerClient browser-pool backpressure", () => {
  test("queues parallel page reads before the crawler returns 429", async () => {
    const jobs = new Map<string, number>();
    let active = 0;
    let maximumActive = 0;
    let jobSequence = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/crawl/pages") {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          if (active > 4) {
            active -= 1;
            return Response.json({ detail: "busy" }, { status: 429 });
          }
          const id = `job-${++jobSequence}`;
          jobs.set(id, Date.now() + 20);
          return Response.json({ success: true, id });
        }
        const id = url.pathname.split("/").at(-1)!;
        const completesAt = jobs.get(id);
        if (completesAt && Date.now() >= completesAt) {
          jobs.delete(id);
          active -= 1;
          return Response.json({ status: "completed", error: null, result: { data: [], errors: [] } });
        }
        return Response.json({ status: "running", error: null, result: null });
      },
    });
    servers.push(server);
    const client = new CrawlerClient({
      baseUrl: server.url.origin,
      apiKey: "test",
      pollIntervalMs: 1,
      maxConcurrentPageReads: 3,
    });

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        client.readPages({ urls: [`https://example.com/${index}`], correlationId: "test" }),
      ),
    );

    expect(maximumActive).toBe(3);
    expect(jobSequence).toBe(10);
  });

  test("retries a temporarily busy crawler before surfacing an outage", async () => {
    let starts = 0;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/crawl/pages") {
          starts += 1;
          if (starts < 3) return Response.json({ detail: "busy" }, { status: 429 });
          return Response.json({ success: true, id: "job-ok" });
        }
        return Response.json({ status: "completed", error: null, result: { data: [], errors: [] } });
      },
    });
    servers.push(server);
    const client = new CrawlerClient({
      baseUrl: server.url.origin,
      apiKey: "test",
      pollIntervalMs: 1,
      busyRetryDelayMs: 1,
      busyRetryAttempts: 3,
    });

    await expect(
      client.readPages({ urls: ["https://example.com"], correlationId: "test" }),
    ).resolves.toEqual([]);
    expect(starts).toBe(3);
  });

  test("classifies a missing polled job as retryable after a crawler restart", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/crawl/pages") {
          return Response.json({ success: true, id: "lost-job" });
        }
        return Response.json({ detail: "Job not found" }, { status: 404 });
      },
    });
    servers.push(server);
    const client = new CrawlerClient({
      baseUrl: server.url.origin,
      apiKey: "test",
      pollIntervalMs: 1,
    });

    const error = await client
      .readPages({
        urls: ["https://example.com"],
        correlationId: "test",
        requestKey: "stable-request-key",
      })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "RetryableAgentError", code: "CRAWLER_JOB_LOST" });
  });
});
