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
  ResearchDocumentService,
} from "@outbound/infrastructure/documents/research-document-service";
import { TeiGrpcEmbeddingGateway, TeiGrpcReranker } from "@outbound/infrastructure/embeddings/tei-grpc-client";
import {
  ParadeDbVersionedKnowledgeSearch,
  PostgresVersionedKnowledgeIndexer,
} from "@outbound/infrastructure/knowledge/postgres-versioned-knowledge-index";
import { PostgresEmbeddingRevisionManager } from "@outbound/infrastructure/knowledge/postgres-embedding-revision-manager";
import { PostgresKnowledgeProjectionReconciler } from "@outbound/infrastructure/knowledge/postgres-knowledge-projection-reconciler";
import { PostgresResearchToolRunRecorder } from "@outbound/infrastructure/ai/postgres-tool-run-recorder";
import { PostgresWorkspaceAiSettingsRepository } from "@outbound/infrastructure/workspaces/postgres-workspace-ai-settings-repository";
import { createWorkspaceStructuredModelFromEnvironment } from "@outbound/infrastructure/ai/model-runtime-from-environment";
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
import { resolveCalendarSigningKey } from "@outbound/infrastructure/calendar/calendar-signing-key";
import { PostgresUnipileChannelConnections } from "@outbound/infrastructure/channels/postgres-unipile-channel-connections";
import { PostgresImportService } from "@outbound/infrastructure/crm/postgres-import-service";
import { EnrichmentJobProcessor, PostgresEnrichmentRepository } from "@outbound/infrastructure/crm/postgres-enrichment-repository";
import { CrawlerSignalSource } from "@outbound/infrastructure/crm/crawler-signal-source";
import { PostgresSignalRepository, SignalCollectionJobProcessor } from "@outbound/infrastructure/crm/postgres-signal-repository";
import { PostgresOutboxDispatcher } from "@outbound/infrastructure/outbox/postgres-outbox-dispatcher";
import { dispatchMcpExternalEffectExecutionRequested } from "@outbound/infrastructure/outbox/mcp-external-effect-outbox-handler";
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
import { ContentMediaProducer } from "@outbound/application/content/content-media";
import { S3ContentMediaStorage } from "@outbound/infrastructure/content/s3-content-media-storage";
import { DeterministicContentMediaRenderer } from "@outbound/infrastructure/content/deterministic-content-media-renderer";
import { PostgresContentBrandKitRepository } from "@outbound/infrastructure/content/postgres-content-brand-kit-repository";
import { ContentPublicationApplication, ContentPublicationJobProcessor, type SocialPublishingAccountResolver } from "@outbound/application/content/content-publications";
import { SocialProviderError, type SocialPublisher } from "@outbound/application/content/social-ports";
import { PostgresContentPublicationRepository, PostgresSocialPublishingAccountResolver } from "@outbound/infrastructure/content/postgres-content-publication-repository";
import { UnipileSocialPublisher } from "@outbound/infrastructure/content/unipile-social-publisher";
import { SocialContentSynchronizer } from "@outbound/application/content/social-content-sync";
import { PostgresSocialContentSyncRepository } from "@outbound/infrastructure/content/postgres-social-content-sync-repository";
import { UnipileSocialContentReader } from "@outbound/infrastructure/content/unipile-social-content-reader";
import { SocialEngagementSynchronizer } from "@outbound/application/content/social-engagement-sync";
import { PostgresSocialEngagementSyncRepository } from "@outbound/infrastructure/content/postgres-social-engagement-sync-repository";
import { UnipileSocialEngagementReader } from "@outbound/infrastructure/content/unipile-social-engagement-reader";
import { AttributionReconciler } from "@outbound/application/attribution/attribution";
import { PostgresAttributionRepository } from "@outbound/infrastructure/attribution/postgres-attribution-repository";
import { ContentAutopilotReconciler } from "@outbound/application/content/content-autopilot";
import { PostgresContentAutopilotRepository } from "@outbound/infrastructure/content/postgres-content-autopilot-repository";
import { PostgresJobOutcomeReconciler } from "@outbound/infrastructure/jobs/postgres-job-outcome-reconciler";
import { EditorialLearningReconciler } from "@outbound/application/content/editorial-learning";
import { PostgresEditorialLearningRepository } from "@outbound/infrastructure/content/postgres-editorial-learning-repository";
import { ContentPublicationOutcomeReconciler } from "@outbound/application/content/content-publication-reconciliation";
import { PostgresContentPublicationReconciliationRepository } from "@outbound/infrastructure/content/postgres-content-publication-reconciliation-repository";
import { RefreshProspectMemory } from "@outbound/application/prospect-memory/refresh-prospect-memory";
import {
  DeterministicProspectMemoryProjector,
  StrictProspectMemoryProjectionValidator,
} from "@outbound/application/prospect-memory/prospect-memory-projector";
import {
  PostgresContextReceiptRecorder,
  PostgresProspectMemoryEventRepository,
  PostgresProspectMemoryPolicyReader,
  PostgresProspectMemorySnapshotRepository,
} from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-repository";
import {
  PostgresProspectMemoryAuthoritativeStateReader,
  PostgresProspectMemorySemanticBudgetReader,
  PostgresProspectMemorySourceMaterialReader,
} from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-state-reader";
import { LangChainProspectMemorySynthesizer } from "@outbound/infrastructure/prospect-memory/langchain-prospect-memory-synthesizer";
import { ProspectMemoryRefreshJobProcessor } from "@outbound/infrastructure/prospect-memory/prospect-memory-refresh-job-processor";
import {
  ProspectMemoryBackfillJobProcessor,
  ProspectMemoryBackfillScheduler,
} from "@outbound/infrastructure/prospect-memory/prospect-memory-backfill";
import { DefaultProspectContextAssembler } from "@outbound/application/prospect-memory/prospect-context-assembler";
import { DeterministicProspectMemoryShadowComparator } from "@outbound/application/prospect-memory/prospect-memory-shadow-comparator";
import { McpTrackedJobLifecycle } from "@outbound/application/mcp/mcp-tracked-job-lifecycle";
import { PostgresMcpOperationStore } from "@outbound/infrastructure/auth/postgres-mcp-operation-store";
import { ExternalEffectPolicy } from "@outbound/application/mcp/external-effect-policy";
import { PostgresExternalEffectFactsReader } from "@outbound/infrastructure/mcp/postgres-external-effect-facts-reader";
import { PostgresMcpGovernedEffectWorker } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-worker";
import { PostgresMcpExternalEffectAttemptRepository } from "@outbound/infrastructure/mcp/postgres-mcp-effect-attempt-repository";
import { PostgresMcpGovernedEffectExecutor } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-executor";
import { classifySafeError } from "@outbound/application/shared/safe-error";
import { createLocalGovernedEffectFakes, resolveLocalFakeMode, type LocalFakeOptions } from "@outbound/infrastructure/mcp/local-governed-effect-fakes";

