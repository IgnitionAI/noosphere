import { ProductResearchApplication } from "@outbound/application/gtm/product-research-application";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import { createBetterAuthRuntime } from "@outbound/infrastructure/auth/better-auth-runtime";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { createProductResearchHttpHandler } from "@outbound/interface/http/product-research-handler";
import { createWorkspaceHttpHandler } from "@outbound/interface/http/workspace-handler";
import { createResearchDocumentHttpHandler } from "@outbound/interface/http/research-document-handler";
import { createCrmHttpHandler } from "@outbound/interface/http/crm-handler";
import { createDiscoveryHttpHandler } from "@outbound/interface/http/discovery-handler";
import { createSequenceHttpHandler } from "@outbound/interface/http/sequence-handler";
import { createCampaignHttpHandler } from "@outbound/interface/http/campaign-handler";
import { createOfferHttpHandler } from "@outbound/interface/http/offer-handler";
import { createImportHttpHandler } from "@outbound/interface/http/import-handler";
import { createMergeHttpHandler } from "@outbound/interface/http/merge-handler";
import { createMessagingStrategyHttpHandler } from "@outbound/interface/http/messaging-strategy-handler";
import {
  ProviderUnavailableError,
  UnipileProspectSource,
} from "@outbound/infrastructure/crm/unipile-prospect-source";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { ResearchDocumentService } from "@outbound/infrastructure/documents/research-document-service";
import { WorkspaceAiSettingsApplication } from "@outbound/application/workspaces/workspace-ai-settings";
import { PostgresWorkspaceAiSettingsRepository } from "@outbound/infrastructure/workspaces/postgres-workspace-ai-settings-repository";
import { createWorkspaceAiSettingsHttpHandler } from "@outbound/interface/http/workspace-ai-settings-handler";
import { resolveResearchModelPolicyFromEnvironment } from "@outbound/infrastructure/ai/langchain-research-agent-executor";

