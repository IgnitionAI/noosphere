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
import { resolveCalendarSigningKey } from "@outbound/infrastructure/calendar/calendar-signing-key";
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
import { EditorialStrategyApplication } from "@outbound/application/content/editorial-strategy";
import { PostgresEditorialStrategyRepository } from "@outbound/infrastructure/content/postgres-editorial-strategy-repository";
import { LangChainEditorialStrategyGenerator } from "@outbound/infrastructure/content/langchain-editorial-strategy-generator";
import { PostgresAiRunRecorder } from "@outbound/infrastructure/ai/postgres-ai-run-recorder";
import { createContentStrategyHttpHandler, isContentStrategyRoute } from "@outbound/interface/http/content-strategy-handler";
import { ContentIdeaApplication } from "@outbound/application/content/content-ideas";
import { PostgresContentIdeaRepository } from "@outbound/infrastructure/content/postgres-content-idea-repository";
import { createContentIdeaHttpHandler, isContentIdeaRoute } from "@outbound/interface/http/content-idea-handler";
import { ContentGenerationApplication } from "@outbound/application/content/content-generation";
import { PostgresContentGenerationRepository } from "@outbound/infrastructure/content/postgres-content-generation-repository";
import { createContentGenerationHttpHandler, isContentGenerationRoute } from "@outbound/interface/http/content-generation-handler";
import { ContentPublicationApplication, type SocialPublishingAccountResolver } from "@outbound/application/content/content-publications";
import { SocialProviderError, type SocialPublisher } from "@outbound/application/content/social-ports";
import { PostgresContentPublicationRepository, PostgresSocialPublishingAccountResolver } from "@outbound/infrastructure/content/postgres-content-publication-repository";
import { UnipileSocialPublisher } from "@outbound/infrastructure/content/unipile-social-publisher";
import { createContentPublicationHttpHandler, isContentPublicationRoute } from "@outbound/interface/http/content-publication-handler";
import { SocialContentSyncApplication } from "@outbound/application/content/social-content-sync";
import { PostgresSocialContentSyncRepository } from "@outbound/infrastructure/content/postgres-social-content-sync-repository";
import { createSocialContentHttpHandler, isSocialContentRoute } from "@outbound/interface/http/social-content-handler";
import { SocialEngagementApplication } from "@outbound/application/content/social-engagement-sync";
import { PostgresSocialEngagementSyncRepository } from "@outbound/infrastructure/content/postgres-social-engagement-sync-repository";
import { createSocialEngagementHttpHandler, isSocialEngagementRoute } from "@outbound/interface/http/social-engagement-handler";
import { AttributionApplication } from "@outbound/application/attribution/attribution";
import { PostgresAttributionRepository } from "@outbound/infrastructure/attribution/postgres-attribution-repository";
import { createAttributionHttpHandler, isAttributionRoute } from "@outbound/interface/http/attribution-handler";
import { ContentAutopilotApplication } from "@outbound/application/content/content-autopilot";
import { PostgresContentAutopilotRepository } from "@outbound/infrastructure/content/postgres-content-autopilot-repository";
import { createContentAutopilotHttpHandler, isContentAutopilotRoute } from "@outbound/interface/http/content-autopilot-handler";
import { EditorialLearningApplication } from "@outbound/application/content/editorial-learning";
import { PostgresEditorialLearningRepository } from "@outbound/infrastructure/content/postgres-editorial-learning-repository";
import { createEditorialLearningHttpHandler, isEditorialLearningRoute } from "@outbound/interface/http/editorial-learning-handler";
import { ContentBrandKitApplication } from "@outbound/application/content/content-brand-kit";
import { PostgresContentBrandKitRepository } from "@outbound/infrastructure/content/postgres-content-brand-kit-repository";
import { createContentBrandKitHttpHandler } from "@outbound/interface/http/content-brand-kit-handler";
import { SharpContentBrandLogoProcessor } from "@outbound/infrastructure/content/sharp-content-brand-logo-processor";
import { S3ContentMediaStorage } from "@outbound/infrastructure/content/s3-content-media-storage";
import { LangChainContentBrandDirectionDesigner } from "@outbound/infrastructure/content/langchain-content-brand-direction-designer";
import { CrawlerContentBrandLandingPageReader } from "@outbound/infrastructure/content/crawler-content-brand-landing-page-reader";
import { ContentPerformanceApplication } from "@outbound/application/content/content-performance";
import { PostgresContentPerformanceRepository } from "@outbound/infrastructure/content/postgres-content-performance-repository";
import { createContentPerformanceHttpHandler } from "@outbound/interface/http/content-performance-handler";
import { ModelCatalogApplication } from "@outbound/application/ai/model-catalog-application";
import { KimiModelCatalog } from "@outbound/infrastructure/ai/kimi-model-gateway";
import { CodexModelCatalog } from "@outbound/infrastructure/ai/codex-cli-model-gateway";
import { createModelCatalogHttpHandler } from "@outbound/interface/http/model-catalog-handler";
import { createWorkspaceStructuredModelFromEnvironment } from "@outbound/infrastructure/ai/model-runtime-from-environment";
import { ProspectMemoryOperationsApplication } from "@outbound/application/prospect-memory/prospect-memory-operations";
import { DefaultProspectContextAssembler } from "@outbound/application/prospect-memory/prospect-context-assembler";
import {
  PostgresContextReceiptRecorder,
  PostgresProspectMemoryEventRepository,
  PostgresProspectMemoryPolicyReader,
  PostgresProspectMemorySnapshotRepository,
} from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-repository";
import {
  PostgresProspectMemoryAuthoritativeStateReader,
  PostgresProspectMemorySourceMaterialReader,
} from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-state-reader";
import { PostgresProspectMemoryOperationsReader } from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-operations-reader";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { createProspectMemoryHttpHandler, isProspectMemoryRoute } from "@outbound/interface/http/prospect-memory-handler";
import { createNoosphereRuntime } from "@outbound/bootstrap/create-noosphere-runtime";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";
import type { NoosphereRuntime } from "@outbound/bootstrap/noosphere-runtime";
import { createMcpTransport } from "@outbound/interface/mcp/mcp-transport";
import { createMcpOAuthHandler, createMcpOAuthService } from "@outbound/interface/mcp/mcp-oauth";
import { PostgresMcpOAuthStore } from "@outbound/infrastructure/auth/postgres-mcp-oauth-store";

