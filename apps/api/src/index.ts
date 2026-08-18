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
import { createMessagingStrategyHttpHandler } from "@outbound/interface/http/messaging-strategy-handler";
import { createOfferHttpHandler } from "@outbound/interface/http/offer-handler";
import { createImportHttpHandler } from "@outbound/interface/http/import-handler";
import { createMergeHttpHandler } from "@outbound/interface/http/merge-handler";
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
import { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";
import { CrawlerProspectEnricher } from "@outbound/infrastructure/crm/crawler-prospect-enricher";
import { UnipileWebhookIngestor } from "@outbound/infrastructure/campaigns/unipile-webhook-ingestor";
import { createUnipileWebhookHttpHandler } from "@outbound/interface/http/unipile-webhook-handler";
import { PostgresCalendarIntegration } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { createCalendarConnectionHttpHandler } from "@outbound/interface/http/calendar-connection-handler";
import { createCalendarWebhookHttpHandler } from "@outbound/interface/http/calendar-webhook-handler";
import { createCalendarBookingHttpHandler } from "@outbound/interface/http/calendar-booking-handler";
import { PostgresOpportunityRepository } from "@outbound/infrastructure/pipeline/postgres-opportunity-repository";
import { createOpportunityHttpHandler } from "@outbound/interface/http/opportunity-handler";
import { LangChainConversationDraftImprover } from "@outbound/infrastructure/campaigns/langchain-conversation-draft-improver";
import { PostgresUnipileChannelConnections } from "@outbound/infrastructure/channels/postgres-unipile-channel-connections";
import { createChannelConnectionHttpHandler } from "@outbound/interface/http/channel-connection-handler";
import { createEnrichmentHttpHandler } from "@outbound/interface/http/enrichment-handler";
import { PostgresChannelCapabilityReassessment } from "@outbound/infrastructure/campaigns/channel-capability-reassessment";
import { createAnalyticsHttpHandler } from "@outbound/interface/http/analytics-handler";
import { CrawlerSignalSource } from "@outbound/infrastructure/crm/crawler-signal-source";
import { createSignalHttpHandler } from "@outbound/interface/http/signal-handler";
import { createConnectedAccountHttpHandler } from "@outbound/interface/http/connected-account-handler";
import { HttpUnipileClient, UnavailableUnipileClient } from "@outbound/infrastructure/integrations/unipile-client";
import { PostgresWorkspaceRepository } from "@outbound/infrastructure/workspaces/postgres-workspace-repository";
import { PostgresWorkspaceDataLifecycle } from "@outbound/infrastructure/workspaces/postgres-workspace-data-lifecycle";
import { S3WorkspaceArchiveStorage } from "@outbound/infrastructure/workspaces/workspace-data-export";
import { createWorkspaceDataHttpHandler } from "@outbound/interface/http/workspace-data-handler";
import { PostgresKnowledgeService } from "@outbound/infrastructure/knowledge/postgres-knowledge-service";
import { createKnowledgeHttpHandler, isKnowledgeRoute } from "@outbound/interface/http/knowledge-handler";
import { PostgresEvaluationService } from "@outbound/infrastructure/ai/postgres-evaluation-service";
import { createEvaluationHttpHandler, isEvaluationRoute } from "@outbound/interface/http/evaluation-handler";
import { PostgresOperatorConsole } from "@outbound/infrastructure/operations/postgres-operator-console";
import { createOperatorConsoleHttpHandler, isOperatorConsoleRoute } from "@outbound/interface/http/operator-console-handler";
import { PostgresWorkspaceOnboarding } from "@outbound/infrastructure/workspaces/postgres-workspace-onboarding";
import { createWorkspaceOnboardingHttpHandler, isWorkspaceOnboardingRoute } from "@outbound/interface/http/workspace-onboarding-handler";
import { createOperationalViewHttpHandler } from "@outbound/interface/http/operational-view-handler";

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
  contextResolver: auth.contextResolver,
  management: new PostgresWorkspaceRepository(database.db),
});
const workspaceDataLifecycle = new PostgresWorkspaceDataLifecycle(database.db, clock, ids);
const workspaceAiSettingsRepository = new PostgresWorkspaceAiSettingsRepository(database.db);
const workspaceArchiveStorage = new S3WorkspaceArchiveStorage(workspaceArchiveOptionsFromEnvironment());
const workspaceData = createWorkspaceDataHttpHandler({
  contextResolver: auth.contextResolver,
  service: workspaceDataLifecycle,
  clock,
  downloads: workspaceArchiveStorage,
});
const knowledge = createKnowledgeHttpHandler({
  contextResolver: auth.contextResolver,
  service: new PostgresKnowledgeService(database.db, clock, ids),
});
const evaluation = createEvaluationHttpHandler({
  contextResolver: auth.contextResolver,
  service: new PostgresEvaluationService(database.db, clock, ids, workspaceAiSettingsRepository),
});
const operatorConsole = createOperatorConsoleHttpHandler({
  contextResolver: auth.contextResolver,
  service: new PostgresOperatorConsole(database.db, clock, ids),
});
const workspaceOnboarding = createWorkspaceOnboardingHttpHandler({
  contextResolver: auth.contextResolver,
  service: new PostgresWorkspaceOnboarding(database.db),
});
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
const connectedAccountClient = unipileDsn && unipileApiKey
  ? new HttpUnipileClient({ dsn: unipileDsn, apiKey: unipileApiKey, timeoutMs: positiveIntegerEnvironment("UNIPILE_TIMEOUT_MS", 10_000) })
  : new UnavailableUnipileClient();
