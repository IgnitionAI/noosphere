import { and, count, desc, eq, gt, gte, inArray, lte, or, sql } from "drizzle-orm";
import type {
  ActivityWorkspacePage,
  ActivityInteractionType,
  CampaignWorkspaceView,
  ConversationWorkspacePage,
  ConversationWorkspaceDetail,
  ConversationWorkspaceView,
  SetupReadinessView,
  NoosphereLens,
  WorkspaceOperationalSummary,
} from "@outbound/application/workspaces/operational-views";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  accountHealthAlerts,
  aiPolicyVersions,
  attributionTouches,
  calendarBookings,
  calendarConnections,
  campaigns,
  campaignProspects,
  connectedAccounts,
  contacts,
  conversations,
  contentAssets,
  contentGenerationRuns,
  contentIdeaDiscoveryRuns,
  contentIdeas,
  contentIdeaSchedules,
  contentPublications,
  socialContentItems,
  socialContentSyncStates,
  socialInteractions,
  socialInteractionSyncStates,
  dailyProspectingSchedules,
  editorialStrategies,
  editorialStrategyVersions,
  jobs,
  knowledgeSources,
  icpVersions,
  messages,
  offerVersions,
  opportunities,
  outreachActions,
  workspaceChannelAccounts,
  workspaceOnboarding,
} from "@outbound/infrastructure/database/schema";
import { PostgresCampaignAutopilotDashboard } from "@outbound/infrastructure/campaigns/postgres-campaign-autopilot-dashboard";
import { PostgresCampaignConversationRepository } from "@outbound/infrastructure/campaigns/postgres-campaign-conversation-repository";
import { PostgresCampaignRepository } from "@outbound/infrastructure/campaigns/postgres-campaign-repository";
import { PostgresOpportunityRepository } from "@outbound/infrastructure/pipeline/postgres-opportunity-repository";

export class PostgresOperationalViews {
  private readonly campaignsRepository: PostgresCampaignRepository;
  private readonly campaignDashboard: PostgresCampaignAutopilotDashboard;
  private readonly campaignConversations: PostgresCampaignConversationRepository;
  private readonly opportunitiesRepository: PostgresOpportunityRepository;

  constructor(private readonly database: Database) {
    this.campaignsRepository = new PostgresCampaignRepository(database);
    this.campaignDashboard = new PostgresCampaignAutopilotDashboard(database);
    this.campaignConversations = new PostgresCampaignConversationRepository(database);
    this.opportunitiesRepository = new PostgresOpportunityRepository(database);
  }