const mcpLocalFakeMode = resolveLocalFakeMode(process.env);
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
const mcpOperationStore = new PostgresMcpOperationStore(database.db);
const importService = new PostgresImportService(database.db, queue);
const enrichmentRepository = new PostgresEnrichmentRepository(database.db, new SystemClock());
const signalRepository = new PostgresSignalRepository(database.db, new SystemClock());
const outboxDispatcher = new PostgresOutboxDispatcher(database.client, {
  handler: (event) => dispatchMcpExternalEffectExecutionRequested(database.client, event),
});
const unipileDsn = process.env.UNIPILE_DSN ?? "";
const unipileApiKey = process.env.UNIPILE_API_KEY ?? "";
const unipileClient = unipileDsn && unipileApiKey ? new HttpUnipileClient({ dsn: unipileDsn, apiKey: unipileApiKey, timeoutMs: positiveIntegerEnvironment("UNIPILE_TIMEOUT_MS", 10_000) }) : new UnavailableUnipileClient();
const outreachScheduler = new PostgresOutreachScheduler(database.db, unipileClient);
const repository = new PostgresProductResearchRepository(database.db);
const clock = new SystemClock();
const mcpTrackedJobLifecycle = new McpTrackedJobLifecycle(
  mcpOperationStore,
  async ({ job, operation }) => operation.resultRefs.length > 0
    ? operation.resultRefs
    : persistedMcpResultRefs(job.payload),
  clock,
);
const ids = new CryptoIdGenerator();
const contentHasher = new Sha256ContentHasher();
const workspaceDataLifecycle = new PostgresWorkspaceDataLifecycle(database.db, clock, ids);
const knowledgeExpirationProcessor = new KnowledgeSourceExpirationProcessor(
  new PostgresKnowledgeService(database.db, clock, ids),
  queue,
  clock,
);
const knowledgeRetriever = new PostgresKnowledgeRetriever(database.db, clock);
const activeAiConfigurations = new PostgresActiveAiConfigurationReader(database.db);
const aiRunRecorder = new PostgresAiRunRecorder(database.db, clock, ids);
const documentOptions = documentServiceOptionsFromEnvironment();
const embeddingGateway = new TeiGrpcEmbeddingGateway(embeddingOptionsFromEnvironment());
const knowledgeReranker = new TeiGrpcReranker(rerankerOptionsFromEnvironment());
const knowledgeIndexer = new PostgresVersionedKnowledgeIndexer(database.db, embeddingGateway, ids, clock);
const embeddingRevisionManager = new PostgresEmbeddingRevisionManager(database.db);
const knowledgeProjectionReconciler = new PostgresKnowledgeProjectionReconciler(database.db, knowledgeIndexer);
const documentService = new ResearchDocumentService(
  database.db,
  queue,
  ids,
  clock,
  documentOptions,
  knowledgeIndexer,
);
const documentSearch = new ParadeDbVersionedKnowledgeSearch(
  database.client,
  embeddingGateway,
  knowledgeReranker,
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
const workspaceStructuredModel = createWorkspaceStructuredModelFromEnvironment(process.env, workspaceAiSettings);
const prospectMemoryEvents = new PostgresProspectMemoryEventRepository(database.client);
const prospectMemorySnapshots = new PostgresProspectMemorySnapshotRepository(database.client);
const prospectMemoryPolicies = new PostgresProspectMemoryPolicyReader(database.client);
const prospectMemorySourceMaterials = new PostgresProspectMemorySourceMaterialReader(database.db, contentHasher);
const prospectContextAssembler = new DefaultProspectContextAssembler(
  prospectMemoryEvents,
  prospectMemorySnapshots,
  new PostgresProspectMemoryAuthoritativeStateReader(database.db),
  prospectMemorySourceMaterials,
  prospectMemoryPolicies,
  new PostgresContextReceiptRecorder(database.client),
  ids,
  contentHasher,
);
const prospectMemoryShadowComparator = new DeterministicProspectMemoryShadowComparator(
  aiRunRecorder,
  contentHasher,
);
const evaluationRunProcessor = new EvaluationRunProcessor(
  database.db,
  queue,
  new LangChainEvaluationExecutor(process.env, workspaceStructuredModel),
  clock,
  ids,
);
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
  new LangChainChannelStrategyPlanner(process.env, workspaceStructuredModel),
  new RoutedChannelObservationSource(discoveryCrawler, createProspectSource),
  clock,
);
const campaignAutomationProcessor = new CampaignAutomationJobProcessor(database.db, queue, clock);
const contentBrandKitRepository = new PostgresContentBrandKitRepository(database.db);
const campaignContentGenerator = new LangChainCampaignContentGenerator(
  process.env,
  workspaceAiSettings,
  knowledgeRetriever,
  activeAiConfigurations,
  aiRunRecorder,
  undefined,
  contentBrandKitRepository,
  workspaceStructuredModel,
  prospectContextAssembler,
  prospectMemoryPolicies,
);
const calendarIntegration = new PostgresCalendarIntegration(
  database.db,
  resolveCalendarSigningKey(process.env),
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
  new LangChainProspectDecisionAgent(process.env, workspaceAiSettings, workspaceStructuredModel),
  clock,
  prospectContextAssembler,
  prospectMemoryPolicies,
  prospectMemoryShadowComparator,
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
const inboundReplyAgent = new LangChainInboundReplyAgent(process.env, workspaceAiSettings, knowledgeRetriever, activeAiConfigurations, aiRunRecorder, contentBrandKitRepository, workspaceStructuredModel);
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
  prospectContextAssembler,
  prospectMemoryShadowComparator,
  prospectMemoryPolicies,
);
const dailyProspectingScheduler = new DailyProspectingScheduler(database.db, clock, {
  localTime: process.env.DAILY_PROSPECTING_TIME ?? "06:00",
  timezone: process.env.DAILY_PROSPECTING_TIMEZONE ?? "Europe/Paris",
});
const contentIdeaRepository = new PostgresContentIdeaRepository(database.db);
const contentIdeaDiscoveryProcessor = new ContentIdeaDiscoveryJobProcessor(
  contentIdeaRepository,
  new CrawlerContentIdeaSource(discoveryCrawler),
  new LangChainContentIdeaGenerator(process.env, workspaceAiSettings, aiRunRecorder, undefined, workspaceStructuredModel),
  queue,
  () => clock.now(),
);
const dailyContentIdeaScheduler = new DailyContentIdeaScheduler(database.db, contentIdeaRepository, clock, {
  localTime: process.env.DAILY_CONTENT_IDEA_TIME ?? "06:00",
  timezone: process.env.DAILY_CONTENT_IDEA_TIMEZONE ?? "Europe/Paris",
});
const contentGenerationRepository = new PostgresContentGenerationRepository(database.db);
const contentMediaStorage = new S3ContentMediaStorage({
  endpoint: requiredEnvironment("S3_ENDPOINT"),
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: requiredEnvironment("S3_BUCKET"),
  accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
  secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
});
const contentGenerationProcessor = new ContentGenerationJobProcessor(
  contentGenerationRepository,
  new LangChainContentPipelineAgent(process.env, workspaceAiSettings, aiRunRecorder, undefined, workspaceStructuredModel),
  queue,
  () => clock.now(),
  new ContentMediaProducer(
    contentMediaStorage,
    new DeterministicContentMediaRenderer(process.env.FFMPEG_BINARY?.trim() || "ffmpeg"),
    undefined,
    process.env.CONTENT_MEDIA_TEMP_ROOT?.trim() || "/tmp",
  ),
);
const socialPublisher: SocialPublisher = unipileDsn && unipileApiKey
  ? new UnipileSocialPublisher({ dsn: unipileDsn, apiKey: unipileApiKey, timeoutMs: positiveIntegerEnvironment("UNIPILE_TIMEOUT_MS", 10_000) })
  : unavailableSocialPublisher();
