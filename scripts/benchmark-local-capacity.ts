import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

type DockerSample = {
  readonly at: string;
  readonly services: Readonly<Record<string, { cpuPercent: number; memoryMiB: number }>>;
};

type ScenarioResult = {
  readonly name: string;
  readonly target: string;
  readonly requests: number;
  readonly concurrency: number;
  readonly durationMs: number;
  readonly throughputPerSecond: number;
  readonly errors: number;
  readonly latencyMs: { readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number };
  readonly resourcePeaks: Readonly<Record<string, { cpuPercent: number; memoryMiB: number }>>;
};

type CrawlerScenarioResult = {
  readonly name: "crawler_four_public_domains";
  readonly targets: readonly string[];
  readonly durationMs: number;
  readonly completed: number;
  readonly errors: readonly string[];
  readonly pagesProduced: number;
  readonly resourcePeaks: Readonly<Record<string, { cpuPercent: number; memoryMiB: number }>>;
};

type CrawlerStatus = {
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly error?: string | null;
  readonly result?: { readonly pagesCount?: number } | null;
};

const apiUrl = new URL(process.env.BENCHMARK_API_URL ?? "http://127.0.0.1:63001");
const webUrl = new URL(process.env.BENCHMARK_WEB_URL ?? "http://127.0.0.1:63000");
const crawlerUrl = new URL(process.env.BENCHMARK_CRAWLER_URL ?? "http://127.0.0.1:63080");
const requestCount = positiveInteger("BENCHMARK_REQUESTS", 1_000);
const ssrRequestCount = positiveInteger("BENCHMARK_SSR_REQUESTS", 200);
const concurrency = positiveInteger("BENCHMARK_CONCURRENCY", 20);
const ssrConcurrency = positiveInteger("BENCHMARK_SSR_CONCURRENCY", 5);
const outputPath = process.env.BENCHMARK_OUTPUT;
const email = required("BOOTSTRAP_OWNER_EMAIL");
const password = required("BOOTSTRAP_OWNER_PASSWORD");
const crawlerApiKey = required("CRAWLER_API_KEY");
const containerPrefix = process.env.BENCHMARK_CONTAINER_PREFIX ?? "ignition-outbound";
const containerServices = ["api", "web", "worker", "decision-worker", "database", "minio", "searxng", "crawler"] as const;

await waitFor(new URL("/health/ready", apiUrl), 120_000);
await waitFor(new URL("/login", webUrl), 120_000);
await waitFor(new URL("/health", crawlerUrl), 120_000);

const signIn = await fetch(new URL("/api/auth/sign-in/email", webUrl), {
  method: "POST",
  headers: { "content-type": "application/json", origin: webUrl.origin },
  body: JSON.stringify({ email, password }),
});
if (!signIn.ok) throw new Error(`Benchmark sign-in failed: ${signIn.status}`);
const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Benchmark sign-in did not return a session cookie");

const workspaceResponse = await fetch(new URL("/api/v1/workspaces", apiUrl), { headers: { cookie } });
if (!workspaceResponse.ok) throw new Error(`Workspace lookup failed: ${workspaceResponse.status}`);
const workspaceBody = await workspaceResponse.json() as { data?: Array<{ slug: string }> };
const workspaceSlug = process.env.BENCHMARK_WORKSPACE_SLUG ?? workspaceBody.data?.[0]?.slug;
if (!workspaceSlug) throw new Error("No benchmark workspace is available");

const apiHeaders = { cookie, "x-workspace-slug": workspaceSlug };
const pageHeaders = { cookie };
const scenarios: ScenarioResult[] = [];