  async getSummary(workspaceId: string, input: { attentionOffset?: number; attentionLimit?: number } = {}): Promise<WorkspaceOperationalSummary> {
    const asOf = new Date();
    const attentionOffset = input.attentionOffset ?? 0;
    const attentionLimit = input.attentionLimit ?? 20;
    const attentionQueryLimit = attentionOffset + attentionLimit + 1;
    const activeJobCondition = or(
      and(eq(jobs.status, "running"), gt(jobs.lockedUntil, asOf)),
      and(inArray(jobs.status, ["pending", "retry"]), lte(jobs.availableAt, asOf)),
    );
    const [
      campaignCount,
      prospectCount,
      contactedProspectCount,
      publishedContentCount,
      conversationCount,
      opportunityCount,
      bookedCallCount,
      nextBooking,
      activeJobCount,
      jobsRows,
      failedJobs,
      schedule,
      accountRows,
      alertCount,
      accountAttention,
    ] = await Promise.all([
      this.database.select({ value: count() }).from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.status, "active"))),
      this.database.select({ value: count() }).from(contacts).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.status, "active"))),
      this.database.select({ value: sql<number>`count(distinct ${outreachActions.contactId})::int`.mapWith(Number) }).from(outreachActions).where(and(eq(outreachActions.workspaceId, workspaceId), sql`${outreachActions.sentAt} is not null`)),
      this.database.select({ value: count() }).from(contentPublications).where(and(eq(contentPublications.workspaceId, workspaceId), eq(contentPublications.status, "published"))),
      this.database.select({ value: count() }).from(conversations).where(and(eq(conversations.workspaceId, workspaceId), sql`${conversations.status} <> 'closed'`)),
      this.database.select({ value: count() }).from(opportunities).where(and(eq(opportunities.workspaceId, workspaceId), sql`${opportunities.stage} not in ('won', 'lost')`)),
      this.database.select({ value: count() }).from(calendarBookings).where(and(eq(calendarBookings.workspaceId, workspaceId), sql`${calendarBookings.status} in ('requested', 'booked', 'rescheduled')`, gte(calendarBookings.startAt, asOf))),
      this.database.select({ id: calendarBookings.id, attendeeName: calendarBookings.attendeeName, startAt: calendarBookings.startAt }).from(calendarBookings).where(and(eq(calendarBookings.workspaceId, workspaceId), sql`${calendarBookings.status} in ('requested', 'booked', 'rescheduled')`, gte(calendarBookings.startAt, asOf))).orderBy(calendarBookings.startAt).limit(1),
      this.database.select({ value: count() }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), activeJobCondition)),
      this.database.select({ id: jobs.id, type: jobs.type, status: jobs.status, correlationId: jobs.correlationId, updatedAt: jobs.updatedAt }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), activeJobCondition)).orderBy(desc(jobs.updatedAt)).limit(10),
      this.database.select({ value: count(), latestAt: sql<string | Date | null>`max(${jobs.updatedAt})` }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, "dead_lettered"))),
      this.database.select({ nextRunAt: dailyProspectingSchedules.nextRunAt }).from(dailyProspectingSchedules).where(and(eq(dailyProspectingSchedules.workspaceId, workspaceId), eq(dailyProspectingSchedules.enabled, true))).limit(1),
      this.database.select({ status: connectedAccounts.status }).from(connectedAccounts).where(eq(connectedAccounts.workspaceId, workspaceId)),
      this.database.select({ value: count() }).from(accountHealthAlerts).where(and(eq(accountHealthAlerts.workspaceId, workspaceId), sql`${accountHealthAlerts.status} in ('active', 'acknowledged')`)),
      this.database.select({ id: accountHealthAlerts.id, connectedAccountId: accountHealthAlerts.connectedAccountId, reason: accountHealthAlerts.reasonMessage, createdAt: accountHealthAlerts.createdAt }).from(accountHealthAlerts).where(and(eq(accountHealthAlerts.workspaceId, workspaceId), sql`${accountHealthAlerts.status} in ('active', 'acknowledged')`)).orderBy(desc(accountHealthAlerts.createdAt)).limit(attentionQueryLimit),
    ]);

    const failed = valueOf(failedJobs);
    const latestFailedValue = failedJobs[0]?.latestAt;
    const latestFailedAt = latestFailedValue instanceof Date
      ? latestFailedValue
      : latestFailedValue
        ? new Date(latestFailedValue)
        : asOf;
    const allAttention = [
      ...accountAttention.map((item) => attentionItem("account", "critical", item.id, item.reason ?? "Un compte d’envoi nécessite une reconnexion.", item.createdAt, "/settings/channels", null)),
      ...(failed > 0 ? [attentionItem(
        "job",
        "warning",
        "dead-lettered",
        `${failed} opération${failed === 1 ? "" : "s"} ${failed === 1 ? "a" : "ont"} atteint la limite de tentatives. Les autres automatisations continuent.`,
        latestFailedAt,
        "/settings/console?status=dead_lettered",
        null,
      )] : []),
    ].sort(compareAttention);
    const attentionPage = allAttention.slice(attentionOffset, attentionOffset + attentionLimit + 1);
    const hasMoreAttention = attentionPage.length > attentionLimit;
    const attention = attentionPage.slice(0, attentionLimit);
    const statuses = accountRows.map((row) => row.status);
    const [editorialRows, generationRows, activeGenerationRows, assetRows, readyAssetRows, publicationRows, socialRows, socialSyncRows, engagementSyncRows] = await Promise.all([
      this.database.select({
        id: editorialStrategies.id,
        status: editorialStrategies.status,
        currentVersion: editorialStrategies.currentVersion,
        updatedAt: editorialStrategies.updatedAt,
      }).from(editorialStrategies).where(and(
        eq(editorialStrategies.workspaceId, workspaceId),
        sql`${editorialStrategies.deletedAt} is null`,
      )).orderBy(desc(editorialStrategies.updatedAt)).limit(1),
      this.database.select({
        id: contentGenerationRuns.id,
        ideaId: contentGenerationRuns.ideaId,
        status: contentGenerationRuns.status,
        stage: contentGenerationRuns.stage,
        updatedAt: contentGenerationRuns.updatedAt,
      }).from(contentGenerationRuns).where(and(
        eq(contentGenerationRuns.workspaceId, workspaceId),
        sql`${contentGenerationRuns.status} in ('queued', 'running', 'blocked', 'failed')`,
      )).orderBy(desc(contentGenerationRuns.updatedAt)).limit(1),
      this.database.select({
        id: contentGenerationRuns.id,
        ideaId: contentGenerationRuns.ideaId,
        status: contentGenerationRuns.status,
        stage: contentGenerationRuns.stage,
        updatedAt: contentGenerationRuns.updatedAt,
      }).from(contentGenerationRuns).where(and(
        eq(contentGenerationRuns.workspaceId, workspaceId),
        sql`${contentGenerationRuns.status} in ('queued', 'running')`,
      )).orderBy(desc(contentGenerationRuns.updatedAt)).limit(1),
      this.database.select({
        id: contentAssets.id,
        ideaId: contentAssets.ideaId,
        status: contentAssets.status,
        updatedAt: contentAssets.updatedAt,
      }).from(contentAssets).where(eq(contentAssets.workspaceId, workspaceId)).orderBy(desc(contentAssets.updatedAt)).limit(1),
      this.database.select({
        id: contentAssets.id,
        ideaId: contentAssets.ideaId,
        status: contentAssets.status,
        updatedAt: contentAssets.updatedAt,
      }).from(contentAssets).where(and(
        eq(contentAssets.workspaceId, workspaceId),
        eq(contentAssets.status, "ready"),
      )).orderBy(desc(contentAssets.updatedAt)).limit(1),
      this.database.select({
        id: contentPublications.id,
        status: contentPublications.status,
        scheduledFor: contentPublications.scheduledFor,
        lastErrorCode: contentPublications.lastErrorCode,
        updatedAt: contentPublications.updatedAt,
      }).from(contentPublications).where(eq(contentPublications.workspaceId, workspaceId)).orderBy(desc(contentPublications.updatedAt)).limit(1),
      this.database.select({
        id: socialContentItems.id,
        origin: socialContentItems.origin,
        lastSeenAt: socialContentItems.lastSeenAt,
      }).from(socialContentItems).where(eq(socialContentItems.workspaceId, workspaceId)).orderBy(desc(socialContentItems.lastSeenAt)).limit(1),
      this.database.select({
        status: socialContentSyncStates.status,
        lastSuccessAt: socialContentSyncStates.lastSuccessAt,
        updatedAt: socialContentSyncStates.updatedAt,
      }).from(socialContentSyncStates).where(eq(socialContentSyncStates.workspaceId, workspaceId)).orderBy(desc(socialContentSyncStates.updatedAt)).limit(1),
      this.database.select({
        status: socialInteractionSyncStates.status,
        lastSuccessAt: socialInteractionSyncStates.lastSuccessAt,
        updatedAt: socialInteractionSyncStates.updatedAt,
      }).from(socialInteractionSyncStates).where(eq(socialInteractionSyncStates.workspaceId, workspaceId)).orderBy(desc(socialInteractionSyncStates.updatedAt)).limit(1),
    ]);
    const editorial = editorialRows[0];
    const generation = generationRows[0];
    const activeGeneration = activeGenerationRows[0];
    const latestAsset = assetRows[0];
    const readyAsset = readyAssetRows[0];
    const latestPublication = publicationRows[0];
    const latestSocial = socialRows[0];
    const latestSocialSync = socialSyncRows[0];
    const latestEngagementSync = engagementSyncRows[0];
    const connected = statuses.filter((status) => status === "connected").length;
    const degraded = statuses.filter((status) => status === "degraded" || status === "unknown" || status === "pending").length;
    const disconnected = statuses.filter((status) => status === "disconnected").length;
    const activeCampaigns = valueOf(campaignCount);
    const activeJobs = valueOf(activeJobCount);
    const attentionTotal = valueOf(alertCount) + (failed > 0 ? 1 : 0);
    const outboundStatus = degraded + disconnected + valueOf(alertCount) + failed > 0
      ? "degraded"
      : activeJobs > 0 || activeCampaigns > 0
        ? "running"
        : "idle";
    const lastJobActivity = jobsRows[0]?.updatedAt ?? null;
    const nextAutomaticResearch = schedule[0]?.nextRunAt ?? null;
    const nextOutcomes = [
      ...(nextAutomaticResearch ? [{
        id: "outbound:next-research",
        type: "research" as const,
        source: "outbound" as const,
        label: "Prochaine recherche de prospects",
        detail: "Les campagnes éligibles seront alimentées automatiquement.",
        expectedAt: nextAutomaticResearch,
        href: "/activity?lens=outbound",
      }] : []),
      ...(nextBooking[0] ? [{
        id: `call:${nextBooking[0].id}`,
        type: "call" as const,
        source: "unknown" as const,
        label: nextBooking[0].attendeeName ? `Appel avec ${nextBooking[0].attendeeName}` : "Prochain appel",
        detail: "Rendez-vous confirmé dans l’agenda connecté.",
        expectedAt: nextBooking[0].startAt,
        href: "/appointments",
      }] : []),
      ...(readyAsset ? [{
        id: `content:${readyAsset.id}`,
        type: "publication" as const,
        source: "inbound" as const,
        label: "Contenu LinkedIn prêt",
        detail: "Le brief, les preuves et la critique éditoriale sont disponibles.",
        expectedAt: null,
        href: `/content/ideas/${readyAsset.ideaId}`,
      }] : []),
      ...(latestPublication && ["scheduled", "retry"].includes(latestPublication.status) ? [{
        id: `publication:${latestPublication.id}`,
        type: "publication" as const,
        source: "inbound" as const,
        label: latestPublication.status === "retry" ? "Nouvelle tentative LinkedIn" : "Prochaine publication LinkedIn",
        detail: "Le texte, la policy et le compte sont figés dans un snapshot durable.",
        expectedAt: latestPublication.scheduledFor,
        href: "/content/calendar",
      }] : []),
    ].sort((left, right) => (left.expectedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.expectedAt?.getTime() ?? Number.MAX_SAFE_INTEGER));
    const providerDegraded = latestPublication?.status === "unknown"
      || latestPublication?.status === "failed"
      || latestSocialSync?.status === "error"
      || latestEngagementSync?.status === "error";
    const inboundRunning = Boolean(activeGeneration)
      || latestPublication?.status === "publishing"
      || latestSocialSync?.status === "syncing"
      || latestEngagementSync?.status === "syncing";
    const contentUnavailable = !readyAsset
      && (generation?.status === "blocked" || generation?.status === "failed" || latestAsset?.status === "blocked");
    const inboundStatus = !editorial
      ? "not_configured"
      : providerDegraded
        ? "degraded"
        : inboundRunning
          ? "running"
          : contentUnavailable
            ? "degraded"
          : editorial.status === "active"
            ? "idle"
            : "paused";
    const inboundLastActivity = mostRecent(latestSocial?.lastSeenAt, latestSocialSync?.lastSuccessAt, latestEngagementSync?.lastSuccessAt, latestPublication?.updatedAt, activeGeneration?.updatedAt, generation?.updatedAt, latestAsset?.updatedAt, editorial?.updatedAt);
    return {
      asOf,
      counts: {
        activeCampaigns,
        prospects: valueOf(prospectCount),
        contactedProspects: valueOf(contactedProspectCount),
        publishedContents: valueOf(publishedContentCount),
        openConversations: valueOf(conversationCount),
        openOpportunities: valueOf(opportunityCount),
        bookedCalls: valueOf(bookedCallCount),
        attention: attentionTotal,
      },
      attention,
      jobs: {
        active: activeJobs,
        failed,
        running: jobsRows.map((job) => ({ id: job.id, type: job.type, status: job.status, updatedAt: job.updatedAt })),
      },
      nextAutomaticResearch,
      accountHealth: { connected, degraded, disconnected, activeAlerts: valueOf(alertCount) },
      engines: {
        inbound: {
          status: inboundStatus,
          label: inboundStatus === "running" ? (latestSocialSync?.status === "syncing" || latestEngagementSync?.status === "syncing" ? "Inbound synchronise LinkedIn" : latestPublication?.status === "publishing" ? "Inbound publie sur LinkedIn" : "Inbound génère un contenu") : inboundStatus === "degraded" ? "Inbound nécessite une attention" : editorial ? (editorial.status === "active" ? "Inbound prêt" : "Stratégie Inbound en brouillon") : "Inbound à configurer",
          summary: !editorial
            ? "Une offre publiée et un ICP actif sont requis pour dériver la stratégie."
            : latestSocialSync?.status === "error" || latestEngagementSync?.status === "error"
              ? "La lecture du compte ou de ses engagements LinkedIn a échoué et sera retentée automatiquement."
            : latestPublication?.status === "unknown"
              ? "Le résultat LinkedIn est incertain : la publication attend une réconciliation et ne sera pas rejouée."
              : latestPublication?.status === "failed"
                ? `La dernière publication a échoué${latestPublication.lastErrorCode ? ` · ${latestPublication.lastErrorCode}` : ""}.`
            : latestPublication?.status === "publishing"
                  ? "Publication LinkedIn en cours avec lease durable."
                  : activeGeneration
                    ? `Pipeline éditorial à l’étape ${contentStageLabel(activeGeneration.stage)} · reprise durable active.`
                  : latestSocial
                    ? `LinkedIn synchronisé · dernier post ${latestSocial.origin === "internal" ? "Noosphere" : "externe"} observé.`
                  : readyAsset
                ? `Stratégie LinkedIn v${editorial.currentVersion || "brouillon"} · un contenu sourcé est prêt.`
                : contentUnavailable
                  ? "La critique ou l’audit des preuves a bloqué le dernier contenu."
                  : `Stratégie LinkedIn v${editorial.currentVersion || "brouillon"} · le pipeline éditorial attend sa prochaine étape.`,
          lastActivityAt: inboundLastActivity,
          nextAction: latestSocialSync?.status === "error" || latestEngagementSync?.status === "error"
            ? { label: "Voir la synchronisation", href: "/content/calendar" }
            : latestPublication && ["scheduled", "retry", "publishing", "unknown", "failed"].includes(latestPublication.status)
            ? { label: latestPublication.status === "unknown" || latestPublication.status === "failed" ? "Voir l’exception" : "Voir le calendrier", href: "/content/calendar" }
            : activeGeneration
            ? { label: "Suivre la génération", href: `/content/ideas/${activeGeneration.ideaId}` }
            : contentUnavailable && generation
              ? { label: "Voir le blocage", href: `/content/ideas/${generation.ideaId}` }
            : readyAsset
              ? { label: "Voir le contenu", href: `/content/ideas/${readyAsset.ideaId}` }
              : latestAsset
                ? { label: "Voir le contenu", href: `/content/ideas/${latestAsset.ideaId}` }
              : editorial
                ? { label: "Voir les idées", href: "/content/ideas" }
                : { label: "Vérifier la configuration", href: "/settings" },
        },
        outbound: {
          status: outboundStatus,
          label: outboundStatus === "degraded" ? "Outbound nécessite une attention" : outboundStatus === "running" ? "Outbound actif" : "Outbound en veille",
          summary: `${activeCampaigns} campagne${activeCampaigns === 1 ? "" : "s"} active${activeCampaigns === 1 ? "" : "s"} · ${activeJobs} job${activeJobs === 1 ? "" : "s"} en cours`,
          lastActivityAt: lastJobActivity,
          nextAction: outboundStatus === "degraded" ? { label: "Voir les exceptions", href: "/?attention=1" } : { label: "Voir l’activité", href: "/activity?lens=outbound" },
        },
      },
      nextOutcomes,
      attentionPagination: { nextCursor: hasMoreAttention ? String(attentionOffset + attentionLimit) : null },
    };
  }

  async getActivity(input: { workspaceId: string; lens: NoosphereLens; interactionType?: ActivityInteractionType; offset?: number; limit?: number }): Promise<ActivityWorkspacePage> {
    const asOf = new Date();
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 25;
    if (input.lens === "inbound") {
      const [strategies, versions, ideaCount, ideas, ideaRuns, schedule, assetCount, readyAssetCount, assetRows, generationRows, publicationCount, publicationRows, socialCount, socialRows, socialSyncRows, interactionCount, interactionRows, interactionSyncRows] = await Promise.all([
        this.database.select({
          id: editorialStrategies.id,
          name: editorialStrategies.name,
          status: editorialStrategies.status,
          currentVersion: editorialStrategies.currentVersion,
          model: editorialStrategies.model,
          updatedAt: editorialStrategies.updatedAt,
        }).from(editorialStrategies).where(and(
          eq(editorialStrategies.workspaceId, input.workspaceId),
          sql`${editorialStrategies.deletedAt} is null`,
        )).orderBy(desc(editorialStrategies.updatedAt)).limit(limit + 1).offset(offset),
        this.database.select({ value: count() }).from(editorialStrategyVersions).where(eq(editorialStrategyVersions.workspaceId, input.workspaceId)),
        this.database.select({ value: count() }).from(contentIdeas).where(and(eq(contentIdeas.workspaceId, input.workspaceId), sql`${contentIdeas.status} not in ('discarded', 'expired')`)),
        this.database.select({ id: contentIdeas.id, angle: contentIdeas.angle, pillar: contentIdeas.pillar, priority: contentIdeas.priority, updatedAt: contentIdeas.updatedAt }).from(contentIdeas).where(eq(contentIdeas.workspaceId, input.workspaceId)).orderBy(desc(contentIdeas.lastSeenAt)).limit(limit + 1).offset(offset),
        this.database.select({ id: contentIdeaDiscoveryRuns.id, status: contentIdeaDiscoveryRuns.status, cursor: contentIdeaDiscoveryRuns.cursor, queryLimit: contentIdeaDiscoveryRuns.queryLimit, updatedAt: contentIdeaDiscoveryRuns.updatedAt }).from(contentIdeaDiscoveryRuns).where(and(eq(contentIdeaDiscoveryRuns.workspaceId, input.workspaceId), sql`${contentIdeaDiscoveryRuns.status} in ('queued', 'running', 'failed')`)).orderBy(desc(contentIdeaDiscoveryRuns.updatedAt)).limit(5),
        this.database.select({
          enabled: contentIdeaSchedules.enabled,
          nextRunAt: contentIdeaSchedules.nextRunAt,
        }).from(contentIdeaSchedules).where(eq(contentIdeaSchedules.workspaceId, input.workspaceId)).limit(1),
        this.database.select({ value: count() }).from(contentAssets).where(eq(contentAssets.workspaceId, input.workspaceId)),
        this.database.select({ value: count() }).from(contentAssets).where(and(eq(contentAssets.workspaceId, input.workspaceId), eq(contentAssets.status, "ready"))),
        this.database.select({ id: contentAssets.id, ideaId: contentAssets.ideaId, status: contentAssets.status, latestVersion: contentAssets.latestVersion, angle: contentIdeas.angle, updatedAt: contentAssets.updatedAt }).from(contentAssets).innerJoin(contentIdeas, and(eq(contentIdeas.workspaceId, contentAssets.workspaceId), eq(contentIdeas.id, contentAssets.ideaId))).where(eq(contentAssets.workspaceId, input.workspaceId)).orderBy(desc(contentAssets.updatedAt)).limit(limit),
        this.database.select({ id: contentGenerationRuns.id, ideaId: contentGenerationRuns.ideaId, status: contentGenerationRuns.status, stage: contentGenerationRuns.stage, angle: contentIdeas.angle, updatedAt: contentGenerationRuns.updatedAt }).from(contentGenerationRuns).innerJoin(contentIdeas, and(eq(contentIdeas.workspaceId, contentGenerationRuns.workspaceId), eq(contentIdeas.id, contentGenerationRuns.ideaId))).where(and(eq(contentGenerationRuns.workspaceId, input.workspaceId), sql`${contentGenerationRuns.status} in ('queued', 'running', 'blocked', 'failed')`)).orderBy(desc(contentGenerationRuns.updatedAt)).limit(limit),
        this.database.select({ value: count() }).from(contentPublications).where(eq(contentPublications.workspaceId, input.workspaceId)),
        this.database.select({ id: contentPublications.id, status: contentPublications.status, scheduledFor: contentPublications.scheduledFor, attempts: contentPublications.attempts, maxAttempts: contentPublications.maxAttempts, lastErrorCode: contentPublications.lastErrorCode, updatedAt: contentPublications.updatedAt }).from(contentPublications).where(eq(contentPublications.workspaceId, input.workspaceId)).orderBy(desc(contentPublications.updatedAt)).limit(limit),
        this.database.select({ value: count() }).from(socialContentItems).where(eq(socialContentItems.workspaceId, input.workspaceId)),
        this.database.select({ id: socialContentItems.id, origin: socialContentItems.origin, text: socialContentItems.text, impressions: socialContentItems.impressions, reactions: socialContentItems.reactions, comments: socialContentItems.comments, metricsObservedAt: socialContentItems.metricsObservedAt, lastSeenAt: socialContentItems.lastSeenAt }).from(socialContentItems).where(eq(socialContentItems.workspaceId, input.workspaceId)).orderBy(desc(socialContentItems.lastSeenAt)).limit(limit),
        this.database.select({ id: socialContentSyncStates.id, status: socialContentSyncStates.status, lastErrorCode: socialContentSyncStates.lastErrorCode, updatedAt: socialContentSyncStates.updatedAt }).from(socialContentSyncStates).where(eq(socialContentSyncStates.workspaceId, input.workspaceId)).orderBy(desc(socialContentSyncStates.updatedAt)).limit(5),
        this.database.select({ value: count() }).from(socialInteractions).where(and(eq(socialInteractions.workspaceId, input.workspaceId), eq(socialInteractions.status, "observed"))),
        this.database.select({ id: socialInteractions.id, type: socialInteractions.type, direction: socialInteractions.direction, actorName: socialInteractions.actorName, body: socialInteractions.body, reaction: socialInteractions.reaction, occurredAt: socialInteractions.occurredAt, lastSeenAt: socialInteractions.lastSeenAt, postText: socialContentItems.text }).from(socialInteractions).innerJoin(socialContentItems, and(eq(socialContentItems.workspaceId, socialInteractions.workspaceId), eq(socialContentItems.id, socialInteractions.socialContentId))).where(and(
          eq(socialInteractions.workspaceId, input.workspaceId),
          eq(socialInteractions.status, "observed"),
          ...(input.interactionType ? [eq(socialInteractions.type, input.interactionType)] : []),
        )).orderBy(desc(socialInteractions.lastSeenAt), desc(socialInteractions.id)).limit(input.interactionType ? limit + 1 : limit).offset(input.interactionType ? offset : 0),
        this.database.select({ id: socialInteractionSyncStates.id, status: socialInteractionSyncStates.status, lastErrorCode: socialInteractionSyncStates.lastErrorCode, updatedAt: socialInteractionSyncStates.updatedAt }).from(socialInteractionSyncStates).where(eq(socialInteractionSyncStates.workspaceId, input.workspaceId)).orderBy(desc(socialInteractionSyncStates.updatedAt)).limit(5),
      ]);
      const hasNext = input.interactionType ? interactionRows.length > limit : ideas.length > limit;
      const interactionItems = interactionRows.slice(0, limit).map((interaction) => ({
        id: `social-interaction:${interaction.id}`,
        kind: "signal" as const,
        source: "inbound" as const,
        status: "completed" as const,
        title: socialInteractionTitle(interaction.type, interaction.direction, interaction.actorName),
        detail: `${interaction.body ?? interaction.reaction ?? "Interaction observée"} · sur « ${unicodeExcerpt(interaction.postText, 80)} »`,
        occurredAt: interaction.occurredAt ?? interaction.lastSeenAt,
        href: "/content/calendar",
        correlationId: null,
      }));
      const items = input.interactionType ? interactionItems : [
        ...interactionSyncRows.filter((state) => state.status === "error" || state.status === "syncing").map((state) => ({
          id: `engagement-sync:${state.id}`,
          kind: "job" as const,
          source: "inbound" as const,
          status: state.status === "error" ? "attention" as const : "running" as const,
          title: state.status === "error" ? "Lecture des engagements LinkedIn en attente" : "Lecture des engagements LinkedIn en cours",
          detail: state.status === "error" ? `${state.lastErrorCode ?? "Erreur provider"} · aucune action automatique déclenchée` : "Commentaires, réponses et réactions · curseur durable",
          occurredAt: state.updatedAt,
          href: "/content/calendar",
          correlationId: `engagement-sync:${state.id}`,
        })),
        ...interactionItems,
        ...socialSyncRows.filter((state) => state.status === "error" || state.status === "syncing").map((state) => ({
          id: `social-sync:${state.id}`,
          kind: "job" as const,
          source: "inbound" as const,
          status: state.status === "error" ? "attention" as const : "running" as const,
          title: state.status === "error" ? "Synchronisation LinkedIn en attente" : "Synchronisation LinkedIn en cours",
          detail: state.status === "error" ? `${state.lastErrorCode ?? "Erreur provider"} · nouvelle tentative automatique` : "Lecture des posts et métriques avec curseur durable",
          occurredAt: state.updatedAt,
          href: "/content/calendar",
          correlationId: `social-sync:${state.id}`,
        })),
        ...socialRows.map((post) => ({
          id: `social-post:${post.id}`,
          kind: "publication" as const,
          source: "inbound" as const,
          status: "completed" as const,
          title: post.origin === "internal" ? "Post Noosphere observé sur LinkedIn" : "Post externe observé sur LinkedIn",
          detail: `${unicodeExcerpt(post.text, 120)} · ${post.impressions ?? "—"} impressions · ${post.reactions ?? "—"} réactions · ${post.comments ?? "—"} commentaires${post.metricsObservedAt ? " · métriques actualisées" : ""}`,
          occurredAt: post.lastSeenAt,
          href: "/content/calendar",
          correlationId: null,
        })),
        ...publicationRows.map((publication) => ({
          id: `publication:${publication.id}`,
          kind: "publication" as const,
          source: "inbound" as const,
          status: publication.status === "unknown" || publication.status === "failed" ? "attention" as const : publication.status === "published" || publication.status === "cancelled" ? "completed" as const : publication.status === "publishing" ? "running" as const : "pending" as const,
          title: publication.status === "published" ? "Publication LinkedIn publiée" : publication.status === "unknown" ? "Publication LinkedIn à réconcilier" : publication.status === "failed" ? "Publication LinkedIn en échec" : "Publication LinkedIn planifiée",
          detail: `${publication.attempts}/${publication.maxAttempts} tentative${publication.maxAttempts === 1 ? "" : "s"} · ${publication.status === "scheduled" || publication.status === "retry" ? `prévue ${publication.scheduledFor.toISOString()}` : publication.lastErrorCode ?? "snapshot durable"}`,
          occurredAt: publication.updatedAt,
          href: "/content/calendar",
          correlationId: `content-publication:${publication.id}`,
        })),
        ...generationRows.map((run) => ({
          id: `content-run:${run.id}`,
          kind: "publication" as const,
          source: "inbound" as const,
          status: run.status === "blocked" || run.status === "failed" ? "attention" as const : "running" as const,
          title: run.status === "blocked" || run.status === "failed" ? `Contenu bloqué · ${run.angle}` : `Rédaction en cours · ${run.angle}`,
          detail: `${contentStageLabel(run.stage)} · checkpoint durable · aucune publication déclenchée`,
          occurredAt: run.updatedAt,
          href: `/content/ideas/${run.ideaId}`,
          correlationId: `content-generation:${run.id}`,
        })),
        ...assetRows.map((asset) => ({
          id: `content-asset:${asset.id}`,
          kind: "publication" as const,
          source: "inbound" as const,
          status: asset.status === "blocked" ? "attention" as const : asset.status === "ready" ? "completed" as const : "pending" as const,
          title: asset.angle,
          detail: asset.status === "ready" ? `Contenu v${asset.latestVersion} sourcé et critiqué · prêt sans être publié` : asset.status === "blocked" ? "Contenu bloqué par l’audit ou la critique" : "Brouillon éditorial en préparation",
          occurredAt: asset.updatedAt,
          href: `/content/ideas/${asset.ideaId}`,
          correlationId: null,
        })),
        ...ideaRuns.map((run) => ({
          id: `idea-run:${run.id}`,
          kind: "job" as const,
          source: "inbound" as const,
          status: run.status === "failed" ? "attention" as const : "running" as const,
          title: run.status === "failed" ? "Recherche d’idées en erreur" : "Recherche d’idées en cours",
          detail: `${run.cursor}/${run.queryLimit} requêtes traitées · reprise automatique durable`,
          occurredAt: run.updatedAt,
          href: "/content/ideas",
          correlationId: `content-ideas:${run.id}`,
        })),
        ...ideas.slice(0, limit).map((idea) => ({
          id: `idea:${idea.id}`,
          kind: "publication" as const,
          source: "inbound" as const,
          status: "completed" as const,
          title: idea.angle,
          detail: `${idea.pillar} · priorité ${idea.priority}/100 · preuves résolubles`,
          occurredAt: idea.updatedAt,
          href: "/content/ideas",
          correlationId: null,
        })),
        ...strategies.slice(0, 1).map((strategy) => ({
        id: `strategy:${strategy.id}`,
        kind: "publication" as const,
        source: "inbound" as const,
        status: strategy.status === "active" ? "completed" as const : "pending" as const,
        title: strategy.name,
        detail: `${strategy.currentVersion > 0 ? `Version ${strategy.currentVersion} active` : "Brouillon dérivé"} · réflexion ${strategy.model}`,
        occurredAt: strategy.updatedAt,
        href: "/content/strategy",
        correlationId: null,
        })),
      ].slice(0, limit);
      const contentUnavailable = valueOf(readyAssetCount) === 0
        && generationRows.some((run) => run.status === "failed" || run.status === "blocked");
      const failed = ideaRuns.some((run) => run.status === "failed")
        || contentUnavailable
        || publicationRows.some((publication) => publication.status === "failed" || publication.status === "unknown")
        || socialSyncRows.some((state) => state.status === "error")
        || interactionSyncRows.some((state) => state.status === "error");
      const running = ideaRuns.some((run) => run.status === "running" || run.status === "queued") || generationRows.some((run) => run.status === "running" || run.status === "queued") || publicationRows.some((publication) => publication.status === "publishing") || socialSyncRows.some((state) => state.status === "syncing") || interactionSyncRows.some((state) => state.status === "syncing");
      return {
        lens: input.lens,
        asOf,
        state: strategies.length ? (failed ? "attention" : running ? "active" : strategies[0]!.status === "active" ? "idle" : "attention") : "not_configured",
        quality: failed ? "partial" : "fresh",
        headline: strategies.length
          ? schedule[0] && !schedule[0].enabled
            ? "L’Inbound est en pause : aucune nouvelle recherche ni publication automatique ne sera lancée."
            : running
              ? "Noosphere recherche, rédige ou publie actuellement un contenu LinkedIn."
              : schedule[0]?.enabled
              ? "L’Inbound est actif : Noosphere prépare les contenus puis les publie selon la cadence définie."
              : "La stratégie est prête : démarrez l’Inbound pour rechercher, rédiger et publier automatiquement."
          : "Publiez une offre et un ICP pour dériver la stratégie Inbound.",
        counters: [
          { key: "strategies", label: "Stratégies", value: strategies.length },
          { key: "versions", label: "Versions publiées", value: valueOf(versions) },
          { key: "ideas", label: "Idées sourcées", value: valueOf(ideaCount) },
          { key: "assets", label: "Contenus", value: valueOf(assetCount) },
          { key: "publications", label: "Publications", value: valueOf(publicationCount) },
          { key: "observed-posts", label: "Posts observés", value: valueOf(socialCount) },
          { key: "interactions", label: "Engagements", value: valueOf(interactionCount) },
        ],
        items,
        pagination: { nextCursor: hasNext ? String(offset + limit) : null },
      };
    }
    if (input.lens === "symbiosis") return this.#getSymbiosisActivity({ workspaceId: input.workspaceId, lens: "symbiosis", offset, limit, asOf });
    const summary = await this.getSummary(input.workspaceId, { attentionLimit: 1 });
    const rows = await this.database.select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      channel: campaigns.channel,
      prospectCount: campaigns.prospectCount,
      automationStage: campaigns.automationStage,
      updatedAt: campaigns.updatedAt,
    }).from(campaigns).where(eq(campaigns.workspaceId, input.workspaceId)).orderBy(desc(campaigns.updatedAt)).limit(limit + 1).offset(offset);
    const hasNext = rows.length > limit;
    const items = rows.slice(0, limit).map((campaign) => ({
      id: `campaign:${campaign.id}`,
      kind: "campaign" as const,
      source: "outbound" as const,
      status: campaign.automationStage === "attention"
        ? "attention" as const
        : campaign.status === "active"
          ? "running" as const
          : "completed" as const,
      title: campaign.name,
      detail: `${campaign.channel} · ${campaign.prospectCount} prospect${campaign.prospectCount === 1 ? "" : "s"} · ${campaignStageLabel(campaign.automationStage)}`,
      occurredAt: campaign.updatedAt,
      href: `/campaigns/${campaign.id}`,
      correlationId: null,
    }));
    return {
      lens: input.lens,
      asOf,
      state: summary.engines.outbound.status === "degraded" ? "attention" : summary.engines.outbound.status === "running" ? "active" : "idle",
      quality: summary.engines.outbound.status === "degraded" ? "partial" : "fresh",
      headline: summary.engines.outbound.summary,
      counters: [
        { key: "campaigns", label: "Campagnes actives", value: summary.counts.activeCampaigns },
        { key: "prospects", label: "Prospects", value: summary.counts.prospects },
        { key: "jobs", label: "Jobs en cours", value: summary.jobs.active },
        { key: "conversations", label: "Conversations", value: summary.counts.openConversations },
      ],
      items,
      pagination: { nextCursor: hasNext ? String(offset + limit) : null },
    };
  }

  async #getSymbiosisActivity(input: { workspaceId: string; lens: "symbiosis"; offset: number; limit: number; asOf: Date }): Promise<ActivityWorkspacePage> {
    const [rows, statsRows, contentRows, syncRows] = await Promise.all([
      this.database.select({
        id: socialInteractions.id,
        type: socialInteractions.type,
        actorName: socialInteractions.actorName,
        body: socialInteractions.body,
        reaction: socialInteractions.reaction,
        occurredAt: socialInteractions.occurredAt,
        lastSeenAt: socialInteractions.lastSeenAt,
        postText: socialContentItems.text,
        identityId: attributionTouches.id,
        identityContactId: attributionTouches.contactId,
        identityRule: attributionTouches.rule,
        identityConfidence: attributionTouches.confidence,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
      }).from(socialInteractions)
        .innerJoin(socialContentItems, and(
          eq(socialContentItems.workspaceId, socialInteractions.workspaceId),
          eq(socialContentItems.id, socialInteractions.socialContentId),
        ))
        .leftJoin(attributionTouches, and(
          eq(attributionTouches.workspaceId, socialInteractions.workspaceId),
          eq(attributionTouches.socialInteractionId, socialInteractions.id),
          eq(attributionTouches.logicalKey, "identity"),
          eq(attributionTouches.status, "active"),
        ))
        .leftJoin(contacts, and(
          eq(contacts.workspaceId, attributionTouches.workspaceId),
          eq(contacts.id, attributionTouches.contactId),
        ))
        .where(and(
          eq(socialInteractions.workspaceId, input.workspaceId),
          eq(socialInteractions.status, "observed"),
          sql`${socialInteractions.direction} <> 'owner'`,
        ))
        .orderBy(desc(socialInteractions.lastSeenAt), desc(socialInteractions.id))
        .limit(input.limit + 1)
        .offset(input.offset),
      this.database.execute<SymbiosisStatsRow>(sql`
        SELECT
          count(distinct i.id) FILTER (WHERE i.type <> 'reaction')::int AS explicit_signals,
          count(distinct i.id) FILTER (WHERE identity.contact_id IS NOT NULL)::int AS resolved_identities,
          count(distinct destinations.conversation_id)::int AS conversations,
          count(distinct destinations.booking_id)::int AS calls,
          count(distinct i.id) FILTER (WHERE identity.id IS NULL OR identity.contact_id IS NULL)::int AS unresolved
        FROM social_interactions i
        LEFT JOIN attribution_touches identity
          ON identity.workspace_id = i.workspace_id
         AND identity.social_interaction_id = i.id
         AND identity.logical_key = 'identity'
         AND identity.status = 'active'
        LEFT JOIN attribution_touches destinations
          ON destinations.workspace_id = i.workspace_id
         AND destinations.social_interaction_id = i.id
         AND destinations.status = 'active'
        WHERE i.workspace_id = ${input.workspaceId}
          AND i.status = 'observed'
          AND i.direction <> 'owner'
      `),
      this.database.select({ value: count() }).from(socialContentItems).where(eq(socialContentItems.workspaceId, input.workspaceId)),
      this.database.select({
        status: socialInteractionSyncStates.status,
        lastSuccessAt: socialInteractionSyncStates.lastSuccessAt,
      }).from(socialInteractionSyncStates).where(eq(socialInteractionSyncStates.workspaceId, input.workspaceId)),
    ]);
    const hasNext = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const interactionIds = page.map((row) => row.id);
    const destinationRows = interactionIds.length ? await this.database.select({
      interactionId: attributionTouches.socialInteractionId,
      kind: attributionTouches.kind,
      certainty: attributionTouches.certainty,
    }).from(attributionTouches).where(and(
      eq(attributionTouches.workspaceId, input.workspaceId),
      inArray(attributionTouches.socialInteractionId, interactionIds),
      eq(attributionTouches.status, "active"),
      sql`${attributionTouches.kind} <> 'identity'`,
    )) : [];
    const destinations = new Map<string, Array<{ kind: string; certainty: string }>>();
    for (const destination of destinationRows) {
      const values = destinations.get(destination.interactionId) ?? [];
      values.push({ kind: destination.kind, certainty: destination.certainty });
      destinations.set(destination.interactionId, values);
    }
    const stats = statsRows[0];
    const explicitSignals = Number(stats?.explicit_signals ?? 0);
    const resolvedIdentities = Number(stats?.resolved_identities ?? 0);
    const conversationCount = Number(stats?.conversations ?? 0);
    const callCount = Number(stats?.calls ?? 0);
    const unresolved = Number(stats?.unresolved ?? 0);
    const configured = valueOf(contentRows) > 0;
    const syncError = syncRows.some((row) => row.status === "error");
    const syncing = syncRows.some((row) => row.status === "syncing");
    const stale = syncRows.length > 0 && !syncing && syncRows.some((row) => !row.lastSuccessAt || input.asOf.getTime() - row.lastSuccessAt.getTime() > 24 * 60 * 60_000);
    const quality = syncError || unresolved > 0 ? "partial" as const : stale ? "stale" as const : "fresh" as const;
    const items = page.map((row) => {
      const related = destinations.get(row.id) ?? [];
      const hasConversation = related.some((touch) => touch.kind === "conversation");
      const hasCampaign = related.some((touch) => touch.kind === "campaign");
      const hasCall = related.some((touch) => touch.kind === "booking");
      const ambiguous = row.identityRule?.startsWith("ambiguous_") ?? false;
      const resolved = Boolean(row.identityContactId);
      const pending = !row.identityId;
      const contactName = [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ") || row.actorName;
      return {
        id: `symbiosis:${row.id}`,
        kind: "signal" as const,
        source: hasCampaign ? "mixed" as const : "inbound" as const,
        status: pending ? "running" as const : resolved ? "completed" as const : "attention" as const,
        title: symbiosisSignalTitle(row.type, contactName, resolved, ambiguous),
        detail: symbiosisSignalDetail({
          type: row.type,
          postText: row.postText,
          confidence: Number(row.identityConfidence ?? 0),
          resolved,
          ambiguous,
          pending,
          hasConversation,
          hasCall,
        }),
        occurredAt: row.occurredAt ?? row.lastSeenAt,
        href: `/attribution?interactionId=${row.id}`,
        correlationId: null,
      };
    }).sort((left, right) => activityPriority(left.status) - activityPriority(right.status) || right.occurredAt.getTime() - left.occurredAt.getTime());
    const state = !configured && explicitSignals === 0 && unresolved === 0
      ? "not_configured" as const
      : syncError || unresolved > 0
        ? "attention" as const
        : syncing || explicitSignals > 0
          ? "active" as const
          : "idle" as const;
    return {
      lens: input.lens,
      asOf: input.asOf,
      state,
      quality,
      headline: state === "not_configured"
        ? "La Symbiose s’activera après la première publication LinkedIn observable."
        : syncError
          ? "Les interactions brutes sont conservées ; les attributions disponibles restent partielles."
          : stale
            ? "La dernière lecture LinkedIn est ancienne ; aucune activation n’est déduite de données périmées."
            : unresolved > 0
              ? `${unresolved} identité${unresolved === 1 ? " reste" : "s restent"} à résoudre sans fusion faible.`
              : resolvedIdentities > 0
                ? `${resolvedIdentities} identité${resolvedIdentities === 1 ? " résolue" : "s résolues"} relie le contenu aux suites réellement observées.`
                : "Inbound et Outbound continuent ; aucun signal partagé n’est encore attribuable.",
      counters: [
        { key: "explicit-signals", label: "Signaux explicites", value: explicitSignals },
        { key: "resolved-identities", label: "Identités résolues", value: resolvedIdentities },
        { key: "conversations", label: "Conversations reliées", value: conversationCount },
        { key: "calls", label: "Appels attribués", value: callCount },
      ],
      items,
      pagination: { nextCursor: hasNext ? String(input.offset + input.limit) : null },
    };
  }

  async getSetupReadiness(workspaceId: string): Promise<SetupReadinessView> {
    const [products, icps, channels, policies, calendars, knowledge, onboarding] = await Promise.all([
      this.database.select({ value: count() }).from(offerVersions).where(eq(offerVersions.workspaceId, workspaceId)),
      this.database.select({ value: count() }).from(icpVersions).where(eq(icpVersions.workspaceId, workspaceId)),
      this.database.select({ channel: workspaceChannelAccounts.channel }).from(workspaceChannelAccounts).innerJoin(connectedAccounts, and(eq(connectedAccounts.workspaceId, workspaceChannelAccounts.workspaceId), eq(connectedAccounts.provider, workspaceChannelAccounts.provider), eq(connectedAccounts.providerAccountId, workspaceChannelAccounts.providerAccountId), eq(connectedAccounts.status, "connected"))).where(eq(workspaceChannelAccounts.workspaceId, workspaceId)),
      this.database.select({ value: count() }).from(aiPolicyVersions).where(eq(aiPolicyVersions.workspaceId, workspaceId)),
      this.database.select({ value: count() }).from(calendarConnections).where(and(eq(calendarConnections.workspaceId, workspaceId), eq(calendarConnections.status, "active"))),
      this.database.select({ value: count() }).from(knowledgeSources).where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.status, "validated"))),
      this.database.select({ step: workspaceOnboarding.step, status: workspaceOnboarding.status }).from(workspaceOnboarding).where(eq(workspaceOnboarding.workspaceId, workspaceId)),
    ]);
    const productReady = valueOf(products) > 0;
    const icpReady = valueOf(icps) > 0;
    const accountChannels = new Set(channels.map((row) => row.channel));
    const accountsReady = accountChannels.has("linkedin") || accountChannels.has("email") || accountChannels.has("whatsapp");
    const automationReady = valueOf(policies) > 0;
    const calendarReady = valueOf(calendars) > 0;
    const knowledgeReady = valueOf(knowledge) > 0;
    const items = [
      readiness("product", "Produit et offre", productReady, "Définissez l’offre utilisée pour qualifier et rédiger.", "/offers", true),
      readiness("icp", "ICP actif", icpReady, "Publiez au moins un ICP avant de lancer une campagne.", "/icps", true),
      readiness("accounts", "Comptes d’envoi", accountsReady, "Connectez au moins un compte LinkedIn, email ou WhatsApp.", "/settings/channels", true),
      readiness("automation", "Automatisation", automationReady, "La policy Setter définit ce que l’automatisation peut faire.", "/settings/automation", true),
      readiness("calendar", "Agenda", calendarReady, "Un agenda permet de proposer et réconcilier les rendez-vous.", "/settings/calendar", false, calendarReady ? "Agenda connecté." : undefined),
      readiness("knowledge", "Connaissance", knowledgeReady, "Ajoutez des preuves et objections validées pour améliorer les messages.", "/knowledge", false, knowledgeReady ? "Sources validées disponibles." : undefined),
    ];
    const onboardingAttention = onboarding.some((row) => row.status === "pending" && ["product", "icp", "sending_account", "autopilot"].includes(row.step));
    return { ready: productReady && icpReady && accountsReady && automationReady && !onboardingAttention, asOf: new Date(), items };
  }

  async getCampaignView(workspaceId: string, campaignId: string): Promise<CampaignWorkspaceView | null> {
    const [campaign, autopilot, engagement] = await Promise.all([
      this.campaignsRepository.getCampaign({ workspaceId, campaignId }),
      this.campaignDashboard.get({ workspaceId, campaignId }),
      this.campaignConversations.getOverview({ workspaceId, campaignId }),
    ]);
    if (!campaign || !autopilot || !engagement) return null;
    const [sent, replies] = await Promise.all([
      this.database.select({ value: count() }).from(messages).innerJoin(conversations, and(eq(conversations.workspaceId, messages.workspaceId), eq(conversations.id, messages.conversationId))).where(and(eq(messages.workspaceId, workspaceId), eq(conversations.campaignId, campaignId), eq(messages.direction, "outbound"))),
      this.database.select({ value: count() }).from(messages).innerJoin(conversations, and(eq(conversations.workspaceId, messages.workspaceId), eq(conversations.id, messages.conversationId))).where(and(eq(messages.workspaceId, workspaceId), eq(conversations.campaignId, campaignId), eq(messages.direction, "inbound"))),
    ]);
    const total = campaign.prospects.length;
    const eligible = campaign.prospects.filter((item) => item.eligible).length;
    const nextAction = autopilot.health === "attention"
      ? { label: "Voir l’exception", href: `/campaigns/${campaignId}#exception` }
      : autopilot.currentStep === "research"
        ? { label: "Relancer le sourcing", href: `/campaigns/${campaignId}#sourcing` }
        : autopilot.currentStep === "meeting"
          ? { label: "Voir les appels", href: "/appointments" }
          : null;
    return {
      campaign,
      autopilot,
      engagement,
      population: { total, eligible, contacted: valueOf(sent), replies: valueOf(replies) },
      nextAction,
      timeline: timelineFor(autopilot.currentStep, autopilot.health),
    };
  }

  async listConversations(input: { workspaceId: string; channel?: string; scope?: string; source?: string; search?: string; period?: string; read?: string; campaignId?: string; page: number; pageSize: number }): Promise<ConversationWorkspacePage> {
    const conditions = [
      sql`c.workspace_id = ${input.workspaceId}`,
      // The unified inbox is an account mirror. Historical outside-campaign
      // rows whose account was removed/reconnected are not actionable and can
      // duplicate the live thread imported from the currently associated
      // account. Campaign conversations remain visible for audit continuity.
      sql`(c.connected_account_id is not null or c.campaign_id is not null)`,
    ];
    if (input.channel && ["linkedin", "email", "whatsapp"].includes(input.channel)) conditions.push(sql`c.channel = ${input.channel}`);
    if (input.scope === "campaign") conditions.push(sql`c.campaign_id is not null`);
    if (input.scope === "outside_campaign") conditions.push(sql`c.campaign_id is null`);
    if (input.source === "inbound") conditions.push(sql`c.campaign_id is null and coalesce(social.event_count, 0) > 0`);
    if (input.source === "outbound") conditions.push(sql`c.campaign_id is not null and coalesce(social.event_count, 0) = 0`);
    if (input.source === "mixed") conditions.push(sql`c.campaign_id is not null and coalesce(social.event_count, 0) > 0`);
    if (input.source === "unknown") conditions.push(sql`c.campaign_id is null and coalesce(social.event_count, 0) = 0`);
    if (input.read === "unread") conditions.push(sql`c.unread_count > 0`);
    if (input.campaignId) conditions.push(sql`c.campaign_id = ${input.campaignId}`);
    if (input.period === "today") conditions.push(sql`greatest(c.last_message_at, social.last_event_at) >= date_trunc('day', now())`);
    if (input.period === "7d") conditions.push(sql`greatest(c.last_message_at, social.last_event_at) >= now() - interval '7 days'`);
    if (input.period === "30d") conditions.push(sql`greatest(c.last_message_at, social.last_event_at) >= now() - interval '30 days'`);
    if (input.period === "90d") conditions.push(sql`greatest(c.last_message_at, social.last_event_at) >= now() - interval '90 days'`);
    if (input.search?.trim()) {
      const query = `%${input.search.trim().toLowerCase()}%`;
      conditions.push(sql`lower(concat_ws(' ', ct.first_name, ct.last_name, ca.name, ac.display_name, c.subject, lm.body, social.last_event_body, social.post_text)) like ${query}`);
    }
    const where = sql.join(conditions, sql` AND `);
    const offset = (input.page - 1) * input.pageSize;
    const mergedLimit = offset + input.pageSize;
    const socialConditions = [
      sql`i.workspace_id = ${input.workspaceId}`,
      sql`i.status = 'observed'`,
      sql`i.direction = 'incoming'`,
      sql`i.type in ('comment', 'reply', 'mention')`,
      sql`identity.status = 'active'`,
      sql`identity.kind = 'identity'`,
      sql`identity.certainty = 'evidence'`,
      sql`identity.proof_type = 'contact_identity'`,
      sql`identity.confidence >= 0.95`,
      sql`identity.contact_id is not null`,
      sql`not exists (select 1 from conversations existing where existing.workspace_id = i.workspace_id and existing.contact_id = identity.contact_id and existing.channel = 'linkedin' and existing.connected_account_id = i.connected_account_id)`,
    ];
    if (input.channel && input.channel !== "linkedin") socialConditions.push(sql`false`);
    if (input.scope === "campaign" || input.campaignId || input.read === "unread") socialConditions.push(sql`false`);
    if (input.source && input.source !== "inbound") socialConditions.push(sql`false`);
    if (input.period === "today") socialConditions.push(sql`coalesce(i.occurred_at, i.first_seen_at) >= date_trunc('day', now())`);
    if (input.period === "7d") socialConditions.push(sql`coalesce(i.occurred_at, i.first_seen_at) >= now() - interval '7 days'`);
    if (input.period === "30d") socialConditions.push(sql`coalesce(i.occurred_at, i.first_seen_at) >= now() - interval '30 days'`);
    if (input.period === "90d") socialConditions.push(sql`coalesce(i.occurred_at, i.first_seen_at) >= now() - interval '90 days'`);
    if (input.search?.trim()) {
      const query = `%${input.search.trim().toLowerCase()}%`;
      socialConditions.push(sql`lower(concat_ws(' ', ct.first_name, ct.last_name, ac.display_name, i.actor_name, i.body, sc.text)) like ${query}`);
    }
    const socialWhere = sql.join(socialConditions, sql` AND `);
    const conversationContext = sql`WITH social_events AS (
      SELECT DISTINCT ON (touch.conversation_id, i.id)
        touch.conversation_id,
        i.id,
        coalesce(i.occurred_at, i.first_seen_at) AS event_at,
        i.body,
        sc.text AS post_text
      FROM attribution_touches touch
      JOIN social_interactions i ON i.workspace_id = touch.workspace_id
        AND i.id = touch.social_interaction_id
        AND i.status = 'observed'
        AND i.direction = 'incoming'
        AND i.type in ('comment', 'reply', 'mention')
      JOIN social_content_items sc ON sc.workspace_id = i.workspace_id
        AND sc.id = i.social_content_id
      WHERE touch.workspace_id = ${input.workspaceId}
        AND touch.conversation_id is not null
        AND touch.kind = 'conversation'
        AND touch.status = 'active'
        AND touch.certainty = 'evidence'
      ORDER BY touch.conversation_id, i.id, touch.updated_at DESC
    ), social AS (
      SELECT
        conversation_id,
        count(*)::int AS event_count,
        max(event_at) AS last_event_at,
        (array_agg(body ORDER BY event_at DESC, id DESC))[1] AS last_event_body,
        (array_agg(post_text ORDER BY event_at DESC, id DESC))[1] AS post_text
      FROM social_events
      GROUP BY conversation_id
    ), latest_messages AS (
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id,
        m.body,
        m.direction,
        coalesce(m.sent_at, m.received_at, m.created_at) AS message_at
      FROM messages m
      WHERE m.workspace_id = ${input.workspaceId}
      ORDER BY m.conversation_id, coalesce(m.sent_at, m.received_at, m.created_at) DESC, m.created_at DESC
    )`;
    const conversationBaseJoins = sql`FROM conversations c
      JOIN contacts ct ON ct.workspace_id = c.workspace_id AND ct.id = c.contact_id
      LEFT JOIN campaigns ca ON ca.workspace_id = c.workspace_id AND ca.id = c.campaign_id
      LEFT JOIN connected_accounts ac ON ac.workspace_id = c.workspace_id AND ac.id = c.connected_account_id
      LEFT JOIN social ON social.conversation_id = c.id`;
    const conversationListJoins = sql`${conversationBaseJoins}
      LEFT JOIN latest_messages lm ON lm.conversation_id = c.id`;
    const conversationCountJoins = input.search?.trim() ? conversationListJoins : conversationBaseJoins;
    const [conversationRows, conversationTotalRows, socialRows, socialTotalRows, syncRows] = await Promise.all([
      this.database.execute<ConversationRow>(sql`${conversationContext} SELECT c.id, 'message_thread'::text AS conversation_kind, CASE WHEN c.campaign_id is not null AND coalesce(social.event_count, 0) > 0 THEN 'mixed' WHEN c.campaign_id is not null THEN 'outbound' WHEN coalesce(social.event_count, 0) > 0 THEN 'inbound' ELSE 'unknown' END AS source, c.contact_id, ct.first_name, ct.last_name, c.campaign_id, ca.name AS campaign_name, c.connected_account_id, ac.display_name AS account_name, c.channel, c.origin, c.automation_mode, c.subject, c.status, c.unread_count, coalesce(social.event_count, 0)::int AS social_event_count, greatest(c.last_message_at, social.last_event_at) AS last_message_at, CASE WHEN social.last_event_at is not null AND (lm.message_at is null OR social.last_event_at > lm.message_at) THEN social.last_event_body ELSE lm.body END AS last_message_body, CASE WHEN social.last_event_at is not null AND (lm.message_at is null OR social.last_event_at > lm.message_at) THEN 'social' ELSE lm.direction END AS last_message_direction, greatest(lm.message_at, social.last_event_at) AS last_message_at_actual ${conversationListJoins} WHERE ${where} ORDER BY greatest(c.last_message_at, social.last_event_at) DESC, c.id DESC LIMIT ${mergedLimit}`),
      this.database.execute<{ total: number | string }>(sql`${conversationContext} SELECT count(*)::int AS total ${conversationCountJoins} WHERE ${where}`),
      this.database.execute<ConversationRow>(sql`SELECT * FROM (SELECT DISTINCT ON (identity.contact_id, i.connected_account_id, i.social_content_id) i.id, 'social_thread'::text AS conversation_kind, 'inbound'::text AS source, identity.contact_id, ct.first_name, ct.last_name, null::uuid AS campaign_id, null::text AS campaign_name, i.connected_account_id, ac.display_name AS account_name, 'linkedin'::text AS channel, 'outside_campaign'::text AS origin, 'human'::text AS automation_mode, null::text AS subject, 'open'::text AS status, 0::int AS unread_count, count(*) OVER (PARTITION BY identity.contact_id, i.connected_account_id, i.social_content_id)::int AS social_event_count, max(coalesce(i.occurred_at, i.first_seen_at)) OVER (PARTITION BY identity.contact_id, i.connected_account_id, i.social_content_id) AS last_message_at, first_value(i.body) OVER (PARTITION BY identity.contact_id, i.connected_account_id, i.social_content_id ORDER BY coalesce(i.occurred_at, i.first_seen_at) DESC, i.id DESC) AS last_message_body, 'social'::text AS last_message_direction, max(coalesce(i.occurred_at, i.first_seen_at)) OVER (PARTITION BY identity.contact_id, i.connected_account_id, i.social_content_id) AS last_message_at_actual FROM social_interactions i JOIN attribution_touches identity ON identity.workspace_id = i.workspace_id AND identity.social_interaction_id = i.id JOIN contacts ct ON ct.workspace_id = identity.workspace_id AND ct.id = identity.contact_id JOIN connected_accounts ac ON ac.workspace_id = i.workspace_id AND ac.id = i.connected_account_id JOIN social_content_items sc ON sc.workspace_id = i.workspace_id AND sc.id = i.social_content_id WHERE ${socialWhere} ORDER BY identity.contact_id, i.connected_account_id, i.social_content_id, coalesce(i.occurred_at, i.first_seen_at) DESC, i.id DESC) social_threads ORDER BY last_message_at DESC, id DESC LIMIT ${mergedLimit}`),
      this.database.execute<{ total: number | string }>(sql`SELECT count(*)::int AS total FROM (SELECT identity.contact_id, i.connected_account_id, i.social_content_id FROM social_interactions i JOIN attribution_touches identity ON identity.workspace_id = i.workspace_id AND identity.social_interaction_id = i.id JOIN contacts ct ON ct.workspace_id = identity.workspace_id AND ct.id = identity.contact_id JOIN connected_accounts ac ON ac.workspace_id = i.workspace_id AND ac.id = i.connected_account_id JOIN social_content_items sc ON sc.workspace_id = i.workspace_id AND sc.id = i.social_content_id WHERE ${socialWhere} GROUP BY identity.contact_id, i.connected_account_id, i.social_content_id) social_threads`),
      this.database.execute<InboxSyncRow>(sql`SELECT count(ac.id)::int AS total_accounts, count(ac.id) FILTER (WHERE s.backfill_complete = true AND s.status = 'idle')::int AS ready_accounts, count(ac.id) FILTER (WHERE s.id IS NULL OR s.backfill_complete = false OR s.status = 'syncing')::int AS backfilling_accounts, count(ac.id) FILTER (WHERE s.status = 'error')::int AS error_accounts, max(s.last_success_at) AS last_success_at FROM connected_accounts ac LEFT JOIN inbox_sync_states s ON s.workspace_id = ac.workspace_id AND s.connected_account_id = ac.id WHERE ac.workspace_id = ${input.workspaceId} AND ac.provider = 'unipile' AND ac.status = 'connected' AND (ac.capabilities ? 'linkedin' OR ac.capabilities ? 'email' OR ac.capabilities ? 'whatsapp')`),
    ]);
    const rows = [...conversationRows, ...socialRows]
      .sort((left, right) => asDate(right.last_message_at).getTime() - asDate(left.last_message_at).getTime() || right.id.localeCompare(left.id))
      .slice(offset, offset + input.pageSize);
    const total = Number(conversationTotalRows[0]?.total ?? 0) + Number(socialTotalRows[0]?.total ?? 0);
    const sync = syncRows[0];
    return {
      data: rows.map(toConversationView),
      pagination: { page: input.page, pageSize: input.pageSize, total, hasNext: offset + rows.length < total },
      sync: {
        totalAccounts: Number(sync?.total_accounts ?? 0),
        readyAccounts: Number(sync?.ready_accounts ?? 0),
        backfillingAccounts: Number(sync?.backfilling_accounts ?? 0),
        errorAccounts: Number(sync?.error_accounts ?? 0),
        lastSuccessAt: sync?.last_success_at ?? null,
      },
    };
  }

  async getConversation(workspaceId: string, conversationId: string): Promise<ConversationWorkspaceDetail | null> {
    const rows = await this.database.execute<ConversationRow>(sql`SELECT c.id, 'message_thread'::text AS conversation_kind, CASE WHEN c.campaign_id is not null AND coalesce(social.event_count, 0) > 0 THEN 'mixed' WHEN c.campaign_id is not null THEN 'outbound' WHEN coalesce(social.event_count, 0) > 0 THEN 'inbound' ELSE 'unknown' END AS source, c.contact_id, ct.first_name, ct.last_name, c.campaign_id, ca.name AS campaign_name, c.connected_account_id, ac.display_name AS account_name, c.channel, c.origin, c.automation_mode, c.subject, c.status, c.unread_count, coalesce(social.event_count, 0)::int AS social_event_count, greatest(c.last_message_at, social.last_event_at) AS last_message_at, CASE WHEN social.last_event_at is not null AND (lm.message_at is null OR social.last_event_at > lm.message_at) THEN social.last_event_body ELSE lm.body END AS last_message_body, CASE WHEN social.last_event_at is not null AND (lm.message_at is null OR social.last_event_at > lm.message_at) THEN 'social' ELSE lm.direction END AS last_message_direction, greatest(lm.message_at, social.last_event_at) AS last_message_at_actual FROM conversations c JOIN contacts ct ON ct.workspace_id = c.workspace_id AND ct.id = c.contact_id LEFT JOIN campaigns ca ON ca.workspace_id = c.workspace_id AND ca.id = c.campaign_id LEFT JOIN connected_accounts ac ON ac.workspace_id = c.workspace_id AND ac.id = c.connected_account_id LEFT JOIN LATERAL (SELECT m.body, m.direction, coalesce(m.sent_at, m.received_at, m.created_at) AS message_at FROM messages m WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id ORDER BY coalesce(m.sent_at, m.received_at, m.created_at) DESC, m.created_at DESC LIMIT 1) lm ON true LEFT JOIN LATERAL (SELECT count(distinct i.id)::int AS event_count, max(coalesce(i.occurred_at, i.first_seen_at)) AS last_event_at, (array_agg(i.body ORDER BY coalesce(i.occurred_at, i.first_seen_at) DESC, i.id DESC))[1] AS last_event_body FROM attribution_touches touch JOIN social_interactions i ON i.workspace_id = touch.workspace_id AND i.id = touch.social_interaction_id AND i.status = 'observed' AND i.direction = 'incoming' AND i.type in ('comment', 'reply', 'mention') WHERE touch.workspace_id = c.workspace_id AND touch.conversation_id = c.id AND touch.kind = 'conversation' AND touch.status = 'active' AND touch.certainty = 'evidence') social ON true WHERE c.workspace_id = ${workspaceId} AND c.id = ${conversationId} LIMIT 1`);
    const row = rows[0];
    if (!row) return this.getSocialConversation(workspaceId, conversationId);
    const [messageRows, socialEventRows, decisionRows, commandRows] = await Promise.all([
      this.database.execute<ConversationMessageRow>(sql`SELECT id, provider_message_id, direction, sender_type, body, coalesce(sent_at, received_at, created_at) AS message_at FROM messages WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId} ORDER BY coalesce(sent_at, received_at, created_at), created_at`),
      this.database.execute<SocialConversationEventRow>(sql`SELECT i.id, i.type, i.actor_name, coalesce(i.body, '') AS body, coalesce(i.occurred_at, i.first_seen_at) AS event_at, sc.text AS post_text, sc.url AS post_url, concat('/attribution?interactionId=', i.id) AS proof_href FROM attribution_touches touch JOIN social_interactions i ON i.workspace_id = touch.workspace_id AND i.id = touch.social_interaction_id JOIN social_content_items sc ON sc.workspace_id = i.workspace_id AND sc.id = i.social_content_id WHERE touch.workspace_id = ${workspaceId} AND touch.conversation_id = ${conversationId} AND touch.kind = 'conversation' AND touch.status = 'active' AND touch.certainty = 'evidence' AND i.status = 'observed' AND i.direction = 'incoming' AND i.type in ('comment', 'reply', 'mention') ORDER BY event_at, i.id`),
      this.database.execute<ConversationDecisionRow>(sql`SELECT rc.intent, rc.confidence, rc.action, rc.rationale, rc.created_at FROM reply_classifications rc JOIN messages m ON m.workspace_id = rc.workspace_id AND m.id = rc.message_id WHERE rc.workspace_id = ${workspaceId} AND m.conversation_id = ${conversationId} ORDER BY rc.created_at DESC LIMIT 1`),
      this.database.execute<ConversationCommandRow>(sql`SELECT id, mode, execution_mode, status, generated_body, generation_metadata, error_message, created_at FROM conversation_commands WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId} ORDER BY created_at DESC LIMIT 1`),
    ]);
    const summary = toConversationView(row);
    const decision = decisionRows[0];
    const command = commandRows[0];
    return {
      ...summary,
      messages: messageRows.map((message) => ({
        id: message.id,
        providerMessageId: message.provider_message_id,
        direction: message.direction,
        senderType: message.sender_type,
        body: message.body,
        at: message.message_at,
      })),
      socialEvents: socialEventRows.map(toSocialConversationEvent),
      decision: decision ? {
        intent: decision.intent,
        confidence: Number(decision.confidence),
        action: decision.action,
        rationale: decision.rationale,
        createdAt: decision.created_at,
      } : null,
      latestCommand: command ? {
        id: command.id,
        mode: command.mode,
        executionMode: command.execution_mode,
        status: command.status,
        generatedBody: command.generated_body,
        generationMetadata: command.generation_metadata,
        errorMessage: command.error_message,
        createdAt: command.created_at,
      } : null,
    };
  }

  private async getSocialConversation(workspaceId: string, interactionId: string): Promise<ConversationWorkspaceDetail | null> {
    const anchors = await this.database.execute<SocialConversationAnchorRow>(sql`SELECT i.id, identity.contact_id, ct.first_name, ct.last_name, i.connected_account_id, ac.display_name AS account_name, i.social_content_id FROM social_interactions i JOIN attribution_touches identity ON identity.workspace_id = i.workspace_id AND identity.social_interaction_id = i.id JOIN contacts ct ON ct.workspace_id = identity.workspace_id AND ct.id = identity.contact_id JOIN connected_accounts ac ON ac.workspace_id = i.workspace_id AND ac.id = i.connected_account_id WHERE i.workspace_id = ${workspaceId} AND i.id = ${interactionId} AND i.status = 'observed' AND i.direction = 'incoming' AND i.type in ('comment', 'reply', 'mention') AND identity.status = 'active' AND identity.kind = 'identity' AND identity.certainty = 'evidence' AND identity.proof_type = 'contact_identity' AND identity.confidence >= 0.95 AND identity.contact_id is not null AND not exists (select 1 from conversations existing where existing.workspace_id = i.workspace_id and existing.contact_id = identity.contact_id and existing.channel = 'linkedin' and existing.connected_account_id = i.connected_account_id) LIMIT 1`);
    const anchor = anchors[0];
    if (!anchor) return null;
    const eventRows = await this.database.execute<SocialConversationEventRow>(sql`SELECT i.id, i.type, i.actor_name, coalesce(i.body, '') AS body, coalesce(i.occurred_at, i.first_seen_at) AS event_at, sc.text AS post_text, sc.url AS post_url, concat('/attribution?interactionId=', i.id) AS proof_href FROM social_interactions i JOIN attribution_touches identity ON identity.workspace_id = i.workspace_id AND identity.social_interaction_id = i.id JOIN social_content_items sc ON sc.workspace_id = i.workspace_id AND sc.id = i.social_content_id WHERE i.workspace_id = ${workspaceId} AND identity.contact_id = ${anchor.contact_id} AND i.connected_account_id = ${anchor.connected_account_id} AND i.social_content_id = ${anchor.social_content_id} AND i.status = 'observed' AND i.direction = 'incoming' AND i.type in ('comment', 'reply', 'mention') AND identity.status = 'active' AND identity.kind = 'identity' AND identity.certainty = 'evidence' AND identity.proof_type = 'contact_identity' AND identity.confidence >= 0.95 ORDER BY event_at, i.id`);
    const socialEvents = eventRows.map(toSocialConversationEvent).sort((left, right) => left.at.getTime() - right.at.getTime());
    const latest = socialEvents.at(-1);
    if (!latest) return null;
    return {
      id: anchor.id,
      kind: "social_thread",
      source: "inbound",
      contactId: anchor.contact_id,
      firstName: anchor.first_name,
      lastName: anchor.last_name,
      campaignId: null,
      campaignName: null,
      connectedAccountId: anchor.connected_account_id,
      accountName: anchor.account_name,
      channel: "linkedin",
      origin: "outside_campaign",
      automationMode: "human",
      subject: null,
      status: "open",
      unreadCount: 0,
      socialEventCount: socialEvents.length,
      lastMessage: { body: latest.body, direction: "social", at: latest.at },
      lastMessageAt: latest.at,
      messages: [],
      socialEvents,
      decision: null,
      latestCommand: null,
    };
  }

  async getPipeline(workspaceId: string, role?: string) {
    const result = await this.opportunitiesRepository.list(workspaceId);
    if (role !== "viewer") return result;
    return { ...result, data: result.data.map(({ amount: _amount, currency: _currency, ...safe }) => safe) };
  }
}