const socialPublishingAccounts: SocialPublishingAccountResolver = unipileChannelConnections
  ? new PostgresSocialPublishingAccountResolver(unipileChannelConnections)
  : unavailableSocialPublishingAccounts();
const contentPublicationRepository = new PostgresContentPublicationRepository(database.db);
const contentPublicationApplication = new ContentPublicationApplication(
  contentPublicationRepository,
  socialPublishingAccounts,
  socialPublisher,
);
const contentPublicationProcessor = new ContentPublicationJobProcessor(
  contentPublicationRepository,
  socialPublishingAccounts,
  socialPublisher,
  queue,
  () => clock.now(),
  contentMediaStorage,
);
const prospectMemoryRefreshProcessor = new ProspectMemoryRefreshJobProcessor(
  new RefreshProspectMemory(
    prospectMemoryEvents,
    prospectMemorySnapshots,
    new PostgresProspectMemoryAuthoritativeStateReader(database.db),
    prospectMemorySourceMaterials,
    prospectMemoryPolicies,
    new PostgresProspectMemorySemanticBudgetReader(database.db),
    new LangChainProspectMemorySynthesizer(workspaceStructuredModel, aiRunRecorder, contentHasher),
    new DeterministicProspectMemoryProjector(),
    new StrictProspectMemoryProjectionValidator(),
    clock,
    ids,
    contentHasher,
  ),
  queue,
  clock,
);
const prospectMemoryBackfillProcessor = new ProspectMemoryBackfillJobProcessor(
  database.db,
  database.client,
  queue,
  ids,
  clock,
);
const prospectMemoryBackfillScheduler = new ProspectMemoryBackfillScheduler(
  database.db,
  queue,
  ids,
  clock,
);
const contentAutopilotReconciler = new ContentAutopilotReconciler(
  new PostgresContentAutopilotRepository(database.db),
  contentGenerationRepository,
  contentPublicationApplication,
  clock,
);
const jobOutcomeReconciler = new PostgresJobOutcomeReconciler(database.db, clock);
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
const localMcpFakes = mcpLocalFakeMode
  ? createLocalGovernedEffectFakes({
      mode: "local-fake",
      allowNetwork: false,
      outcomes: {
        conversation_reply: { kind: "success", safeCode: "MCP_LOCAL_FAKE_ACCEPTED", providerReference: "fake-message" },
        content_publication: { kind: "success", safeCode: "MCP_LOCAL_FAKE_ACCEPTED", providerReference: "fake-post" },
        meeting_proposal: { kind: "success", safeCode: "MCP_LOCAL_FAKE_ACCEPTED", providerReference: "fake-booking" },
        campaign_activation: { kind: "failure", safeCode: "ADAPTER_UNAVAILABLE" },
      },
      counters: { conversationReply: 0, contentPublication: 0, meetingProposal: 0, campaignActivation: 0 },
    } satisfies LocalFakeOptions)
  : null;
