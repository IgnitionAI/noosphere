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
import { UnipileProspectSource } from "@outbound/infrastructure/crm/unipile-prospect-source";
import { V3SourcingValidator } from "@outbound/infrastructure/ai/v3-sourcing-validator";
import { PostgresResearchToolRequestRegistry } from "@outbound/infrastructure/ai/postgres-research-tool-request-registry";
import { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";
import { CrawlerProspectEnricher } from "@outbound/infrastructure/crm/crawler-prospect-enricher";
import { CrawlerCompanyProspectSource } from "@outbound/infrastructure/crm/crawler-company-prospect-source";
import { PostgresDailySourcingBudget } from "@outbound/infrastructure/crm/postgres-daily-sourcing-budget";
import { PostgresWhatsappReachabilityResolver } from "@outbound/infrastructure/crm/postgres-whatsapp-reachability-resolver";
import { SourcingRetentionReconciler } from "@outbound/infrastructure/crm/sourcing-retention-reconciler";
import {
  ProspectDiscoveryJobProcessor,
  ProspectDiscoveryRunner,
} from "@outbound/infrastructure/crm/prospect-discovery-runner";
import {
  ProviderUnavailableError,
  type ProspectSource,
} from "@outbound/infrastructure/crm/unipile-prospect-source";
import { ChannelAssessmentJobProcessor } from "@outbound/infrastructure/campaigns/channel-assessment-runner";
import { LangChainChannelStrategyPlanner } from "@outbound/infrastructure/campaigns/channel-strategy-planner";
import { RoutedChannelObservationSource } from "@outbound/infrastructure/campaigns/channel-observation-source";
import { CampaignAutomationJobProcessor } from "@outbound/infrastructure/campaigns/campaign-automation-runner";
import { CampaignCompositionJobProcessor } from "@outbound/infrastructure/campaigns/campaign-composition-runner";
import { LangChainCampaignContentGenerator } from "@outbound/infrastructure/campaigns/langchain-campaign-content-generator";
import { UnipileCampaignChannelReadiness } from "@outbound/infrastructure/campaigns/unipile-channel-readiness";
import { OutreachDispatchJobProcessor } from "@outbound/infrastructure/campaigns/outreach-dispatch-runner";
import { UnipileOutboundChannelGateway } from "@outbound/infrastructure/campaigns/unipile-outbound-channel-gateway";
import { OutboundDeliveryError, type OutboundChannelGateway } from "@outbound/application/campaigns/outbound-channel-gateway";
import { InboundReplyJobProcessor } from "@outbound/infrastructure/campaigns/inbound-reply-runner";
import { AutomatedReplySendJobProcessor } from "@outbound/infrastructure/campaigns/automated-reply-send-runner";
import { LangChainInboundReplyAgent } from "@outbound/infrastructure/campaigns/langchain-inbound-reply-agent";
import { CampaignSourcingReconciler } from "@outbound/infrastructure/campaigns/campaign-sourcing-reconciler";
import { DailyProspectingScheduler } from "@outbound/infrastructure/campaigns/daily-prospecting-scheduler";
import { ConversationCommandJobProcessor } from "@outbound/infrastructure/campaigns/conversation-command-runner";
import { ProspectAssessmentReconciler } from "@outbound/infrastructure/campaigns/prospect-assessment-reconciler";
import { CampaignHealthReconciler } from "@outbound/infrastructure/campaigns/campaign-health-reconciler";
import { UnipileWebhookIngestor } from "@outbound/infrastructure/campaigns/unipile-webhook-ingestor";
import { UnipileChatSynchronizer } from "@outbound/infrastructure/campaigns/unipile-chat-synchronizer";
import { PostgresCalendarIntegration } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { PostgresUnipileChannelConnections } from "@outbound/infrastructure/channels/postgres-unipile-channel-connections";
import { PostgresImportService } from "@outbound/infrastructure/crm/postgres-import-service";
import { EnrichmentJobProcessor, PostgresEnrichmentRepository } from "@outbound/infrastructure/crm/postgres-enrichment-repository";
import { CrawlerSignalSource } from "@outbound/infrastructure/crm/crawler-signal-source";
import { PostgresSignalRepository, SignalCollectionJobProcessor } from "@outbound/infrastructure/crm/postgres-signal-repository";
import { PostgresOutboxDispatcher } from "@outbound/infrastructure/outbox/postgres-outbox-dispatcher";
import { HttpUnipileClient, UnavailableUnipileClient } from "@outbound/infrastructure/integrations/unipile-client";
import { PostgresOutreachScheduler } from "@outbound/infrastructure/scheduler/postgres-outreach-scheduler";
import {
  PostgresWorkspaceExportSnapshot,
  S3WorkspaceArchiveStorage,
  WorkspaceDataExportProcessor,
  WorkspaceRetentionPurgeProcessor,
} from "@outbound/infrastructure/workspaces/workspace-data-export";
import { PostgresWorkspaceDataLifecycle } from "@outbound/infrastructure/workspaces/postgres-workspace-data-lifecycle";

const databaseUrl = requiredEnvironment("DATABASE_URL");
const database = createDatabase(databaseUrl);
const unipileChannelConnections = process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY
  ? new PostgresUnipileChannelConnections(database.db, {
      dsn: process.env.UNIPILE_DSN,
      apiKey: process.env.UNIPILE_API_KEY,
    })
  : null;
const queue = new PostgresJobQueue(database.client);
const importService = new PostgresImportService(database.db, queue);
const enrichmentRepository = new PostgresEnrichmentRepository(database.db, new SystemClock());
const signalRepository = new PostgresSignalRepository(database.db, new SystemClock());
const outboxDispatcher = new PostgresOutboxDispatcher(database.client);
const unipileDsn = process.env.UNIPILE_DSN ?? "";
const unipileApiKey = process.env.UNIPILE_API_KEY ?? "";
const unipileClient = unipileDsn && unipileApiKey ? new HttpUnipileClient({ dsn: unipileDsn, apiKey: unipileApiKey, timeoutMs: positiveIntegerEnvironment("UNIPILE_TIMEOUT_MS", 10_000) }) : new UnavailableUnipileClient();
const outreachScheduler = new PostgresOutreachScheduler(database.db, unipileClient);
const repository = new PostgresProductResearchRepository(database.db);
const clock = new SystemClock();
const ids = new CryptoIdGenerator();
const workspaceDataLifecycle = new PostgresWorkspaceDataLifecycle(database.db, clock, ids);
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
const workspaceArchiveStorage = new S3WorkspaceArchiveStorage({
  bucket: documentOptions.bucket,
  endpoint: documentOptions.endpoint,
  region: documentOptions.region,
  accessKeyId: documentOptions.accessKeyId,
  secretAccessKey: documentOptions.secretAccessKey,
});
const workspaceExportProcessor = new WorkspaceDataExportProcessor(
  database.db,
  queue,
  new PostgresWorkspaceExportSnapshot(database.client),
  workspaceArchiveStorage,
  clock,
);
const retentionPurgeProcessor = new WorkspaceRetentionPurgeProcessor(database.db, queue, clock);
const toolRunRecorder = new PostgresResearchToolRunRecorder(database.db);
const workspaceAiSettings = new PostgresWorkspaceAiSettingsRepository(database.db);
const sourcingValidator = new V3SourcingValidator(
  process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY
    ? new UnipileProspectSource({
        dsn: process.env.UNIPILE_DSN,
        apiKey: process.env.UNIPILE_API_KEY,
        ...(process.env.UNIPILE_LINKEDIN_ACCOUNT_ID
          ? { accountId: process.env.UNIPILE_LINKEDIN_ACCOUNT_ID }
          : {}),
      })
    : null,
);
const toolRequestRegistry = new PostgresResearchToolRequestRegistry(database.db);
const discoveryCrawler = new CrawlerClient({
  baseUrl: requiredEnvironment("CRAWLER_SERVICE_URL"),
  apiKey: requiredEnvironment("CRAWLER_API_KEY"),
  maxConcurrentPageReads: 2,
});
const dailySourcingBudget = new PostgresDailySourcingBudget(database.db);
const createReachabilityResolver = (workspaceId: string) => new PostgresWhatsappReachabilityResolver(
  database.db,
  createProspectSource(workspaceId),
  dailySourcingBudget,
);
const discoveryRunner = new ProspectDiscoveryRunner(
  database.db,
  createProspectSource,
  () => new CrawlerProspectEnricher(discoveryCrawler),
  (workspaceId) => {
    const source = createProspectSource(workspaceId);
    return new CrawlerCompanyProspectSource(
      discoveryCrawler,
      () => source,
      {
        budget: dailySourcingBudget,
        reachability: new PostgresWhatsappReachabilityResolver(database.db, source, dailySourcingBudget),
      },
    );
  },
);
const enrichmentProcessor = new EnrichmentJobProcessor(
  enrichmentRepository,
  new CrawlerProspectEnricher(discoveryCrawler),
  queue,
);
const signalProcessor = new SignalCollectionJobProcessor(
  signalRepository,
  new CrawlerSignalSource(discoveryCrawler),
  queue,
);
const discoveryProcessor = new ProspectDiscoveryJobProcessor(
  database.db,
  queue,
  discoveryRunner,
  clock,
);
const channelAssessmentProcessor = new ChannelAssessmentJobProcessor(
  database.db,
  queue,
  new LangChainChannelStrategyPlanner(process.env),
  new RoutedChannelObservationSource(discoveryCrawler, createProspectSource),
  clock,
);
const campaignAutomationProcessor = new CampaignAutomationJobProcessor(database.db, queue, clock);
const campaignContentGenerator = new LangChainCampaignContentGenerator(process.env, workspaceAiSettings);
const calendarIntegration = new PostgresCalendarIntegration(
  database.db,
  process.env.CALENDAR_WEBHOOK_SIGNING_KEY ?? requiredEnvironment("BETTER_AUTH_SECRET"),
);
const campaignCompositionProcessor = new CampaignCompositionJobProcessor(
  database.db,
  queue,
  campaignContentGenerator,
  new UnipileCampaignChannelReadiness(createProspectSource),
  clock,
);
const outreachDispatchProcessor = new OutreachDispatchJobProcessor(
  database.db,
  queue,
  createOutboundGateway(),
  clock,
  {
    linkedin: positiveIntegerEnvironment("OUTBOUND_LINKEDIN_DAILY_LIMIT", 20),
    email: positiveIntegerEnvironment("OUTBOUND_EMAIL_DAILY_LIMIT", 50),
    whatsapp: positiveIntegerEnvironment("OUTBOUND_WHATSAPP_DAILY_LIMIT", 30),
  },
  campaignContentGenerator,
  createReachabilityResolver,
  workspaceDataLifecycle,
);
const inboundReplyAgent = new LangChainInboundReplyAgent(process.env, workspaceAiSettings);
const inboundReplyProcessor = new InboundReplyJobProcessor(
  database.db,
  queue,
  inboundReplyAgent,
  clock,
  process.env.BOOKING_URL?.trim() || null,
  calendarIntegration,
);
const automatedReplySendProcessor = new AutomatedReplySendJobProcessor(
  database.db,
  queue,
  createOutboundGateway(),
  clock,
);
const conversationCommandProcessor = new ConversationCommandJobProcessor(
  database.db,
  queue,
  createOutboundGateway(),
  inboundReplyAgent,
  clock,
  process.env.BOOKING_URL?.trim() || null,
  calendarIntegration,
);
const dailyProspectingScheduler = new DailyProspectingScheduler(database.db, clock, {
  localTime: process.env.DAILY_PROSPECTING_TIME ?? "06:00",
  timezone: process.env.DAILY_PROSPECTING_TIMEZONE ?? "Europe/Paris",
});
const prospectAssessmentReconciler = new ProspectAssessmentReconciler(database.db, clock);
const campaignHealthReconciler = new CampaignHealthReconciler(database.db, clock);
const sourcingRetentionReconciler = new SourcingRetentionReconciler(database.db, clock);
const unipileChatSynchronizer = process.env.UNIPILE_DSN
  && process.env.UNIPILE_API_KEY
  && process.env.UNIPILE_CHAT_SYNC_ENABLED !== "false"
  ? new UnipileChatSynchronizer(
      database.db,
      new UnipileWebhookIngestor(database.db),
      { dsn: process.env.UNIPILE_DSN, apiKey: process.env.UNIPILE_API_KEY },
    )
  : null;
const maintenance = {
  async reconcile() {
    const [dailyRuns, assessmentJobs, repairedCampaigns, retainedSourcing, inboundEvents] = await Promise.all([
      dailyProspectingScheduler.reconcile(),
      prospectAssessmentReconciler.reconcile(),
      campaignHealthReconciler.reconcile(),
      sourcingRetentionReconciler.reconcile(),
      unipileChatSynchronizer?.reconcile() ?? Promise.resolve(0),
    ]);
    if (inboundEvents > 0) {
      console.info(JSON.stringify({ event: "unipile_chat_sync_ingested", count: inboundEvents }));
    }
    return dailyRuns + assessmentJobs + repairedCampaigns + retainedSourcing + inboundEvents;
  },
};
const orchestrator = new ResearchOrchestrator(
  repository,
  queue,
  createLangChainResearchAgentExecutorFromEnvironment(
    documentSearch,
    toolRunRecorder,
    workspaceAiSettings,
    sourcingValidator,
    toolRequestRegistry,
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
}, documentService, discoveryProcessor, channelAssessmentProcessor, campaignAutomationProcessor, campaignCompositionProcessor, outreachDispatchProcessor, inboundReplyProcessor, automatedReplySendProcessor, conversationCommandProcessor, maintenance, outboxDispatcher, importService, outreachScheduler, enrichmentProcessor, signalProcessor, workspaceExportProcessor, retentionPurgeProcessor);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.info(JSON.stringify({ event: "research_worker_stopping", signal }));
    worker.stop();
  });
}