type ConversationRow = {
  id: string;
  conversation_kind: "message_thread" | "social_thread";
  source: "inbound" | "outbound" | "mixed" | "unknown";
  contact_id: string;
  first_name: string;
  last_name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  connected_account_id: string | null;
  account_name: string | null;
  channel: "linkedin" | "email" | "whatsapp";
  origin: "campaign" | "outside_campaign";
  automation_mode: "setter" | "human" | "disabled";
  subject: string | null;
  status: string;
  unread_count: number;
  social_event_count: number | string;
  last_message_at: Date | string;
  last_message_body: string | null;
  last_message_direction: string | null;
  last_message_at_actual: Date | string | null;
};

type ConversationMessageRow = {
  id: string;
  provider_message_id: string;
  direction: "inbound" | "outbound";
  sender_type: string;
  body: string;
  message_at: Date;
};

type ConversationDecisionRow = {
  intent: string;
  confidence: number | string;
  action: string;
  rationale: string;
  created_at: Date;
};

type ConversationCommandRow = {
  id: string;
  mode: "manual" | "setter";
  execution_mode: "live" | "dry_run";
  status: string;
  generated_body: string | null;
  generation_metadata: Record<string, unknown>;
  error_message: string | null;
  created_at: Date;
};

type SocialConversationEventRow = {
  id: string;
  type: "comment" | "reply" | "mention";
  actor_name: string | null;
  body: string;
  event_at: Date | string;
  post_text: string;
  post_url: string | null;
  proof_href: string;
};