const databaseUrl = requiredEnvironment("DATABASE_URL");
const database = createDatabase(databaseUrl);
const auth = createBetterAuthRuntime(database.db, {
  baseUrl: requiredEnvironment("BETTER_AUTH_URL"),
  secret: requiredSecretEnvironment("BETTER_AUTH_SECRET"),
  trustedOrigins: commaSeparatedEnvironment(
    "BETTER_AUTH_TRUSTED_ORIGINS",
    requiredEnvironment("BETTER_AUTH_URL"),
  ),
  allowSignUp: process.env.BETTER_AUTH_ALLOW_SIGN_UP === "true",
});
const repository = new PostgresProductResearchRepository(database.db);
const queue = new PostgresJobQueue(database.client);
const clock = new SystemClock();
const ids = new CryptoIdGenerator();
const documentService = new ResearchDocumentService(
  database.db,
  queue,
  ids,
  clock,
  documentServiceOptionsFromEnvironment(),
);
const application = new ProductResearchApplication(
  repository,
  repository,
  ids,
  clock,
);
const productResearch = createProductResearchHttpHandler({
  application,
  contextResolver: auth.contextResolver,
});
const workspace = createWorkspaceHttpHandler({
  sessions: auth.sessions,
  memberships: auth.memberships,
});
const workspaceAiSettingsRepository = new PostgresWorkspaceAiSettingsRepository(database.db);
const workspaceAiSettings = createWorkspaceAiSettingsHttpHandler({
  application: new WorkspaceAiSettingsApplication(
    workspaceAiSettingsRepository,
    resolveResearchModelPolicyFromEnvironment(process.env),
  ),
  contextResolver: auth.contextResolver,
});
const documents = createResearchDocumentHttpHandler({
  service: documentService,
  contextResolver: auth.contextResolver,
});
const crm = createCrmHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
});
const unipileDsn = process.env.UNIPILE_DSN ?? "";
const unipileApiKey = process.env.UNIPILE_API_KEY ?? "";
const discovery = createDiscoveryHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
  prospectSource: () => {
    if (!unipileDsn || !unipileApiKey) {
      return {
        async searchPeople() {
          throw new ProviderUnavailableError(
            "Unipile is not configured (UNIPILE_DSN, UNIPILE_API_KEY)",
            null,
          );
        },
      };
    }
    return new UnipileProspectSource({
      dsn: unipileDsn,
      apiKey: unipileApiKey,
      timeoutMs: positiveIntegerEnvironment("UNIPILE_TIMEOUT_MS", 10_000),
      ...(process.env.UNIPILE_LINKEDIN_ACCOUNT_ID
        ? { accountId: process.env.UNIPILE_LINKEDIN_ACCOUNT_ID }
        : {}),
    });
  },
});
const sequenceHandler = createSequenceHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
});
const campaignHandler = createCampaignHttpHandler({ database: database.db, contextResolver: auth.contextResolver });
const offers = createOfferHttpHandler({ database: database.db, contextResolver: auth.contextResolver });
const imports = createImportHttpHandler({ database: database.db, contextResolver: auth.contextResolver, queue });
const merges = createMergeHttpHandler({ database: database.db, contextResolver: auth.contextResolver });
const messagingStrategies = createMessagingStrategyHttpHandler({ database: database.db, contextResolver: auth.contextResolver });
const port = positiveIntegerEnvironment("PORT", 3000);
const server = Bun.serve({
  port,
  // F-022 CSV uploads are accepted up to 10 MiB; leave headroom for JSON/multipart overhead.
  maxRequestBodySize: 12 * 1024 * 1024,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/auth/")) return auth.handle(request);
    if (pathname === "/api/v1/workspaces") return workspace(request);
    if (pathname === "/api/v1/workspace-ai-settings") return workspaceAiSettings(request);
    if (pathname.startsWith("/api/v1/research-documents")) return documents(request);
    if (pathname.startsWith("/api/v1/companies") || pathname.startsWith("/api/v1/contacts") || pathname.startsWith("/api/v1/suppressions")) {
      return crm(request);
    }
    if (pathname.startsWith("/api/v1/icp-versions") || pathname.startsWith("/api/v1/icps") || pathname.startsWith("/api/v1/discovery-runs")) {
      return discovery(request);
    }
    if (pathname.startsWith("/api/v1/offers")) return offers(request);
    if (pathname.startsWith("/api/v1/imports")) return imports(request);
    if (pathname.startsWith("/api/v1/merge-candidates") || (pathname.startsWith("/api/v1/contacts/") && (pathname.includes("/actions/undo-merge") || pathname.endsWith("/merges")))) return merges(request);
    if (pathname.startsWith("/api/v1/sequences")) {
      return sequenceHandler(request);
    }
    if (pathname.startsWith("/api/v1/campaigns")) {
      return campaignHandler(request);
    }
    if (pathname.startsWith("/api/v1/messaging-strategies") || pathname.startsWith("/api/v1/ai-policies")) {
      return messagingStrategies(request);
    }
    if (pathname === "/health/live") return Response.json({ status: "ok" });
    if (pathname === "/health/ready") {
      try {
        await database.client`select 1`;
        return Response.json({ status: "ready" });
      } catch {
        return Response.json({ status: "not_ready" }, { status: 503 });
      }
    }
    return productResearch(request);
  },
  error() {
    return Response.json(
      {
        type: "https://ignition-outbound.local/problems/internal_error",
        title: "INTERNAL_ERROR",
        status: 500,
        detail: "An unexpected error occurred",
        code: "INTERNAL_ERROR",
      },
      {
        status: 500,
        headers: { "content-type": "application/problem+json; charset=utf-8" },
      },
    );
  },
});

console.info(JSON.stringify({ event: "api_started", port: server.port }));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    console.info(JSON.stringify({ event: "api_stopping", signal }));
    server.stop();
    await database.close();
    console.info(JSON.stringify({ event: "api_stopped" }));
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredSecretEnvironment(name: string): string {
  const value = requiredEnvironment(name);
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
}

function commaSeparatedEnvironment(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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
  };
}