const mcpGovernedEffectAdapters = localMcpFakes?.adapters ?? {
  outbound: createOutboundGateway(),
  publisher: socialPublisher,
  ...(socialContentReader ? { socialContentReader } : {}),
  calendar: calendarIntegration,
};
const mcpGovernedEffectExecutor = new PostgresMcpGovernedEffectExecutor(database.db, mcpGovernedEffectAdapters);
// Keep the attempt boundary shared by the queue processor and maintenance.
// Recovery is deliberately bounded and tenant-filtered by the repository's
// transaction; it only handles expired started attempts and performs
// read-only reconciliation, never the original mutation.
const mcpGovernedEffectAttemptRepository = new PostgresMcpExternalEffectAttemptRepository(
  database.db,
  mcpGovernedEffectExecutor,
  () => clock.now(),
);
const mcpGovernedEffectWorker = new PostgresMcpGovernedEffectWorker(
  database.db,
  new ExternalEffectPolicy(new PostgresExternalEffectFactsReader(database.db, () => clock.now())),
  {
    now: () => clock.now(),
    leaseMs: positiveIntegerEnvironment("JOB_LEASE_MS", 60_000),
    queue,
    attemptPort: mcpGovernedEffectAttemptRepository,
    executor: (input) => mcpGovernedEffectExecutor.execute(input),
  },
);
const mcpGovernedEffectProcessor = {
  process: (job: import("@outbound/application/jobs/job-queue").LeasedJob) => mcpGovernedEffectWorker.process({ ...job, status: job.status ?? "running" }),
};
const socialContentSynchronizer = socialContentReader && process.env.UNIPILE_SOCIAL_CONTENT_SYNC_ENABLED !== "false"
  ? new SocialContentSynchronizer(
      new PostgresSocialContentSyncRepository(database.db),
      socialContentReader,
      socialContentReader,
      { now: () => clock.now() },
    )
  : null;