type SocialConversationAnchorRow = {
  id: string;
  contact_id: string;
  first_name: string;
  last_name: string;
  connected_account_id: string;
  account_name: string | null;
  social_content_id: string;
};

type InboxSyncRow = {
  total_accounts: number | string;
  ready_accounts: number | string;
  backfilling_accounts: number | string;
  error_accounts: number | string;
  last_success_at: Date | null;
};

type SymbiosisStatsRow = {
  explicit_signals: number | string;
  resolved_identities: number | string;
  conversations: number | string;
  calls: number | string;
  unresolved: number | string;
};

function toConversationView(row: ConversationRow): ConversationWorkspaceView {
  return {
    id: row.id,
    kind: row.conversation_kind,
    source: row.source,
    contactId: row.contact_id,
    firstName: row.first_name,
    lastName: row.last_name,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    connectedAccountId: row.connected_account_id,
    accountName: row.account_name,
    channel: row.channel,
    origin: row.origin,
    automationMode: row.automation_mode,
    subject: row.subject,
    status: row.status,
    unreadCount: row.unread_count,
    socialEventCount: Number(row.social_event_count),
    lastMessage: row.last_message_body && row.last_message_at_actual
        ? { body: row.last_message_body, direction: row.last_message_direction ?? "unknown", at: asDate(row.last_message_at_actual) }
      : null,
    lastMessageAt: asDate(row.last_message_at),
  };
}