console.info(JSON.stringify({ event: "research_worker_started" }));
try {
  const repairedCampaigns = await new CampaignSourcingReconciler(database.db, clock).reconcile();
  if (repairedCampaigns > 0) {
    console.info(JSON.stringify({ event: "campaign_sourcing_reconciled", count: repairedCampaigns }));
  }
  const repairedCampaignHealth = await campaignHealthReconciler.reconcile();
  if (repairedCampaignHealth > 0) {
    console.info(JSON.stringify({ event: "campaign_health_reconciled", count: repairedCampaignHealth }));
  }
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

function createProspectSource(workspaceId?: string): ProspectSource {
  if (!process.env.UNIPILE_DSN || !process.env.UNIPILE_API_KEY) {
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
    dsn: process.env.UNIPILE_DSN,
    apiKey: process.env.UNIPILE_API_KEY,
    ...(process.env.UNIPILE_LINKEDIN_ACCOUNT_ID
      ? { accountId: process.env.UNIPILE_LINKEDIN_ACCOUNT_ID }
      : {}),
    ...(process.env.UNIPILE_WHATSAPP_ACCOUNT_ID
      ? { whatsappAccountId: process.env.UNIPILE_WHATSAPP_ACCOUNT_ID }
      : {}),
    ...(workspaceId && unipileChannelConnections
      ? { resolveWhatsappAccountId: () => unipileChannelConnections.selectedAccountId(workspaceId, "whatsapp") }
      : {}),
  });
}

function createOutboundGateway(): OutboundChannelGateway {
  if (!process.env.UNIPILE_DSN || !process.env.UNIPILE_API_KEY) {
    return {
      async send() {
        throw new OutboundDeliveryError(
          "UNIPILE_NOT_CONFIGURED",
          "Unipile is not configured (UNIPILE_DSN, UNIPILE_API_KEY)",
          "not_sent",
          false,
        );
      },
    };
  }
  return new UnipileOutboundChannelGateway({
    dsn: process.env.UNIPILE_DSN,
    apiKey: process.env.UNIPILE_API_KEY,
  });
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
