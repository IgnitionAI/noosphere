import { and, count, desc, eq, sql } from "drizzle-orm";
import type {
  CampaignWorkspaceView,
  ConversationWorkspacePage,
  ConversationWorkspaceView,
  SetupReadinessView,
  WorkspaceOperationalSummary,
} from "@outbound/application/workspaces/operational-views";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  accountHealthAlerts,
  aiPolicyVersions,
  calendarConnections,
  campaigns,
  campaignProspects,
  connectedAccounts,
  contacts,
  conversations,
  dailyProspectingSchedules,
  jobs,
  knowledgeSources,
  icpVersions,
  messages,
  offerVersions,
  opportunities,
  prospectDecisions,
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

  async getSummary(workspaceId: string): Promise<WorkspaceOperationalSummary> {
    const asOf = new Date();
    const [campaignCount, prospectCount, conversationCount, opportunityCount, jobsRows, failedJobs, deadLetterRows, schedule, accountRows, alertCount, accountAttention, campaignAttention, pendingDecisions] = await Promise.all([
      this.database.select({ value: count() }).from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.status, "active"))),
      this.database.select({ value: count() }).from(contacts).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.status, "active"))),
      this.database.select({ value: count() }).from(conversations).where(and(eq(conversations.workspaceId, workspaceId), sql`${conversations.status} <> 'closed'`)),
      this.database.select({ value: count() }).from(opportunities).where(and(eq(opportunities.workspaceId, workspaceId), sql`${opportunities.stage} not in ('won', 'lost')`)),
      this.database.select({ id: jobs.id, type: jobs.type, status: jobs.status, updatedAt: jobs.updatedAt }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), sql`${jobs.status} in ('pending', 'running', 'retry')`)).orderBy(desc(jobs.updatedAt)).limit(10),
      this.database.select({ value: count() }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, "dead_lettered"))),
      this.database.select({ id: jobs.id, type: jobs.type, updatedAt: jobs.updatedAt }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, "dead_lettered"))).orderBy(desc(jobs.updatedAt)).limit(10),
      this.database.select({ nextRunAt: dailyProspectingSchedules.nextRunAt }).from(dailyProspectingSchedules).where(and(eq(dailyProspectingSchedules.workspaceId, workspaceId), eq(dailyProspectingSchedules.enabled, true))).limit(1),
      this.database.select({ status: connectedAccounts.status }).from(connectedAccounts).where(eq(connectedAccounts.workspaceId, workspaceId)),
      this.database.select({ value: count() }).from(accountHealthAlerts).where(and(eq(accountHealthAlerts.workspaceId, workspaceId), sql`${accountHealthAlerts.status} in ('active', 'acknowledged')`)),
      this.database.select({ id: accountHealthAlerts.id, connectedAccountId: accountHealthAlerts.connectedAccountId, reason: accountHealthAlerts.reasonMessage, createdAt: accountHealthAlerts.createdAt }).from(accountHealthAlerts).where(and(eq(accountHealthAlerts.workspaceId, workspaceId), sql`${accountHealthAlerts.status} in ('active', 'acknowledged')`)).orderBy(desc(accountHealthAlerts.createdAt)).limit(10),
      this.database.select({ id: campaigns.id, name: campaigns.name, updatedAt: campaigns.updatedAt, errorMessage: campaigns.automationErrorMessage }).from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.automationStage, "attention"))).orderBy(desc(campaigns.updatedAt)).limit(10),
      this.database.select({ id: prospectDecisions.id, reason: prospectDecisions.reason, contactId: prospectDecisions.contactId, createdAt: prospectDecisions.createdAt }).from(prospectDecisions).where(and(eq(prospectDecisions.workspaceId, workspaceId), eq(prospectDecisions.status, "pending"))).orderBy(desc(prospectDecisions.priority), desc(prospectDecisions.createdAt)).limit(10),
    ]);

    const attention = [
      ...campaignAttention.map((item) => attentionItem("campaign", "critical", item.id, item.errorMessage ?? `La campagne ${item.name} nécessite une attention.`, item.updatedAt, `/campaigns/${item.id}`)),
      ...accountAttention.map((item) => attentionItem("account", "critical", item.id, item.reason ?? "Un compte d’envoi nécessite une reconnexion.", item.createdAt, "/settings/channels")),
      ...deadLetterRows.map((job) => attentionItem("job", "critical", job.id, `Le job ${job.type} est en dead letter et nécessite un diagnostic.`, job.updatedAt, "/settings/console")),
      ...jobsRows.filter((job) => job.status === "retry").map((job) => attentionItem("job", "warning", job.id, `Le job ${job.type} sera retenté automatiquement.`, job.updatedAt, "/settings/console")),
      ...pendingDecisions.map((item) => attentionItem("decision", "info", item.id, item.reason, item.createdAt, "/prospects")),
    ].slice(0, 20);
    const statuses = accountRows.map((row) => row.status);
    const connected = statuses.filter((status) => status === "connected").length;
    const degraded = statuses.filter((status) => status === "degraded" || status === "unknown" || status === "pending").length;
    const disconnected = statuses.filter((status) => status === "disconnected").length;
    return {
      asOf,
      counts: {
        activeCampaigns: valueOf(campaignCount),
        prospects: valueOf(prospectCount),
        openConversations: valueOf(conversationCount),
        openOpportunities: valueOf(opportunityCount),
        attention: attention.length,
      },
      attention,
      jobs: {
        active: jobsRows.length,
        failed: valueOf(failedJobs),
        running: jobsRows.map((job) => ({ id: job.id, type: job.type, status: job.status, updatedAt: job.updatedAt })),
      },
      nextAutomaticResearch: schedule[0]?.nextRunAt ?? null,
      accountHealth: { connected, degraded, disconnected, activeAlerts: valueOf(alertCount) },
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
      ? { label: "Voir l’exception", href: `/w/${workspaceId}/campaigns/${campaignId}` }
      : autopilot.currentStep === "research"
        ? { label: "Relancer le sourcing", href: `/w/${workspaceId}/campaigns/${campaignId}#sourcing` }
        : autopilot.currentStep === "meeting"
          ? { label: "Ouvrir le pipeline", href: `/w/${workspaceId}/pipeline` }
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

  async listConversations(input: { workspaceId: string; channel?: string; scope?: string; search?: string; page: number; pageSize: number }): Promise<ConversationWorkspacePage> {
    const conditions = [sql`c.workspace_id = ${input.workspaceId}`];
    if (input.channel && ["linkedin", "email", "whatsapp"].includes(input.channel)) conditions.push(sql`c.channel = ${input.channel}`);
    if (input.scope === "campaign") conditions.push(sql`c.campaign_id is not null`);
    if (input.scope === "outside_campaign") conditions.push(sql`c.campaign_id is null`);
    if (input.search?.trim()) {
      const query = `%${input.search.trim().toLowerCase()}%`;
      conditions.push(sql`lower(concat_ws(' ', ct.first_name, ct.last_name, ca.name)) like ${query}`);
    }
    const where = sql.join(conditions, sql` AND `);
    const offset = (input.page - 1) * input.pageSize;
    const [rows, totalRows] = await Promise.all([
      this.database.execute<ConversationRow>(sql`SELECT c.id, c.contact_id, ct.first_name, ct.last_name, c.campaign_id, ca.name AS campaign_name, c.channel, c.status, c.unread_count, c.last_message_at, lm.body AS last_message_body, lm.direction AS last_message_direction, lm.message_at AS last_message_at_actual FROM conversations c JOIN contacts ct ON ct.workspace_id = c.workspace_id AND ct.id = c.contact_id LEFT JOIN campaigns ca ON ca.workspace_id = c.workspace_id AND ca.id = c.campaign_id LEFT JOIN LATERAL (SELECT m.body, m.direction, coalesce(m.sent_at, m.received_at, m.created_at) AS message_at FROM messages m WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) lm ON true WHERE ${where} ORDER BY c.last_message_at DESC LIMIT ${input.pageSize} OFFSET ${offset}`),
      this.database.execute<{ total: number | string }>(sql`SELECT count(*)::int AS total FROM conversations c JOIN contacts ct ON ct.workspace_id = c.workspace_id AND ct.id = c.contact_id LEFT JOIN campaigns ca ON ca.workspace_id = c.workspace_id AND ca.id = c.campaign_id WHERE ${where}`),
    ]);
    const total = Number(totalRows[0]?.total ?? 0);
    return { data: rows.map(toConversationView), pagination: { page: input.page, pageSize: input.pageSize, total, hasNext: offset + rows.length < total } };
  }

  async getPipeline(workspaceId: string, role?: string) {
    const result = await this.opportunitiesRepository.list(workspaceId);
    if (role !== "viewer") return result;
    return { ...result, data: result.data.map(({ amount: _amount, currency: _currency, ...safe }) => safe) };
  }
}