function toSocialConversationEvent(row: SocialConversationEventRow): ConversationWorkspaceDetail["socialEvents"][number] {
  return {
    id: row.id,
    type: row.type,
    actorName: row.actor_name,
    body: row.body,
    at: asDate(row.event_at),
    postText: row.post_text,
    postUrl: row.post_url,
    proofHref: row.proof_href,
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function valueOf(row: readonly [{ value: number | string }] | readonly { value: number | string }[]): number {
  return Number(row[0]?.value ?? 0);
}

function mostRecent(...values: (Date | null | undefined)[]): Date | null {
  return values.reduce<Date | null>((latest, value) => !value || latest && latest >= value ? latest : value, null);
}

function attentionItem(type: "account" | "job" | "campaign" | "decision" | "conversation", severity: "info" | "warning" | "critical", resourceId: string, message: string, createdAt: Date, href: string, correlationId: string | null) {
  return {
    id: `${type}:${resourceId}`,
    type,
    severity,
    message,
    resourceId,
    resourceHref: href,
    ageSeconds: Math.max(0, Math.round((Date.now() - createdAt.getTime()) / 1000)),
    action: { label: severity === "critical" ? "Diagnostiquer" : "Ouvrir", href },
    correlationId,
    createdAt,
  } as const;
}

function compareAttention(left: ReturnType<typeof attentionItem>, right: ReturnType<typeof attentionItem>): number {
  const severityRank = { critical: 3, warning: 2, info: 1 } as const;
  const riskOrder = severityRank[right.severity] - severityRank[left.severity];
  return riskOrder || left.createdAt.getTime() - right.createdAt.getTime();
}

function readiness(key: "product" | "icp" | "accounts" | "automation" | "calendar" | "knowledge", label: string, ready: boolean, reason: string, href: string, requiredForLaunch: boolean, readyReason?: string) {
  return {
    key,
    label,
    state: ready ? "ready" : requiredForLaunch ? "missing" : "optional",
    reason: readyReason ?? (ready ? "Prérequis configuré." : reason),
    action: ready ? null : { label: requiredForLaunch ? "Configurer" : "Ajouter plus tard", href },
    requiredForLaunch,
  } as const;
}

function campaignStageLabel(stage: string): string {
  return ({
    sourcing: "Sourcing",
    enriching: "Enrichissement",
    composing: "Rédaction",
    scheduled: "Planifiée",
    running: "Envoi et relances",
    completed: "Terminée",
    attention: "Exception localisée",
  } as Record<string, string>)[stage] ?? stage;
}

function contentStageLabel(stage: string): string {
  return ({
    brief: "Brief",
    writer: "Rédaction",
    audit: "Audit des preuves",
    critic: "Critique anti-générique",
    completed: "Terminé",
  } as Record<string, string>)[stage] ?? stage;
}

function socialInteractionTitle(type: string, direction: string, actorName: string | null): string {
  const actor = direction === "owner" ? "Compte LinkedIn associé" : actorName ?? "Identité LinkedIn inconnue";
  const label = ({ comment: "a commenté", reply: "a répondu", reaction: "a réagi", mention: "a mentionné le compte" } as Record<string, string>)[type] ?? "a interagi";
  return `${actor} ${label}`;
}

function symbiosisSignalTitle(type: string, contactName: string | null, resolved: boolean, ambiguous: boolean): string {
  if (!resolved) {
    if (type === "reaction") return ambiguous ? "Réaction LinkedIn avec deux identités possibles" : "Réaction LinkedIn sans identité fiable";
    return ambiguous ? "Interaction LinkedIn avec une identité ambiguë" : "Interaction LinkedIn à résoudre";
  }
  const label = ({ comment: "a commenté un post", reply: "a répondu à un commentaire", reaction: "a réagi à un post", mention: "a mentionné le compte" } as Record<string, string>)[type] ?? "a interagi";
  return `${contactName ?? "Un prospect résolu"} ${label}`;
}

function symbiosisSignalDetail(input: { type: string; postText: string; confidence: number; resolved: boolean; ambiguous: boolean; pending: boolean; hasConversation: boolean; hasCall: boolean }): string {
  const excerpt = unicodeExcerpt(input.postText, 72);
  if (input.type === "reaction") {
    const identity = input.resolved ? `identité exacte ${Math.round(input.confidence * 100)} %` : input.ambiguous ? "identité ambiguë" : input.pending ? "résolution en cours" : "identité inconnue";
    return `Aucun message automatique · ${identity} · sur « ${excerpt} »`;
  }
  if (!input.resolved) return `${input.pending ? "Résolution exacte en cours" : input.ambiguous ? "Deux identités exactes se contredisent" : "Aucune identité exacte"} · aucune activation automatique · sur « ${excerpt} »`;
  const outcomes = [input.hasConversation ? "conversation reliée" : null, input.hasCall ? "appel attribué par inférence" : null].filter(Boolean).join(" · ");
  return `Identité prouvée ${Math.round(input.confidence * 100)} %${outcomes ? ` · ${outcomes}` : " · aucune suite observée"} · sur « ${excerpt} »`;
}

function unicodeExcerpt(value: string, maxCodePoints: number): string {
  const codePoints = Array.from(value);
  return codePoints.length > maxCodePoints
    ? `${codePoints.slice(0, maxCodePoints).join("")}…`
    : value;
}

function activityPriority(status: "pending" | "running" | "completed" | "attention"): number {
  return ({ attention: 0, running: 1, pending: 2, completed: 3 })[status];
}

function timelineFor(currentStep: string, health: string) {
  const steps = [
    ["sourcing", "Sourcer"], ["enrichment", "Enrichir"], ["scoring", "Scorer"], ["composition", "Rédiger"], ["outreach", "Envoyer"], ["follow_up", "Relancer"], ["setter", "Qualifier"], ["meeting", "Réserver"],
  ] as const;
  const normalized = currentStep === "research" ? "sourcing" : currentStep;
  if (normalized === "completed") return steps.map(([key, label]) => ({ key, label, status: "done" } as const));
  const current = steps.findIndex(([key]) => key === normalized);
  const safeCurrent = Math.max(current, 0);
  return steps.map(([key, label], index) => ({ key, label, status: health === "attention" && index === safeCurrent ? "attention" : index < safeCurrent ? "done" : index === safeCurrent ? "active" : "pending" } as const));
}