const contentPublicationOutcomeReconciler = socialContentReader
  ? new ContentPublicationOutcomeReconciler(
      new PostgresContentPublicationReconciliationRepository(database.db),
      socialContentReader,
      { now: () => clock.now() },
    )
  : null;
const socialEngagementSynchronizer = unipileDsn && unipileApiKey && process.env.UNIPILE_SOCIAL_ENGAGEMENT_SYNC_ENABLED !== "false"
  ? new SocialEngagementSynchronizer(
      new PostgresSocialEngagementSyncRepository(database.db),
      new UnipileSocialEngagementReader({
        dsn: unipileDsn,
        apiKey: unipileApiKey,
        timeoutMs: positiveIntegerEnvironment("UNIPILE_TIMEOUT_MS", 10_000),
      }),
      { now: () => clock.now() },
    )
  : null;
const attributionReconciler = new AttributionReconciler(
  new PostgresAttributionRepository(database.db),
  { now: () => clock.now() },
);
const editorialLearningReconciler = new EditorialLearningReconciler(
  new PostgresEditorialLearningRepository(database.db),
  () => clock.now(),
);
const maintenance = {
  async reconcile() {
    const mcpEffectRecoveryLimit = Math.min(
      25,
      positiveIntegerEnvironment("MCP_EFFECT_RECOVERY_BATCH", 10),
    );
    // Bounded passes recover expired attempts and independently scan durable
    // due reconciliation rows. They are awaited by the existing non-blocking
    // maintenance hook, so normal queue leasing remains independent of this work.
    const recoveredMcpEffects = await mcpGovernedEffectAttemptRepository.recoverExpiredStarted({
      now: clock.now(),
      limit: mcpEffectRecoveryLimit,
    }).catch((error) => {
      console.warn(JSON.stringify({
        event: "mcp_effect_recovery_deferred",
        errorCode: classifySafeError(error, "MCP_EFFECT_RECOVERY_DEFERRED"),
      }));
      return 0;
    });
    const reconciledDueMcpEffects = await mcpGovernedEffectAttemptRepository.reconcileDue({
      now: clock.now(),
      limit: mcpEffectRecoveryLimit,
    }).catch((error) => {
      console.warn(JSON.stringify({
        event: "mcp_effect_due_reconciliation_deferred",
        errorCode: classifySafeError(error, "MCP_EFFECT_DUE_RECONCILIATION_DEFERRED"),
      }));
      return 0;
    });
    const purgedEmbeddingRevisions = await embeddingRevisionManager.purgeExpired();
    const projectedKnowledgeDocuments = await knowledgeProjectionReconciler.reconcile().catch((error) => {
      console.warn(JSON.stringify({
        event: "knowledge_projection_deferred",
        errorCode: classifySafeError(error, "KNOWLEDGE_PROJECTION_DEFERRED"),
      }));
      return 0;
    });
    const reconciledPreSendWaits = await jobOutcomeReconciler.reconcileExhaustedPreSendWaits();
    const reconciledRecoverableProviderRefusals = await jobOutcomeReconciler.reconcileRecoverableOutreachActions();
    const reconciledStaleProviderActions = await jobOutcomeReconciler.reconcileStaleOutreachActions();
    const [dailyRuns, dailyIdeaRuns, assessmentJobs, repairedCampaigns, retainedSourcing, inboundEvents, observedSocialEngagements, reconciledJobOutcomes, prospectMemoryBackfills, reconciledMcpOperations] = await Promise.all([
      dailyProspectingScheduler.reconcile(),
      dailyContentIdeaScheduler.reconcile(),
      prospectAssessmentReconciler.reconcile(),
      campaignHealthReconciler.reconcile(),
      sourcingRetentionReconciler.reconcile(),
      unipileInboxSynchronizer?.reconcile() ?? Promise.resolve(0),
      socialEngagementSynchronizer?.reconcile() ?? Promise.resolve(0),
      jobOutcomeReconciler.reconcile(),
      prospectMemoryBackfillScheduler.reconcile(),
      mcpOperationStore.reconcileJobOutcomes(100),
    ]);
    const reconciledProviderEffects = await contentPublicationOutcomeReconciler?.reconcile() ?? 0;
    const observedSocialPosts = await socialContentSynchronizer?.reconcile() ?? 0;
    const automatedContentActions = await contentAutopilotReconciler.reconcile();
    if (automatedContentActions > 0) {
      console.info(JSON.stringify({ event: "linkedin_content_autopilot_progressed", actions: automatedContentActions }));
    }
    if (purgedEmbeddingRevisions > 0) {
      console.info(JSON.stringify({ event: "expired_embedding_revisions_purged", revisions: purgedEmbeddingRevisions }));
    }
    if (projectedKnowledgeDocuments > 0) {
      console.info(JSON.stringify({ event: "knowledge_documents_projected", documents: projectedKnowledgeDocuments }));
    }
    if (reconciledJobOutcomes > 0) {
      console.info(JSON.stringify({ event: "job_outcomes_reconciled", count: reconciledJobOutcomes }));
    }
    if (reconciledMcpOperations > 0) {
      console.info(JSON.stringify({ event: "mcp_job_outcomes_reconciled", count: reconciledMcpOperations }));
    }
    if (recoveredMcpEffects > 0) {
      console.info(JSON.stringify({ event: "mcp_effect_attempts_recovered", count: recoveredMcpEffects }));
    }
    if (reconciledDueMcpEffects > 0) {
      console.info(JSON.stringify({ event: "mcp_effect_due_reconciled", count: reconciledDueMcpEffects }));
    }
    if (reconciledStaleProviderActions > 0) {
      console.info(JSON.stringify({ event: "stale_outreach_actions_failed_closed", count: reconciledStaleProviderActions }));
    }
    if (reconciledRecoverableProviderRefusals > 0) {
      console.info(JSON.stringify({ event: "recoverable_outreach_actions_rescheduled", count: reconciledRecoverableProviderRefusals }));
    }
    if (reconciledPreSendWaits > 0) {
      console.info(JSON.stringify({ event: "exhausted_pre_send_waits_rescheduled", count: reconciledPreSendWaits }));
    }
    if (inboundEvents > 0) {
      console.info(JSON.stringify({ event: "unipile_inbox_mirror_updated", importedMessages: inboundEvents }));
    }
    if (observedSocialPosts > 0) {
      console.info(JSON.stringify({ event: "linkedin_social_content_synchronized", observedPosts: observedSocialPosts }));
    }
    if (reconciledProviderEffects > 0) {
      console.info(JSON.stringify({ event: "linkedin_provider_effects_reconciled", decisions: reconciledProviderEffects }));
    }
    if (observedSocialEngagements > 0) {
      console.info(JSON.stringify({ event: "linkedin_social_engagements_synchronized", observedEngagements: observedSocialEngagements }));
    }
    const attributedInteractions = await attributionReconciler.reconcile();
    if (attributedInteractions > 0) {
      console.info(JSON.stringify({ event: "linkedin_attribution_reconciled", interactions: attributedInteractions }));
    }
    const editorialLearningVersions = await editorialLearningReconciler.reconcile();
    if (editorialLearningVersions > 0) {
      console.info(JSON.stringify({ event: "linkedin_editorial_learning_updated", versions: editorialLearningVersions }));
    }
    return dailyRuns + dailyIdeaRuns + automatedContentActions + assessmentJobs + repairedCampaigns + retainedSourcing + inboundEvents + reconciledProviderEffects + observedSocialPosts + observedSocialEngagements + attributedInteractions + editorialLearningVersions + reconciledJobOutcomes + prospectMemoryBackfills + reconciledMcpOperations + recoveredMcpEffects + reconciledDueMcpEffects + reconciledPreSendWaits + reconciledRecoverableProviderRefusals + reconciledStaleProviderActions + purgedEmbeddingRevisions + projectedKnowledgeDocuments;
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
    workspaceStructuredModel,
  ),
  ids,
  clock,
  contentHasher,
);
const worker = new ResearchWorker(queue, orchestrator, clock, {
  workerId: process.env.WORKER_ID ?? `research-${crypto.randomUUID()}`,
  leaseMs: positiveIntegerEnvironment("JOB_LEASE_MS", 60_000),
  leaseHeartbeatMs: positiveIntegerEnvironment("JOB_HEARTBEAT_MS", 20_000),
  batchSize: positiveIntegerEnvironment("JOB_BATCH_SIZE", 4),
  pollIntervalMs: positiveIntegerEnvironment("JOB_POLL_INTERVAL_MS", 1_000),
  ...optionalJobTypes("WORKER_JOB_TYPES"),
  ...optionalExcludedJobTypes("WORKER_EXCLUDED_JOB_TYPES"),
}, documentService, discoveryProcessor, channelAssessmentProcessor, campaignAutomationProcessor, campaignCompositionProcessor, outreachDispatchProcessor, inboundReplyProcessor, automatedReplySendProcessor, conversationCommandProcessor, process.env.WORKER_DISABLE_MAINTENANCE === "true" ? undefined : maintenance, process.env.WORKER_DISABLE_OUTBOX === "true" ? undefined : outboxDispatcher, importService, process.env.WORKER_DISABLE_OUTREACH_SCHEDULER === "true" ? undefined : outreachScheduler, enrichmentProcessor, signalProcessor, workspaceExportProcessor, retentionPurgeProcessor, knowledgeExpirationProcessor, evaluationRunProcessor, prospectDecisionProcessor, contentIdeaDiscoveryProcessor, contentGenerationProcessor, contentPublicationProcessor, prospectMemoryRefreshProcessor, prospectMemoryBackfillProcessor, mcpTrackedJobLifecycle, mcpGovernedEffectProcessor);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.info(JSON.stringify({ event: "research_worker_stopping", signal }));
    worker.stop();
  });
}

