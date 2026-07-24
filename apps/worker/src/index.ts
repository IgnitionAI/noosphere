import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResearchAgentExecutor } from "@outbound/application/gtm/product-research-ports";
import { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import {
  CryptoIdGenerator,
  SystemClock,
} from "@outbound/application/shared/ports";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { ResearchWorker } from "./research-worker";

const databaseUrl = requiredEnvironment("DATABASE_URL");
const adapterModulePath = requiredEnvironment("RESEARCH_AGENT_ADAPTER_MODULE");
const adapterModule = (await import(adapterModuleSpecifier(adapterModulePath))) as {
  createResearchAgentExecutor?: () => ResearchAgentExecutor | Promise<ResearchAgentExecutor>;
};
if (typeof adapterModule.createResearchAgentExecutor !== "function") {
  throw new Error("RESEARCH_AGENT_ADAPTER_MODULE must export createResearchAgentExecutor()");
}

const database = createDatabase(databaseUrl);
const queue = new PostgresJobQueue(database.client);
const repository = new PostgresProductResearchRepository(database.db);
const clock = new SystemClock();
const orchestrator = new ResearchOrchestrator(
  repository,
  queue,
  await adapterModule.createResearchAgentExecutor(),
  new CryptoIdGenerator(),
  clock,
  new Sha256ContentHasher(),
);
const worker = new ResearchWorker(queue, orchestrator, clock, {
  workerId: process.env.WORKER_ID ?? `research-${crypto.randomUUID()}`,
  leaseMs: positiveIntegerEnvironment("JOB_LEASE_MS", 60_000),
  batchSize: positiveIntegerEnvironment("JOB_BATCH_SIZE", 4),
  pollIntervalMs: positiveIntegerEnvironment("JOB_POLL_INTERVAL_MS", 1_000),
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.info(JSON.stringify({ event: "research_worker_stopping", signal }));
    worker.stop();
  });
}

console.info(JSON.stringify({ event: "research_worker_started" }));
try {
  if (process.env.WORKER_ONCE === "1") await worker.tick();
  else await worker.run();
} finally {
  await database.close();
  console.info(JSON.stringify({ event: "research_worker_stopped" }));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function adapterModuleSpecifier(value: string): string {
  return value.startsWith(".") || value.startsWith("/")
    ? pathToFileURL(resolve(value)).href
    : value;
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