scenarios.push(await runScenario({
  name: "health_ready",
  target: new URL("/health/ready", apiUrl),
  requests: requestCount,
  concurrency,
  headers: {},
}));
const crawler = await runCrawlerScenario();
scenarios.push(await runScenario({
  name: "operational_read_mix",
  target: new URL("/api/v1/workspace/operational-summary", apiUrl),
  requests: requestCount,
  concurrency,
  headers: apiHeaders,
  paths: [
    "/api/v1/workspace/operational-summary",
    "/api/v1/activity?lens=inbound",
    "/api/v1/activity?lens=symbiosis",
    "/api/v1/activity?lens=outbound",
    "/api/v1/prospects?limit=20",
    "/api/v1/conversations?page=1&pageSize=20",
    "/api/v1/pipeline/view",
    "/api/v1/content/ideas?limit=20",
    "/api/v1/content/publications?limit=20",
  ],
}));
scenarios.push(await runScenario({
  name: "today_ssr",
  target: new URL(`/w/${workspaceSlug}`, webUrl),
  requests: ssrRequestCount,
  concurrency: ssrConcurrency,
  headers: pageHeaders,
}));
scenarios.push(await runScenario({
  name: "prospects_ssr",
  target: new URL(`/w/${workspaceSlug}/prospects?campaignScope=outside_campaign`, webUrl),
  requests: ssrRequestCount,
  concurrency: ssrConcurrency,
  headers: pageHeaders,
}));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  topology: "standard_without_docling_or_proxy",
  workspaceSlug,
  runtime: {
    bun: Bun.version,
    platform: process.platform,
    architecture: process.arch,
    docker: dockerInfo(),
  },
  configuration: {
    requestCount,
    concurrency,
    ssrRequestCount,
    ssrConcurrency,
  },
  scenarios,
  crawler,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, serialized);
}
process.stdout.write(serialized);

async function runScenario(input: {
  name: string;
  target: URL;
  requests: number;
  concurrency: number;
  headers: HeadersInit;
  paths?: readonly string[];
}): Promise<ScenarioResult> {
  for (let index = 0; index < Math.min(20, input.requests); index += 1) {
    const response = await fetch(resolveTarget(input, index), { headers: input.headers });
    await response.arrayBuffer();
  }

  const samples: DockerSample[] = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      samples.push(await sampleDocker());
      await Bun.sleep(750);
    }
  })();
  const latencies = new Array<number>(input.requests);
  let errors = 0;
  let nextIndex = 0;
  const startedAt = performance.now();
  const workers = Array.from({ length: input.concurrency }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= input.requests) return;
      const requestStartedAt = performance.now();
      try {
        const response = await fetch(resolveTarget(input, index), { headers: input.headers });
        await response.arrayBuffer();
        if (!response.ok) errors += 1;
      } catch {
        errors += 1;
      } finally {
        latencies[index] = performance.now() - requestStartedAt;
      }
    }
  });
  await Promise.all(workers);
  const durationMs = performance.now() - startedAt;
  sampling = false;
  await sampler;
  samples.push(await sampleDocker());

  const sorted = latencies.toSorted((left, right) => left - right);
  return {
    name: input.name,
    target: input.paths ? `${apiUrl.origin}/mixed` : input.target.toString(),
    requests: input.requests,
    concurrency: input.concurrency,
    durationMs: rounded(durationMs),
    throughputPerSecond: rounded(input.requests / (durationMs / 1_000)),
    errors,
    latencyMs: {
      p50: rounded(percentile(sorted, 0.5)),
      p95: rounded(percentile(sorted, 0.95)),
      p99: rounded(percentile(sorted, 0.99)),
      max: rounded(sorted.at(-1) ?? 0),
    },
    resourcePeaks: resourcePeaks(samples),
  };
}