const unipileChannelConnections = unipileDsn && unipileApiKey
  ? new PostgresUnipileChannelConnections(database.db, { dsn: unipileDsn, apiKey: unipileApiKey })
  : null;
const channelConnection = createChannelConnectionHttpHandler({
  connections: unipileChannelConnections,
  contextResolver: auth.contextResolver,
  reassessment: new PostgresChannelCapabilityReassessment(database.db),
});
const discoveryCrawler =
  process.env.CRAWLER_SERVICE_URL && process.env.CRAWLER_API_KEY
    ? new CrawlerClient({
        baseUrl: process.env.CRAWLER_SERVICE_URL,
        apiKey: process.env.CRAWLER_API_KEY,
        maxConcurrentPageReads: 2,
      })
    : null;
const discovery = createDiscoveryHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
  jobQueue: queue,
  prospectSource: (workspaceId) => {
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
      ...(process.env.UNIPILE_WHATSAPP_ACCOUNT_ID
        ? { whatsappAccountId: process.env.UNIPILE_WHATSAPP_ACCOUNT_ID }
        : {}),
      ...(unipileChannelConnections
        ? { resolveWhatsappAccountId: () => unipileChannelConnections.selectedAccountId(workspaceId, "whatsapp") }
        : {}),
    });
  },
  prospectEnricher: () =>
    discoveryCrawler ? new CrawlerProspectEnricher(discoveryCrawler) : null,
});
const enrichment = createEnrichmentHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
  jobQueue: queue,
  prospectEnricher: () => discoveryCrawler ? new CrawlerProspectEnricher(discoveryCrawler) : null,
});
const signals = createSignalHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
  signalSource: () => discoveryCrawler ? new CrawlerSignalSource(discoveryCrawler) : null,
  jobQueue: queue,
});
const analytics = createAnalyticsHttpHandler({ database: database.db, contextResolver: auth.contextResolver });
const sequenceHandler = createSequenceHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
});
const campaignHandler = createCampaignHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
  jobQueue: queue,
  draftImprover: new LangChainConversationDraftImprover(
    database.db,
    process.env,
    workspaceAiSettingsRepository,
  ),
});
const messagingStrategyHandler = createMessagingStrategyHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
});
const offers = createOfferHttpHandler({ database: database.db, contextResolver: auth.contextResolver });
const imports = createImportHttpHandler({ database: database.db, contextResolver: auth.contextResolver, queue });
const merges = createMergeHttpHandler({ database: database.db, contextResolver: auth.contextResolver });
const unipileWebhook = createUnipileWebhookHttpHandler({
  ingestor: new UnipileWebhookIngestor(database.db),
  secret: process.env.UNIPILE_WEBHOOK_SECRET ?? "",
});
const connectedAccounts = createConnectedAccountHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
  client: connectedAccountClient,
  webhookSecret: process.env.UNIPILE_WEBHOOK_SECRET ?? "",
  publicAppBaseUrl: requiredEnvironment("BETTER_AUTH_URL"),
});
const calendarSigningKey = process.env.CALENDAR_WEBHOOK_SIGNING_KEY
  ?? requiredSecretEnvironment("BETTER_AUTH_SECRET");