type ConversationRow = {
  id: string;
  contact_id: string;
  first_name: string;
  last_name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  channel: "linkedin" | "email" | "whatsapp";
  status: string;
  unread_count: number;
  last_message_at: Date;
  last_message_body: string | null;
  last_message_direction: string | null;
  last_message_at_actual: Date | null;
};

function toConversationView(row: ConversationRow): ConversationWorkspaceView {
  return {
    id: row.id,
    contactId: row.contact_id,
    firstName: row.first_name,
    lastName: row.last_name,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    channel: row.channel,
    status: row.status,
    unreadCount: row.unread_count,
    lastMessage: row.last_message_body && row.last_message_at_actual
      ? { body: row.last_message_body, direction: row.last_message_direction ?? "unknown", at: row.last_message_at_actual }
      : null,
    lastMessageAt: row.last_message_at,
  };
}

function valueOf(row: readonly [{ value: number | string }] | readonly { value: number | string }[]): number {
  return Number(row[0]?.value ?? 0);
}

function attentionItem(type: "account" | "job" | "campaign" | "decision" | "conversation", severity: "info" | "warning" | "critical", resourceId: string, message: string, createdAt: Date, href: string) {
  return {
    id: `${type}:${resourceId}`,
    type,
    severity,
    message,
    resourceId,
    resourceHref: href,
    ageSeconds: Math.max(0, Math.round((Date.now() - createdAt.getTime()) / 1000)),
    action: { label: severity === "critical" ? "Diagnostiquer" : "Ouvrir", href },
    createdAt,
  } as const;
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