async function runCrawlerScenario(): Promise<CrawlerScenarioResult> {
  const targets = [
    "https://example.com/",
    "https://www.iana.org/help/example-domains",
    "https://www.rfc-editor.org/rfc/rfc2606",
    "https://httpbin.org/html",
  ] as const;
  const errors: string[] = [];
  const samples: DockerSample[] = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      samples.push(await sampleDocker());
      await Bun.sleep(750);
    }
  })();
  const startedAt = performance.now();
  let finalStatuses: CrawlerStatus[] = [];
  let durationMs = 0;
  try {
    const jobs = await Promise.all(targets.map(async (target) => {
      const response = await fetch(new URL("/crawl/pages", crawlerUrl), {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": crawlerApiKey },
        body: JSON.stringify({
          urls: [target],
          includeImages: false,
          correlationId: `perf-001:${target}`,
          idempotencyKey: `perf-001-${crypto.randomUUID()}`,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Crawler start failed for ${target}: ${response.status} ${detail.slice(0, 200)}`);
      }
      return await response.json() as { id: string };
    }));
    finalStatuses = await Promise.all(jobs.map(async ({ id }, index): Promise<CrawlerStatus> => {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const response = await fetch(new URL(`/crawl/${id}`, crawlerUrl), {
          headers: { "x-api-key": crawlerApiKey },
        });
        if (!response.ok) throw new Error(`Crawler status failed: ${response.status}`);
        const status = await response.json() as CrawlerStatus;
        if (["completed", "failed", "cancelled"].includes(status.status)) {
          if (status.status !== "completed") errors.push(`${targets[index]}: ${status.error ?? status.status}`);
          return status;
        }
        await Bun.sleep(250);
      }
      errors.push(`${targets[index]}: timeout`);
      return { status: "failed", result: null };
    }));
    durationMs = performance.now() - startedAt;
  } finally {
    sampling = false;
    await sampler;
    samples.push(await sampleDocker());
  }
  return {
    name: "crawler_four_public_domains",
    targets,
    durationMs: rounded(durationMs),
    completed: finalStatuses.filter((status) => status.status === "completed").length,
    errors,
    pagesProduced: finalStatuses.reduce((total, status) => total + (status.result?.pagesCount ?? 0), 0),
    resourcePeaks: resourcePeaks(samples),
  };
}

function resolveTarget(input: { target: URL; paths?: readonly string[] }, index: number): URL {
  return input.paths?.length ? new URL(input.paths[index % input.paths.length]!, apiUrl) : input.target;
}

async function sampleDocker(): Promise<DockerSample> {
  const services: Record<string, { cpuPercent: number; memoryMiB: number }> = {};
  const names = containerServices.map((service) => `${containerPrefix}-${service}-1`);
  const process = Bun.spawn(
    ["docker", "stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}", ...names],
    { stdout: "pipe", stderr: "ignore" },
  );
  const [exitCode, output] = await Promise.all([process.exited, new Response(process.stdout).text()]);
  if (exitCode !== 0) return { at: new Date().toISOString(), services };
  for (const line of output.trim().split("\n")) {
    const [name, cpu, memory] = line.split("|");
    const service = containerServices.find((candidate) => name === `${containerPrefix}-${candidate}-1`);
    if (!service || !cpu || !memory) continue;
    services[service] = {
      cpuPercent: Number.parseFloat(cpu.replace("%", "")) || 0,
      memoryMiB: memoryToMiB(memory.split("/")[0]?.trim() ?? "0"),
    };
  }
  return { at: new Date().toISOString(), services };
}

function resourcePeaks(samples: readonly DockerSample[]) {
  const peaks: Record<string, { cpuPercent: number; memoryMiB: number }> = {};
  for (const sample of samples) {
    for (const [service, value] of Object.entries(sample.services)) {
      const current = peaks[service] ?? { cpuPercent: 0, memoryMiB: 0 };
      peaks[service] = {
        cpuPercent: Math.max(current.cpuPercent, value.cpuPercent),
        memoryMiB: Math.max(current.memoryMiB, value.memoryMiB),
      };
    }
  }
  return peaks;
}

function memoryToMiB(value: string): number {
  const match = value.match(/^([0-9.]+)([KMG]iB)$/i);
  if (!match) return 0;
  const amount = Number.parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();
  if (unit === "kib") return rounded(amount / 1_024);
  if (unit === "gib") return rounded(amount * 1_024);
  return rounded(amount);
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function dockerInfo(): string {
  const result = Bun.spawnSync(["docker", "info", "--format", "CPUs={{.NCPU}} Memory={{.MemTotal}}"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : "unavailable";
}

async function waitFor(url: URL, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) return;
    await Bun.sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
