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
import { UnipileAccountInboxSynchronizer } from "@outbound/infrastructure/inbox/unipile-account-inbox-synchronizer";
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
import { PostgresKnowledgeService } from "@outbound/infrastructure/knowledge/postgres-knowledge-service";
import { KnowledgeSourceExpirationProcessor } from "@outbound/infrastructure/knowledge/knowledge-source-expiration";
import { PostgresKnowledgeRetriever } from "@outbound/infrastructure/knowledge/postgres-knowledge-retriever";
import { EvaluationRunProcessor } from "@outbound/infrastructure/ai/evaluation-run-processor";
import { LangChainEvaluationExecutor } from "@outbound/infrastructure/ai/langchain-evaluation-executor";
import { PostgresActiveAiConfigurationReader } from "@outbound/infrastructure/ai/postgres-active-ai-configuration-reader";
import { PostgresAiRunRecorder } from "@outbound/infrastructure/ai/postgres-ai-run-recorder";
import { ProspectDecisionJobProcessor } from "@outbound/infrastructure/campaigns/prospect-decision-runner";
import { LangChainProspectDecisionAgent } from "@outbound/infrastructure/campaigns/langchain-prospect-decision-agent";
import { ContentIdeaDiscoveryJobProcessor } from "@outbound/application/content/content-ideas";
import { PostgresContentIdeaRepository } from "@outbound/infrastructure/content/postgres-content-idea-repository";
import { CrawlerContentIdeaSource } from "@outbound/infrastructure/content/crawler-content-idea-source";
import { LangChainContentIdeaGenerator } from "@outbound/infrastructure/content/langchain-content-idea-generator";
import { DailyContentIdeaScheduler } from "@outbound/infrastructure/content/daily-content-idea-scheduler";
import { ContentGenerationJobProcessor } from "@outbound/application/content/content-generation";
import { PostgresContentGenerationRepository } from "@outbound/infrastructure/content/postgres-content-generation-repository";
import { LangChainContentPipelineAgent } from "@outbound/infrastructure/content/langchain-content-pipeline-agent";
import { ContentPublicationJobProcessor, type SocialPublishingAccountResolver } from "@outbound/application/content/content-publications";
import { SocialProviderError, type SocialPublisher } from "@outbound/application/content/social-ports";
import { PostgresContentPublicationRepository, PostgresSocialPublishingAccountResolver } from "@outbound/infrastructure/content/postgres-content-publication-repository";
import { UnipileSocialPublisher } from "@outbound/infrastructure/content/unipile-social-publisher";
import { SocialContentSynchronizer } from "@outbound/application/content/social-content-sync";
import { PostgresSocialContentSyncRepository } from "@outbound/infrastructure/content/postgres-social-content-sync-repository";
import { UnipileSocialContentReader } from "@outbound/infrastructure/content/unipile-social-content-reader";

const databaseUrl = requiredEnvironment("DATABASE_URL");
const database = createDatabase(databaseUrl);
const unipileChannelConnections = process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY
  ? new PostgresUnipileChannelConnections(database.db, {
      dsn: process.env.UNIPILE_DSN,
      apiKey: process.env.UNIPILE_API_KEY,
    })
  : null;
