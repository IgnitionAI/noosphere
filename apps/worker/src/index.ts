import { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import {
  CryptoIdGenerator,
  SystemClock,
} from "@outbound/application/shared/ports";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { createLangChainResearchAgentExecutorFromEnvironment } from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import { ResearchWorker } from "./research-worker";
import {
  ParadeDbInternalDocumentSearch,
  ResearchDocumentService,
} from "@outbound/infrastructure/documents/research-document-service";
import { PostgresResearchToolRunRecorder } from "@outbound/infrastructure/ai/postgres-tool-run-recorder";
import { PostgresWorkspaceAiSettingsRepository } from "@outbound/infrastructure/workspaces/postgres-workspace-ai-settings-repository";
import { PostgresOutboxDispatcher } from "@outbound/infrastructure/outbox/postgres-outbox-dispatcher";
import { PostgresImportService } from "@outbound/infrastructure/crm/postgres-import-service";

const databaseUrl = requiredEnvironment("DATABASE_URL");
const database = createDatabase(databaseUrl);
const queue = new PostgresJobQueue(database.client);
const importService = new PostgresImportService(database.db, queue);
const outboxDispatcher = new PostgresOutboxDispatcher(database.client);
const repository = new PostgresProductResearchRepository(database.db);
const clock = new SystemClock();
const ids = new CryptoIdGenerator();
const documentOptions = documentServiceOptionsFromEnvironment();
const documentService = new ResearchDocumentService(
  database.db,
  queue,
  ids,
  clock,
  documentOptions,
);
const documentSearch = new ParadeDbInternalDocumentSearch(
  database.client,
  documentOptions.openAIApiKey,
  documentOptions.embeddingModel,
);
const toolRunRecorder = new PostgresResearchToolRunRecorder(database.db);
const workspaceAiSettings = new PostgresWorkspaceAiSettingsRepository(database.db);
const orchestrator = new ResearchOrchestrator(
  repository,
  queue,
  createLangChainResearchAgentExecutorFromEnvironment(
    documentSearch,
    toolRunRecorder,
    workspaceAiSettings,
  ),
  ids,
  clock,
  new Sha256ContentHasher(),
);
const worker = new ResearchWorker(queue, orchestrator, clock, {
  workerId: process.env.WORKER_ID ?? `research-${crypto.randomUUID()}`,
  leaseMs: positiveIntegerEnvironment("JOB_LEASE_MS", 60_000),
  batchSize: positiveIntegerEnvironment("JOB_BATCH_SIZE", 4),
  pollIntervalMs: positiveIntegerEnvironment("JOB_POLL_INTERVAL_MS", 1_000),
}, documentService, outboxDispatcher, importService);

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

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function documentServiceOptionsFromEnvironment() {
  return {
    bucket: requiredEnvironment("S3_BUCKET"),
    endpoint: requiredEnvironment("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
    doclingUrl: requiredEnvironment("DOCLING_SERVICE_URL"),
    ...(process.env.DOCLING_API_KEY ? { doclingApiKey: process.env.DOCLING_API_KEY } : {}),
    openAIApiKey: requiredEnvironment("OPENAI_API_KEY"),
    embeddingModel: requiredEnvironment("OPENAI_EMBEDDING_MODEL"),
  };
}