const calendarIntegration = new PostgresCalendarIntegration(database.db, calendarSigningKey);
const calendarConnection = createCalendarConnectionHttpHandler({
  integration: calendarIntegration,
  contextResolver: auth.contextResolver,
  publicWebhookBaseUrl: process.env.PUBLIC_WEBHOOK_BASE_URL ?? requiredEnvironment("BETTER_AUTH_URL"),
});
const calendarWebhook = createCalendarWebhookHttpHandler({
  integration: calendarIntegration,
  signingKey: calendarSigningKey,
});
const calendarBookings = createCalendarBookingHttpHandler({ integration: calendarIntegration, contextResolver: auth.contextResolver });
const opportunityHandler = createOpportunityHttpHandler({
  repository: new PostgresOpportunityRepository(database.db),
  contextResolver: auth.contextResolver,
});
const operationalViews = createOperationalViewHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
});
const port = positiveIntegerEnvironment("PORT", 3000);
const server = Bun.serve({
  port,
  // F-022 CSV uploads are accepted up to 10 MiB; leave headroom for JSON/multipart overhead.
  maxRequestBodySize: 12 * 1024 * 1024,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/auth/")) return auth.handle(request);
    if (pathname === "/api/v1/webhooks/unipile") {
      // Account health webhooks use the dedicated signature header. Keep the
      // existing message webhook contract (unipile-auth) untouched.
      if (request.headers.has("x-unipile-signature") || request.headers.has("x-webhook-signature")) {
        return connectedAccounts(request);
      }
      return unipileWebhook(request);
    }
    if (pathname.startsWith("/api/v1/webhooks/calendar/")) return calendarWebhook(request);
    if (pathname.startsWith("/api/v1/calendar-bookings") || pathname === "/api/v1/calendar-connection/meeting-types") return calendarBookings(request);
    if (pathname === "/api/v1/calendar-connection") return calendarConnection(request);
    if (pathname.startsWith("/api/v1/channel-connections/")) return channelConnection(request);
    if (pathname.startsWith("/api/v1/connected-accounts") || pathname.startsWith("/api/v1/account-health-alerts")) return connectedAccounts(request);
    if (pathname.startsWith("/api/v1/analytics/")) return analytics(request);
    if (pathname.startsWith("/api/v1/signals") || pathname.startsWith("/api/v1/settings/signals") || pathname.includes("/signals")) return signals(request);
    if (isKnowledgeRoute(pathname)) return knowledge(request);
    if (isEvaluationRoute(pathname)) return evaluation(request);
    if (isOperatorConsoleRoute(pathname)) return operatorConsole(request);
    if (isWorkspaceOnboardingRoute(pathname)) return workspaceOnboarding(request);
    if (isWorkspaceDataRoute(pathname, request.method)) return workspaceData(request);
    if (pathname === "/api/v1/workspace/operational-summary" || pathname === "/api/v1/workspace/setup-readiness" || pathname === "/api/v1/conversations" || pathname === "/api/v1/pipeline/view" || /^\/api\/v1\/campaigns\/[^/]+\/workspace-view$/.test(pathname)) return operationalViews(request);
    if (pathname.startsWith("/api/v1/opportunities") || pathname === "/api/v1/pipeline/forecast" || pathname.startsWith("/api/v1/workspaces/") && pathname.endsWith("/lost-reasons")) return opportunityHandler(request);
    if (pathname.includes("/actions/enrich") || pathname.startsWith("/api/v1/enrichment-jobs/") || pathname.endsWith("/enrichment")) return enrichment(request);
    if (pathname === "/api/v1/workspaces" || pathname.startsWith("/api/v1/workspaces/") || pathname.startsWith("/api/v1/invitations/")) return workspace(request);
    if (pathname === "/api/v1/workspace-ai-settings") return workspaceAiSettings(request);
    if (pathname.startsWith("/api/v1/messaging-strategies") || pathname.startsWith("/api/v1/ai-policies")) {
      return messagingStrategyHandler(request);
    }
    if (pathname.startsWith("/api/v1/research-documents")) return documents(request);
    if (pathname.startsWith("/api/v1/merge-candidates") || (pathname.startsWith("/api/v1/contacts/") && (pathname.includes("/actions/undo-merge") || pathname.endsWith("/merges")))) return merges(request);
    if (pathname.startsWith("/api/v1/companies") || pathname.startsWith("/api/v1/contacts") || pathname.startsWith("/api/v1/prospects") || pathname.startsWith("/api/v1/suppressions")) return crm(request);
    if (pathname.startsWith("/api/v1/icp-versions") || pathname.startsWith("/api/v1/icps") || pathname.startsWith("/api/v1/discovery-runs")) {
      return discovery(request);
    }
    if (pathname.startsWith("/api/v1/offers")) return offers(request);
    if (pathname.startsWith("/api/v1/imports")) return imports(request);
    if (pathname.startsWith("/api/v1/sequences")) {
      return sequenceHandler(request);
    }
    if (
      pathname.startsWith("/api/v1/campaigns") ||
      pathname.startsWith("/api/v1/prospecting-plans") ||
      pathname.startsWith("/api/v1/channel-assessments")
      || pathname.startsWith("/api/v1/conversations")
    ) {
      return campaignHandler(request);
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
  const extractor = process.env.DOCUMENT_EXTRACTOR === "docling" ? "docling" : "lightweight";
  if (extractor === "docling" && !process.env.DOCLING_SERVICE_URL) throw new Error("DOCLING_SERVICE_URL is required when DOCUMENT_EXTRACTOR=docling");
  return {
    bucket: requiredEnvironment("S3_BUCKET"),
    endpoint: requiredEnvironment("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
    documentExtractor: extractor as "lightweight" | "docling",
    ...(process.env.DOCLING_SERVICE_URL ? { doclingUrl: process.env.DOCLING_SERVICE_URL } : {}),
    ...(process.env.DOCLING_API_KEY ? { doclingApiKey: process.env.DOCLING_API_KEY } : {}),
  };
}

function workspaceArchiveOptionsFromEnvironment() {
  return {
    bucket: requiredEnvironment("S3_BUCKET"),
    endpoint: requiredEnvironment("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
  };
}

function isWorkspaceDataRoute(pathname: string, method: string): boolean {
  if (pathname === "/api/v1/audit-logs" || pathname.startsWith("/api/v1/exports/")) return true;
  if (/^\/api\/v1\/contacts\/[^/]+\/actions\/anonymize$/.test(pathname)) return true;
  if (/^\/api\/v1\/workspaces\/[^/]+\/(sending-preferences|channel-limits|retention-policy|actions\/export)$/.test(pathname)) return true;
  return method === "PATCH" && /^\/api\/v1\/workspaces\/[^/]+$/.test(pathname);
}