const campaignChannelReadiness = unipileChannelConnections
  ? new UnipileCampaignChannelReadiness(unipileChannelConnections)
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
const knowledgeExpirationProcessor = new KnowledgeSourceExpirationProcessor(
  new PostgresKnowledgeService(database.db, clock, ids),
  queue,
  clock,
);
const knowledgeRetriever = new PostgresKnowledgeRetriever(database.db, clock);
const activeAiConfigurations = new PostgresActiveAiConfigurationReader(database.db);
const aiRunRecorder = new PostgresAiRunRecorder(database.db, clock, ids);
const evaluationRunProcessor = new EvaluationRunProcessor(
  database.db,
  queue,
  new LangChainEvaluationExecutor(process.env),
  clock,
  ids,
);
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
const campaignContentGenerator = new LangChainCampaignContentGenerator(process.env, workspaceAiSettings, knowledgeRetriever, activeAiConfigurations, aiRunRecorder);
const calendarIntegration = new PostgresCalendarIntegration(
  database.db,
  process.env.CALENDAR_WEBHOOK_SIGNING_KEY ?? requiredEnvironment("BETTER_AUTH_SECRET"),
);
const campaignCompositionProcessor = new CampaignCompositionJobProcessor(
  database.db,
  queue,
  campaignContentGenerator,
  campaignChannelReadiness ?? unavailableChannelReadiness(),
  clock,
);
const prospectDecisionProcessor = new ProspectDecisionJobProcessor(
  database.db,
  queue,
  new LangChainProspectDecisionAgent(process.env, workspaceAiSettings),
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
  campaignChannelReadiness ?? unavailableChannelReadiness(),
);
const inboundReplyAgent = new LangChainInboundReplyAgent(process.env, workspaceAiSettings, knowledgeRetriever, activeAiConfigurations, aiRunRecorder);
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
const contentIdeaRepository = new PostgresContentIdeaRepository(database.db);
const contentIdeaDiscoveryProcessor = new ContentIdeaDiscoveryJobProcessor(
  contentIdeaRepository,
  new CrawlerContentIdeaSource(discoveryCrawler),
  new LangChainContentIdeaGenerator(process.env, workspaceAiSettings, aiRunRecorder),
  queue,
  () => clock.now(),
);
const dailyContentIdeaScheduler = new DailyContentIdeaScheduler(database.db, contentIdeaRepository, clock, {
  localTime: process.env.DAILY_CONTENT_IDEA_TIME ?? "06:00",
  timezone: process.env.DAILY_CONTENT_IDEA_TIMEZONE ?? "Europe/Paris",
});
const contentGenerationProcessor = new ContentGenerationJobProcessor(
  new PostgresContentGenerationRepository(database.db),
  new LangChainContentPipelineAgent(process.env, workspaceAiSettings, aiRunRecorder),
  queue,
  () => clock.now(),
);
const socialPublisher: SocialPublisher = unipileDsn && unipileApiKey
  ? new UnipileSocialPublisher({ dsn: unipileDsn, apiKey: unipileApiKey, timeoutMs: positiveIntegerEnvironment("UNIPILE_TIMEOUT_MS", 10_000) })
  : unavailableSocialPublisher();
const socialPublishingAccounts: SocialPublishingAccountResolver = unipileChannelConnections
  ? new PostgresSocialPublishingAccountResolver(unipileChannelConnections)
  : unavailableSocialPublishingAccounts();
const contentPublicationProcessor = new ContentPublicationJobProcessor(
  new PostgresContentPublicationRepository(database.db),
  socialPublishingAccounts,
  socialPublisher,
  queue,
  () => clock.now(),
);
const prospectAssessmentReconciler = new ProspectAssessmentReconciler(database.db, clock);
const campaignHealthReconciler = new CampaignHealthReconciler(database.db, clock);
const sourcingRetentionReconciler = new SourcingRetentionReconciler(database.db, clock);
const unipileInboxSynchronizer = process.env.UNIPILE_DSN
  && process.env.UNIPILE_API_KEY
  && process.env.UNIPILE_INBOX_SYNC_ENABLED !== "false"
  && process.env.UNIPILE_CHAT_SYNC_ENABLED !== "false"
  ? new UnipileAccountInboxSynchronizer(
      database.db,
      new UnipileWebhookIngestor(database.db),
      { dsn: process.env.UNIPILE_DSN, apiKey: process.env.UNIPILE_API_KEY },
    )
  : null;
const socialContentReader = unipileDsn && unipileApiKey
  ? new UnipileSocialContentReader({
      dsn: unipileDsn,
      apiKey: unipileApiKey,
      timeoutMs: positiveIntegerEnvironment("UNIPILE_TIMEOUT_MS", 10_000),
    })
  : null;
const socialContentSynchronizer = socialContentReader && process.env.UNIPILE_SOCIAL_CONTENT_SYNC_ENABLED !== "false"
  ? new SocialContentSynchronizer(
      new PostgresSocialContentSyncRepository(database.db),
      socialContentReader,
      socialContentReader,
      { now: () => clock.now() },
    )
  : null;