/** Compose the complete API application once for HTTP or a future MCP adapter. */
export function createNoosphereApiRuntime(environment: NodeJS.ProcessEnv = process.env): NoosphereRuntime {
const publicAppOrigin = securePublicOrigin(requiredEnvironment("BETTER_AUTH_URL"));
const databaseUrl = requiredEnvironment("DATABASE_URL");
const database = createDatabase(databaseUrl);
const auth = createBetterAuthRuntime(database.db, {
  baseUrl: publicAppOrigin,
  secret: requiredSecretEnvironment("BETTER_AUTH_SECRET"),
  trustedOrigins: commaSeparatedEnvironment(
    "BETTER_AUTH_TRUSTED_ORIGINS",
    publicAppOrigin,
  ),
  allowSignUp: environment.BETTER_AUTH_ALLOW_SIGN_UP === "true",
});
const mcpIssuer = publicAppOrigin;
const mcpResource = `${mcpIssuer}/mcp`;
const mcpOAuthStore = new PostgresMcpOAuthStore(database.db);
const mcpOAuthService = createMcpOAuthService(mcpOAuthStore, {
  issuer: mcpIssuer,
  resource: mcpResource,
});
const mcpOAuth = createMcpOAuthHandler(mcpOAuthService, {
  issuer: mcpIssuer,
  resource: mcpResource,
  allowedHosts: mcpAllowedHostsFromEnvironment(),
  trustedInternalHosts: commaSeparatedEnvironment("MCP_TRUSTED_INTERNAL_HOSTS", "api,localhost,127.0.0.1,[::1]"),
  rateLimiter: mcpOAuthStore,
  resolveUserContext: async (request, workspaceSlug) => {
    const headers = new Headers(request.headers);
    headers.set("x-workspace-slug", workspaceSlug);
    try {
      const context = await auth.contextResolver.resolve(new Request(request, { headers }));
      return { userId: context.userId, workspaceId: context.workspaceId, workspaceSlug, role: context.role };
    } catch {
      return null;
    }
  },
});
const repository = new PostgresProductResearchRepository(database.db);
const queue = new PostgresJobQueue(database.client);
const clock = new SystemClock();
const ids = new CryptoIdGenerator();
const contentBrandKitRepository = new PostgresContentBrandKitRepository(database.db);
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
const workspaceStructuredModel = createWorkspaceStructuredModelFromEnvironment(environment, workspaceAiSettingsRepository);
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
    resolveResearchModelPolicyFromEnvironment(environment),
  ),
  contextResolver: auth.contextResolver,
});
const modelCatalog = createModelCatalogHttpHandler({
  application: new ModelCatalogApplication([
    ...(environment.KIMI_CODE_API_KEY
      ? [new KimiModelCatalog({
          apiKey: environment.KIMI_CODE_API_KEY,
          ...(environment.KIMI_CODE_BASE_URL ? { baseUrl: environment.KIMI_CODE_BASE_URL } : {}),
        })]
      : []),
    ...(environment.CODEX_SERVICE_HOME
      ? [new CodexModelCatalog({
          codexHome: environment.CODEX_SERVICE_HOME,
          ...(environment.CODEX_BINARY_PATH ? { binaryPath: environment.CODEX_BINARY_PATH } : {}),
        })]
      : []),
  ]),
  contextResolver: auth.contextResolver,
});
const documents = createResearchDocumentHttpHandler({
  service: documentService,
  contextResolver: auth.contextResolver,
});
const prospectMemoryEvents = new PostgresProspectMemoryEventRepository(database.client);
const prospectMemorySnapshots = new PostgresProspectMemorySnapshotRepository(database.client);
const prospectMemoryAuthoritativeState = new PostgresProspectMemoryAuthoritativeStateReader(database.db);
const prospectMemoryPolicies = new PostgresProspectMemoryPolicyReader(database.client);
const prospectMemoryOperationsReader = new PostgresProspectMemoryOperationsReader(database.client);
const prospectMemoryHasher = new Sha256ContentHasher();
const prospectMemoryAssembler = new DefaultProspectContextAssembler(
  prospectMemoryEvents,
  prospectMemorySnapshots,
  prospectMemoryAuthoritativeState,
  new PostgresProspectMemorySourceMaterialReader(database.db, prospectMemoryHasher),
  prospectMemoryPolicies,
  new PostgresContextReceiptRecorder(database.client),
  ids,
  prospectMemoryHasher,
);
const prospectMemoryApplication = new ProspectMemoryOperationsApplication(
  prospectMemoryEvents,
  prospectMemorySnapshots,
  prospectMemoryAuthoritativeState,
  prospectMemoryPolicies,
  prospectMemoryOperationsReader,
  prospectMemoryAssembler,
  queue,
  ids,
  clock,
);
const prospectMemory = createProspectMemoryHttpHandler({
  contextResolver: auth.contextResolver,
  application: prospectMemoryApplication,
});
const crm = createCrmHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
});
const unipileDsn = environment.UNIPILE_DSN ?? "";
const unipileApiKey = environment.UNIPILE_API_KEY ?? "";
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
  environment.CRAWLER_SERVICE_URL && environment.CRAWLER_API_KEY
    ? new CrawlerClient({
        baseUrl: environment.CRAWLER_SERVICE_URL,
        apiKey: environment.CRAWLER_API_KEY,
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
      ...(environment.UNIPILE_LINKEDIN_ACCOUNT_ID
        ? { accountId: environment.UNIPILE_LINKEDIN_ACCOUNT_ID }
        : {}),
      ...(environment.UNIPILE_WHATSAPP_ACCOUNT_ID
        ? { whatsappAccountId: environment.UNIPILE_WHATSAPP_ACCOUNT_ID }
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
    environment,
    workspaceAiSettingsRepository,
    undefined,
    contentBrandKitRepository,
    workspaceStructuredModel,
    prospectMemoryAssembler,
    prospectMemoryPolicies,
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
  secret: environment.UNIPILE_WEBHOOK_SECRET ?? "",
});
const connectedAccounts = createConnectedAccountHttpHandler({
  database: database.db,
  contextResolver: auth.contextResolver,
  client: connectedAccountClient,
  webhookSecret: environment.UNIPILE_WEBHOOK_SECRET ?? "",
  publicAppBaseUrl: requiredEnvironment("BETTER_AUTH_URL"),
});
const calendarSigningKey = resolveCalendarSigningKey(environment);
const calendarIntegration = new PostgresCalendarIntegration(database.db, calendarSigningKey);
const calendarConnection = createCalendarConnectionHttpHandler({
  integration: calendarIntegration,
  contextResolver: auth.contextResolver,
  publicWebhookBaseUrl: environment.PUBLIC_WEBHOOK_BASE_URL ?? requiredEnvironment("BETTER_AUTH_URL"),
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
const contentStrategyApplication = new EditorialStrategyApplication(
  new PostgresEditorialStrategyRepository(database.db),
  new LangChainEditorialStrategyGenerator(
    environment,
    workspaceAiSettingsRepository,
    new PostgresAiRunRecorder(database.db, clock, ids),
    undefined,
    workspaceStructuredModel,
  ),
);
const contentStrategy = createContentStrategyHttpHandler({
  contextResolver: auth.contextResolver,
  application: contentStrategyApplication,
});
const contentAutopilotApplication = new ContentAutopilotApplication(
  new PostgresContentAutopilotRepository(database.db),
  clock,
);
const contentAutopilot = createContentAutopilotHttpHandler({
  contextResolver: auth.contextResolver,
  application: contentAutopilotApplication,
});
const contentBrandKitApplication = new ContentBrandKitApplication(
  contentBrandKitRepository,
  new SharpContentBrandLogoProcessor(),
  new S3ContentMediaStorage({
    endpoint: requiredEnvironment("S3_ENDPOINT"),
    region: environment.S3_REGION ?? "us-east-1",
    bucket: requiredEnvironment("S3_BUCKET"),
    accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
  }),
  new LangChainContentBrandDirectionDesigner(
    environment,
    workspaceAiSettingsRepository,
    new PostgresAiRunRecorder(database.db, clock, ids),
    undefined,
    workspaceStructuredModel,
  ),
  discoveryCrawler ? new CrawlerContentBrandLandingPageReader(discoveryCrawler) : undefined,
);
const contentBrandKit = createContentBrandKitHttpHandler({
  contextResolver: auth.contextResolver,
  application: contentBrandKitApplication,
});
const contentPerformanceApplication = new ContentPerformanceApplication(new PostgresContentPerformanceRepository(database.db));
const contentPerformance = createContentPerformanceHttpHandler({
  contextResolver: auth.contextResolver,
  application: contentPerformanceApplication,
});
const editorialLearningApplication = new EditorialLearningApplication(new PostgresEditorialLearningRepository(database.db));
const editorialLearning = createEditorialLearningHttpHandler({
  contextResolver: auth.contextResolver,
  application: editorialLearningApplication,
});
const contentIdeasApplication = new ContentIdeaApplication(new PostgresContentIdeaRepository(database.db));
const contentIdeas = createContentIdeaHttpHandler({
  contextResolver: auth.contextResolver,
  application: contentIdeasApplication,
});
const contentPublicationRepository = new PostgresContentPublicationRepository(database.db);
const contentGenerationApplication = new ContentGenerationApplication(new PostgresContentGenerationRepository(database.db));
const contentGeneration = createContentGenerationHttpHandler({
  contextResolver: auth.contextResolver,
  application: contentGenerationApplication,
  publications: contentPublicationRepository,
});
const socialPublisher: SocialPublisher = unipileDsn && unipileApiKey
  ? new UnipileSocialPublisher({ dsn: unipileDsn, apiKey: unipileApiKey, timeoutMs: positiveIntegerEnvironment("UNIPILE_TIMEOUT_MS", 10_000) })
  : unavailableSocialPublisher();
const socialPublishingAccounts: SocialPublishingAccountResolver = unipileChannelConnections
  ? new PostgresSocialPublishingAccountResolver(unipileChannelConnections)
  : unavailableSocialPublishingAccounts();
const contentPublicationApplication = new ContentPublicationApplication(
  contentPublicationRepository,
  socialPublishingAccounts,
  socialPublisher,
);
const contentPublications = createContentPublicationHttpHandler({
  contextResolver: auth.contextResolver,
  application: contentPublicationApplication,
});
const socialContentApplication = new SocialContentSyncApplication(new PostgresSocialContentSyncRepository(database.db));
const socialContent = createSocialContentHttpHandler({
  contextResolver: auth.contextResolver,
  application: socialContentApplication,
});
const socialEngagementApplication = new SocialEngagementApplication(new PostgresSocialEngagementSyncRepository(database.db));
const socialEngagements = createSocialEngagementHttpHandler({
  contextResolver: auth.contextResolver,
  application: socialEngagementApplication,
});
const attributionApplication = new AttributionApplication(new PostgresAttributionRepository(database.db));
const attribution = createAttributionHttpHandler({
  contextResolver: auth.contextResolver,
  application: attributionApplication,
});
async function dispatch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/oauth/") || pathname === "/.well-known/oauth-authorization-server" || pathname.startsWith("/.well-known/oauth-protected-resource")) return mcpOAuth(request);
    if (pathname === "/mcp") return mcpTransport.handle(request);
    if (pathname.startsWith("/api/auth/")) return runtime.handleAuth(request);
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
    if (isContentStrategyRoute(pathname)) return contentStrategy(request);
    if (isContentAutopilotRoute(pathname)) return contentAutopilot(request);
    if (pathname.startsWith("/api/v1/content/brand-kit")) return contentBrandKit(request);
    if (pathname === "/api/v1/content/performance") return contentPerformance(request);
    if (isEditorialLearningRoute(pathname)) return editorialLearning(request);
    if (isAttributionRoute(pathname)) return attribution(request);
    if (isSocialEngagementRoute(pathname)) return socialEngagements(request);
    if (isSocialContentRoute(pathname)) return socialContent(request);
    if (isContentPublicationRoute(pathname)) return contentPublications(request);
    if (isContentGenerationRoute(pathname)) return contentGeneration(request);
    if (isContentIdeaRoute(pathname)) return contentIdeas(request);
    if (
      pathname === "/api/v1/workspace/operational-summary"
      || pathname === "/api/v1/activity"
      || pathname === "/api/v1/workspace/setup-readiness"
      || pathname === "/api/v1/conversations"
      || (request.method === "GET" && /^\/api\/v1\/conversations\/[^/]+$/.test(pathname))
      || pathname === "/api/v1/pipeline/view"
      || /^\/api\/v1\/campaigns\/[^/]+\/workspace-view$/.test(pathname)
    ) return operationalViews(request);
    if (pathname.startsWith("/api/v1/opportunities") || pathname === "/api/v1/pipeline/forecast" || pathname.startsWith("/api/v1/workspaces/") && pathname.endsWith("/lost-reasons")) return opportunityHandler(request);
    if (pathname.includes("/actions/enrich") || pathname.startsWith("/api/v1/enrichment-jobs/") || pathname.endsWith("/enrichment")) return enrichment(request);
    if (pathname === "/api/v1/workspaces" || pathname.startsWith("/api/v1/workspaces/") || pathname.startsWith("/api/v1/invitations/")) return workspace(request);
    if (pathname === "/api/v1/workspace-ai-settings") return workspaceAiSettings(request);
    if (pathname === "/api/v1/ai/models") return modelCatalog(request);
    if (isProspectMemoryRoute(pathname)) return prospectMemory(request);
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
      const result = await runtime.health();
      return Response.json(result, result.status === "ready" ? undefined : { status: 503 });
    }
  return productResearch(request);
}
const runtimeCapabilities: RuntimeCapabilities = {
  crm: {
    productResearch: {
      get: (input) => application.get(input),
      list: (input) => application.list(input),
    },
  },
  prospectMemory: {
    operations: {
      status: (workspaceId, contactId) => prospectMemoryApplication.status(workspaceId, contactId),
      view: (input) => prospectMemoryApplication.view(input),
    },
  },
  pipeline: { available: false },
  campaigns: { available: false },
  conversations: { available: false },
  content: {
    strategies: {
      find: (workspaceId) => contentStrategyApplication.find(workspaceId),
    },
    ideas: {
      list: (input) => contentIdeasApplication.list(input),
    },
    generation: {
      findRun: (input) => contentGenerationApplication.findRun(input),
      findIdea: (input) => contentGenerationApplication.findIdea(input),
      findAssetByIdea: (input) => contentGenerationApplication.findAssetByIdea(input),
    },
    publications: {
      list: (input) => contentPublicationApplication.list(input),
      find: (input) => contentPublicationApplication.find(input),
    },
    socialContent: {
      list: (input) => socialContentApplication.list(input),
      status: (input) => socialContentApplication.status(input),
    },
    socialEngagement: {
      list: (input) => socialEngagementApplication.list(input),
      status: (input) => socialEngagementApplication.status(input),
    },
    attribution: {
      listJourneys: (input) => attributionApplication.listJourneys(input),
    },
  },
  approvals: { available: false },
  operations: { contentPerformance: { get: (workspaceId) => contentPerformanceApplication.get(workspaceId) } },
  knowledge: { available: false },
};
const mcpTransport = createMcpTransport({
  capabilities: runtimeCapabilities,
  oauthResourceMetadataUrl: `${mcpIssuer}/.well-known/oauth-protected-resource`,
  allowedHosts: mcpAllowedHostsFromEnvironment(),
  allowedOrigins: commaSeparatedEnvironment(
    "MCP_ALLOWED_ORIGINS",
    commaSeparatedEnvironment("BETTER_AUTH_TRUSTED_ORIGINS", requiredEnvironment("BETTER_AUTH_URL")).join(","),
  ),
  authorize: async (request) => {
    const authorization = request.headers.get("authorization");
    if (authorization?.startsWith("Bearer ")) {
      try {
        await mcpOAuthService.authenticateMcpRequest({ accessToken: authorization.slice("Bearer ".length).trim(), resource: mcpResource, requiredScopes: ["mcp:read"] });
        return true;
      } catch {
        return false;
      }
    }
    const devToken = environment.MCP_DEV_AUTH_TOKEN;
    if (environment.NODE_ENV !== "production" && devToken !== undefined && devToken.length > 0 && request.headers.get("authorization") === `Bearer ${devToken}`) {
      return true;
    }
    if (environment.NODE_ENV === "production") return false;
    try {
      await auth.contextResolver.resolve(request);
      return true;
    } catch {
      return false;
    }
  },
});
const runtime = createNoosphereRuntime({
  capabilities: runtimeCapabilities,
  dispatch,
  auth: (request) => auth.handle(request),
  health: async () => {
    try {
      await database.client`select 1`;
      return { status: "ready" as const };
    } catch {
      return { status: "not_ready" as const };
    }
  },
  close: async () => {
    await mcpTransport.close();
    await database.close();
  },
});
function unavailableSocialPublisher(): SocialPublisher {
  const unavailable = () => Promise.reject(new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", "Unipile is not configured", "not_sent", true));
  return { observeCapabilities: unavailable, publishText: unavailable };
}

function unavailableSocialPublishingAccounts(): SocialPublishingAccountResolver {
  return { resolveLinkedin: () => Promise.reject(new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", "Unipile is not configured", "not_sent", true)) };
}
function requiredEnvironment(name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredSecretEnvironment(name: string): string {
  const value = requiredEnvironment(name);
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
}

function commaSeparatedEnvironment(name: string, fallback: string): string[] {
  return (environment[name] ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function mcpAllowedHostsFromEnvironment(): string[] {
  const configured = environment.MCP_ALLOWED_HOSTS;
  if (configured) return commaSeparatedEnvironment("MCP_ALLOWED_HOSTS", configured);
  const authUrl = requiredEnvironment("BETTER_AUTH_URL");
  try {
    return [new URL(authUrl).host];
  } catch {
    throw new Error("BETTER_AUTH_URL must be an absolute URL for MCP host validation");
  }
}

function securePublicOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("BETTER_AUTH_URL must be an absolute URL");
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("BETTER_AUTH_URL must use HTTPS outside localhost");
  }
  return parsed.origin;
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = environment[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function documentServiceOptionsFromEnvironment() {
  if (environment.DOCUMENT_EXTRACTOR?.toLowerCase() === "docling") {
    throw new Error("DOCUMENT_EXTRACTOR=docling is no longer supported; remove the legacy configuration");
  }
  return {
    bucket: requiredEnvironment("S3_BUCKET"),
    endpoint: requiredEnvironment("S3_ENDPOINT"),
    region: environment.S3_REGION ?? "us-east-1",
    accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
  };
}

function workspaceArchiveOptionsFromEnvironment() {
  return {
    bucket: requiredEnvironment("S3_BUCKET"),
    endpoint: requiredEnvironment("S3_ENDPOINT"),
    region: environment.S3_REGION ?? "us-east-1",
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
  return runtime;
}