console.info(JSON.stringify({ event: "research_worker_started" }));
try {
  const reconciledPreSendWaits = await jobOutcomeReconciler.reconcileExhaustedPreSendWaits();
  if (reconciledPreSendWaits > 0) {
    console.info(JSON.stringify({ event: "exhausted_pre_send_waits_rescheduled", count: reconciledPreSendWaits }));
  }
  const reconciledRecoverableProviderRefusals = await jobOutcomeReconciler.reconcileRecoverableOutreachActions();
  if (reconciledRecoverableProviderRefusals > 0) {
    console.info(JSON.stringify({ event: "recoverable_outreach_actions_rescheduled", count: reconciledRecoverableProviderRefusals }));
  }
  const reconciledStaleProviderActions = await jobOutcomeReconciler.reconcileStaleOutreachActions();
  if (reconciledStaleProviderActions > 0) {
    console.info(JSON.stringify({ event: "stale_outreach_actions_failed_closed", count: reconciledStaleProviderActions }));
  }
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

function persistedMcpResultRefs(payload: unknown): readonly { type: string; id: string }[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const refs = (payload as Record<string, unknown>).mcpResultRefs;
  if (!Array.isArray(refs)) return [];
  return refs.filter((ref): ref is { type: string; id: string } => (
    !!ref
    && typeof ref === "object"
    && !Array.isArray(ref)
    && typeof (ref as Record<string, unknown>).type === "string"
    && typeof (ref as Record<string, unknown>).id === "string"
  ));
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
  return { observeCapabilities: unavailable, publish: unavailable, publishText: unavailable };
}

function unavailableSocialPublishingAccounts(): SocialPublishingAccountResolver {
  return { resolveLinkedin: () => Promise.reject(new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", "Unipile is not configured", "not_sent", true)) };
}

function documentServiceOptionsFromEnvironment() {
  if (process.env.DOCUMENT_EXTRACTOR?.toLowerCase() === "docling") {
    throw new Error("DOCUMENT_EXTRACTOR=docling is no longer supported; remove the legacy configuration");
  }
  return {
    bucket: requiredEnvironment("S3_BUCKET"),
    endpoint: requiredEnvironment("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
  };
}

function embeddingOptionsFromEnvironment() {
  return {
    address: process.env.TEI_EMBEDDING_GRPC_ADDRESS ?? "127.0.0.1:8081",
    expectedModelId: process.env.TEI_EMBEDDING_RUNTIME_MODEL_ID ?? "janni-t/qwen3-embedding-0.6b-int8-tei-onnx",
    expectedModelSha: process.env.TEI_EMBEDDING_RUNTIME_MODEL_SHA ?? "8fe0c238c7c48016d28e750413ca492024be3ddf",
    dimension: positiveIntegerEnvironment("TEI_EMBEDDING_DIMENSION", 1_024),
    timeoutMs: positiveIntegerEnvironment("TEI_GRPC_TIMEOUT_MS", 15_000),
    maxConcurrency: positiveIntegerEnvironment("TEI_EMBEDDING_CONCURRENCY", 1),
    queryInstruction: process.env.TEI_QUERY_INSTRUCTION ?? "Given a search query, retrieve relevant passages that answer the query in French or English.",
    ...(process.env.TEI_PROTO_PATH ? { protoPath: process.env.TEI_PROTO_PATH } : {}),
  };
}

function rerankerOptionsFromEnvironment() {
  return {
    address: process.env.TEI_RERANKER_GRPC_ADDRESS ?? "127.0.0.1:8082",
    expectedModelId: process.env.TEI_RERANKER_RUNTIME_MODEL_ID ?? "csylabs/bge-reranker-v2-m3-int8-onnx",
    expectedModelSha: process.env.TEI_RERANKER_RUNTIME_MODEL_SHA ?? "eaf5072d7b1a3f1fa584cc7482c7efb8f784dca0",
    dimension: 0,
    timeoutMs: positiveIntegerEnvironment("TEI_GRPC_TIMEOUT_MS", 15_000),
    ...(process.env.TEI_PROTO_PATH ? { protoPath: process.env.TEI_PROTO_PATH } : {}),
  };
}