const maintenance = {
  async reconcile() {
    const [dailyRuns, dailyIdeaRuns, assessmentJobs, repairedCampaigns, retainedSourcing, inboundEvents, observedSocialPosts] = await Promise.all([
      dailyProspectingScheduler.reconcile(),
      dailyContentIdeaScheduler.reconcile(),
      prospectAssessmentReconciler.reconcile(),
      campaignHealthReconciler.reconcile(),
      sourcingRetentionReconciler.reconcile(),
      unipileInboxSynchronizer?.reconcile() ?? Promise.resolve(0),
      socialContentSynchronizer?.reconcile() ?? Promise.resolve(0),
    ]);
    if (inboundEvents > 0) {
      console.info(JSON.stringify({ event: "unipile_inbox_mirror_updated", importedMessages: inboundEvents }));
    }
    if (observedSocialPosts > 0) {
      console.info(JSON.stringify({ event: "linkedin_social_content_synchronized", observedPosts: observedSocialPosts }));
    }
    return dailyRuns + dailyIdeaRuns + assessmentJobs + repairedCampaigns + retainedSourcing + inboundEvents + observedSocialPosts;
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
    activeAiConfigurations,
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
  ...optionalJobTypes("WORKER_JOB_TYPES"),
  ...optionalExcludedJobTypes("WORKER_EXCLUDED_JOB_TYPES"),
}, documentService, discoveryProcessor, channelAssessmentProcessor, campaignAutomationProcessor, campaignCompositionProcessor, outreachDispatchProcessor, inboundReplyProcessor, automatedReplySendProcessor, conversationCommandProcessor, process.env.WORKER_DISABLE_MAINTENANCE === "true" ? undefined : maintenance, process.env.WORKER_DISABLE_OUTBOX === "true" ? undefined : outboxDispatcher, importService, process.env.WORKER_DISABLE_OUTREACH_SCHEDULER === "true" ? undefined : outreachScheduler, enrichmentProcessor, signalProcessor, workspaceExportProcessor, retentionPurgeProcessor, knowledgeExpirationProcessor, evaluationRunProcessor, prospectDecisionProcessor, contentIdeaDiscoveryProcessor, contentGenerationProcessor, contentPublicationProcessor);

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

function optionalJobTypes(name: string): { readonly jobTypes?: readonly string[] } {
  const values = commaSeparatedEnvironment(name);
  return values.length > 0 ? { jobTypes: values } : {};
}

function optionalExcludedJobTypes(name: string): { readonly excludedJobTypes?: readonly string[] } {
  const values = commaSeparatedEnvironment(name);
  return values.length > 0 ? { excludedJobTypes: values } : {};
}

function commaSeparatedEnvironment(name: string): readonly string[] {
  const values = (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => !/^[a-z0-9._-]+$/.test(value))) {
    throw new Error(`${name} contains an invalid job type`);
  }
  return [...new Set(values)];
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
      ? {
          resolveLinkedinAccountId: () => unipileChannelConnections.resolveHealthyAccount(workspaceId, "linkedin").catch(() => null),
          resolveWhatsappAccountId: () => unipileChannelConnections.resolveHealthyAccount(workspaceId, "whatsapp").catch(() => null),
        }
      : {}),
  });
}

function unavailableChannelReadiness() {
  return {
    async resolveHealthyAccount() {
      throw new ProviderUnavailableError(
        "Unipile account readiness is not configured",
        null,
      );
    },
  };
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

function unavailableSocialPublisher(): SocialPublisher {
  const unavailable = () => Promise.reject(new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", "Unipile is not configured", "not_sent", true));
  return { observeCapabilities: unavailable, publishText: unavailable };
}

function unavailableSocialPublishingAccounts(): SocialPublishingAccountResolver {
  return { resolveLinkedin: () => Promise.reject(new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", "Unipile is not configured", "not_sent", true)) };
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
    openAIApiKey: requiredEnvironment("OPENAI_API_KEY"),
    embeddingModel: requiredEnvironment("OPENAI_EMBEDDING_MODEL"),
  };
}
