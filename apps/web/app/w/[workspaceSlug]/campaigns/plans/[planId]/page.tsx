import {
  ArrowLeft,
  AtSign,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Mail,
  MessageCircle,
  RefreshCw,
  Send,
  Target,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { isActionableCampaignException } from "@outbound/application/campaigns/campaign-engagement";
import { resolveCampaignAutopilotPolicy } from "@outbound/domain/campaigns/campaign-autopilot-policy";
import {
  getCampaign,
  getCampaignAutopilotDashboard,
  getCampaignConversation,
  getCampaignEngagement,
  getProspectingPlan,
  type CampaignConversationDetail,
  type CampaignAutopilotDashboard,
  type CampaignDetail,
  type CampaignEngagementOverview,
  type CampaignProspect,
  type CampaignProspectEngagement,
  type CampaignSummary,
  type ProspectEngagementState,
} from "@/lib/api";
import { aggregateCampaignEngagement } from "@/lib/campaign-engagement";
import { prospectDetailHref } from "@/lib/prospect-navigation";
import { CampaignAutoRefresh } from "../../campaign-auto-refresh";

export const metadata = { title: "Campagne" };
export const dynamic = "force-dynamic";

const CHANNELS = ["linkedin", "email", "whatsapp"] as const;
type Channel = typeof CHANNELS[number];
type AggregatedProspect = CampaignProspect & { readonly campaignChannels: readonly Channel[] };

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; planId: string }>;
  searchParams: Promise<{ prospect?: string }>;
}) {
  const { workspaceSlug, planId } = await params;
  const { prospect: selectedProspectKey } = await searchParams;
  const plan = await getProspectingPlan(workspaceSlug, planId);
  const activeCampaigns = plan.campaigns.filter((campaign) => campaign.status !== "archived");
  const [campaignDetails, engagementViews, dashboards] = await Promise.all([
    Promise.all(activeCampaigns.map((campaign) => getCampaign(workspaceSlug, campaign.id))),
    Promise.all(activeCampaigns.map((campaign) => getCampaignEngagement(workspaceSlug, campaign.id))),
    Promise.all(activeCampaigns.map((campaign) => getCampaignAutopilotDashboard(workspaceSlug, campaign.id))),
  ]);
  const engagement = aggregateCampaignEngagement(engagementViews);
  const prospects = aggregateProspects(campaignDetails);
  const engagementByProspect = new Map(
    engagement.prospects.map((item) => [item.contactId ?? item.candidateId, item]),
  );
  const campaignPath = `/w/${workspaceSlug}/campaigns/plans/${planId}`;
  const selectedProspect = selectedProspectKey
    ? prospects.find((item) => prospectKey(item) === selectedProspectKey) ?? null
    : null;
  const selectedEngagement = selectedProspectKey
    ? engagementByProspect.get(selectedProspectKey) ?? null
    : null;
  const selectedConversation = selectedEngagement?.conversationId
    ? await getCampaignConversation(
        workspaceSlug,
        selectedEngagement.campaignId,
        selectedEngagement.conversationId,
      )
    : null;
  const refreshing = plan.status === "assessing"
    || campaignDetails.some((campaign) => ["sourcing", "enriching", "composing", "scheduled", "running"].includes(campaign.automationStage));
  const exceptions = campaignDetails.filter(isActionableCampaignException);

  return (
    <>
      <CampaignAutoRefresh enabled={refreshing} />
      <Link className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-blue" href={`/w/${workspaceSlug}/campaigns`}>
        <ArrowLeft size={14} /> Campagnes
      </Link>

      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={campaignBadge(campaignDetails)}>{campaignStatus(plan.status, campaignDetails)}</span>
            {activeCampaigns.map((campaign) => (
              campaign.channel ? <span className="badge capitalize" key={campaign.id}>{campaign.channel}</span> : null
            ))}
          </div>
          <h1 className="page-title">{plan.icpName}</h1>
          <p className="mt-2 text-sm text-muted">
            L’activité commerciale, les réponses et les décisions IA restent regroupées dans cette campagne.
          </p>
        </div>
      </header>

      {exceptions.length ? (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <strong>{exceptions.length} exception{exceptions.length > 1 ? "s" : ""} technique{exceptions.length > 1 ? "s" : ""}.</strong>{" "}
          {exceptions.map((campaign) => campaign.automationErrorMessage ?? campaign.automationErrorCode).filter(Boolean).join(" · ")}
        </div>
      ) : null}

      <section aria-label="Indicateurs de campagne" className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={Target} label="Ciblés" value={engagement.metrics.targeted} />
        <Metric icon={Send} label="Contactés" value={engagement.metrics.contacted} />
        <Metric icon={MessageCircle} label="Réponses" value={engagement.metrics.replies} />
        <Metric icon={Flame} label="Prospects chauds" value={engagement.metrics.hot} tone="success" />
        <Metric icon={Calendar} label="Rendez-vous" value={engagement.metrics.meetings} tone="signal" />
      </section>

      <CampaignAutomationJourney campaigns={campaignDetails} dashboards={dashboards} engagements={engagementViews} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="font-semibold">Prospects</h2>
              <p className="mt-1 text-xs text-muted">Cliquez sur un prospect pour ouvrir son activité sans quitter la campagne.</p>
            </div>
            <span className="badge">{prospects.length}</span>
          </div>
          <div className="panel-body">
            {prospects.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                {campaignDetails.some((campaign) => campaign.discoveryStatus === "running")
                  ? "La recherche est en cours. Cette page se met à jour automatiquement."
                  : "La recherche est terminée sans cible suffisamment fiable."}
              </p>
            ) : (
              <ul className="space-y-3">
                {prospects.map((prospect) => {
                  const key = prospectKey(prospect);
                  const activity = engagementByProspect.get(key) ?? null;
                  const selected = selectedProspectKey === key;
                  return (
                    <li className={`rounded-lg border p-4 transition ${selected ? "border-brand-blue bg-blue-50/50" : "border-line hover:border-slate-300"}`} key={key}>
                      <div className="flex flex-wrap items-start gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100"><UserRound size={16} /></span>
                        <div className="min-w-0 flex-1">
                          <Link className="block text-sm font-semibold hover:text-brand-blue" href={`${campaignPath}?prospect=${encodeURIComponent(key)}`} scroll={false}>
                            {prospect.fullName}
                          </Link>
                          <span className="block text-xs text-muted">
                            {[prospect.headline, prospect.companyName].filter(Boolean).join(" · ") || "Fonction à confirmer"}
                          </span>
                        </div>
                        <ProspectStateBadge eligible={prospect.eligible} state={activity?.state ?? "not_contacted"} />
                      </div>

                      <Link className="mt-3 block rounded-lg bg-slate-50 px-3 py-2 hover:bg-slate-100" href={`${campaignPath}?prospect=${encodeURIComponent(key)}`} scroll={false}>
                        {activity?.lastMessage ? (
                          <>
                            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                              <MessageCircle size={11} />
                              {activity.lastMessage.direction === "inbound" ? "Dernière réponse" : "Dernier message"}
                              <span className="ml-auto normal-case tracking-normal">{formatDate(activity.lastMessage.occurredAt)}</span>
                            </span>
                            <span className="mt-1 block truncate text-xs text-navy">{activity.lastMessage.body}</span>
                          </>
                        ) : (
                          <span className="flex items-center gap-2 text-xs text-muted"><Clock size={12} />Aucun message envoyé</span>
                        )}
                      </Link>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        {prospect.linkedinUrl ? <ContactLink href={prospect.linkedinUrl} icon={ExternalLink} label="LinkedIn" /> : null}
                        {prospect.channels.email.value ? <ContactLink href={`mailto:${prospect.channels.email.value}`} icon={Mail} label={prospect.channels.email.value} /> : null}
                        {prospect.channels.whatsapp.value ? <ContactLink href={`https://wa.me/${prospect.channels.whatsapp.normalizedValue?.replace(/\D/g, "") ?? ""}`} icon={MessageCircle} label={prospect.channels.whatsapp.value} /> : null}
                        {prospect.contactId ? (
                          <Link className="ml-auto inline-flex items-center gap-1 text-brand-blue" href={prospectDetailHref(workspaceSlug, prospect.contactId, campaignPath)}>
                            Fiche CRM <ExternalLink size={11} />
                          </Link>
                        ) : null}
                      </div>
                      {activity?.relaunchesCancelled ? (
                        <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700"><CheckCircle2 size={12} />Relances annulées après la réponse</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-5 xl:sticky xl:top-20">
          {selectedProspect || selectedEngagement ? (
            <ProspectConversationPanel
              campaignPath={campaignPath}
              conversation={selectedConversation}
              engagement={selectedEngagement}
              prospect={selectedProspect}
              workspaceSlug={workspaceSlug}
            />
          ) : (
            <section className="panel">
              <div className="panel-body py-10 text-center">
                <MessageCircle className="mx-auto text-muted" size={26} />
                <h2 className="mt-3 font-semibold">Activité du prospect</h2>
                <p className="mt-2 text-xs leading-5 text-muted">Sélectionnez un prospect pour consulter ses messages, la décision K3 et l’état de ses relances.</p>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Send size={15} /> Autopilote</h2></div>
            <div className="divide-y divide-line">
              {CHANNELS.map((channel) => {
                const assessment = plan.assessments.find((item) => item.channel === channel);
                const campaign = campaignDetails.find((item) => item.channel === channel);
                const Icon = channelIcon(channel);
                return (
                  <div className="px-5 py-4" key={channel}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm font-semibold"><Icon size={15} />{channelLabel(channel)}</span>
                      <span className={channelBadge(assessment?.recommendation, campaign)}>{channelStatus(assessment?.status, assessment?.recommendation, campaign)}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted">{channelDescription(assessment?.status, campaign)}</p>
                  </div>
                );
              })}
            </div>
            {campaignDetails.find((campaign) => campaign.channel === "email") ? (
              <EmailAutopilotSummary campaign={campaignDetails.find((campaign) => campaign.channel === "email")!} />
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}

function CampaignAutomationJourney({
  campaigns,
  dashboards,
  engagements,
}: {
  campaigns: readonly CampaignDetail[];
  dashboards: readonly CampaignAutopilotDashboard[];
  engagements: readonly CampaignEngagementOverview[];
}) {
  if (!campaigns.length) return null;
  return (
    <section className="panel mb-5 overflow-hidden" aria-label="Déroulé automatique de la prospection">
      <div className="panel-header">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Bot size={16} />Déroulé automatique</h2>
          <p className="mt-1 text-xs text-muted">Chaque canal avance seul. Une réponse arrête immédiatement les relances et passe la main au Setter IA.</p>
        </div>
        <span className="badge badge-success">sans validation manuelle</span>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-3">
        {campaigns.map((campaign) => {
          if (!campaign.channel) return null;
          const channel = campaign.channel;
          const Icon = channelIcon(channel);
          const engagement = engagements.find((item) => item.campaignId === campaign.id);
          const dashboard = dashboards.find((item) => item.campaignId === campaign.id);
          const pendingFollowUps = engagement?.prospects.reduce((total, item) => total + item.pendingFollowUps, 0) ?? 0;
          const policy = resolveCampaignAutopilotPolicy(campaign.autopilotPolicy, channel);
          return (
            <article className="rounded-xl border border-line bg-slate-50/60 p-4" key={campaign.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon size={15} />{channelLabel(channel)}</h3>
                  <p className="mt-1 text-[11px] text-muted">{policy.schedule.windowStart}–{policy.schedule.windowEnd} · heure du destinataire</p>
                </div>
                <span className={dashboard?.health === "attention" ? "badge badge-danger" : policy.enabled ? "badge badge-success" : "badge"}>
                  {dashboard?.health === "attention" ? "à surveiller" : policy.enabled ? "actif" : "pause"}
                </span>
              </div>

              {dashboard ? (
                <div className="mt-3 rounded-lg border border-brand-blue/15 bg-white px-3 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Étape actuelle</span>
                  <span className="mt-0.5 block text-xs font-semibold text-brand-blue">{autopilotStepLabel(dashboard.currentStep)}</span>
                </div>
              ) : null}

              <ol className="mt-4 space-y-2">
                <li className="flex items-center gap-2 text-xs">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-white"><RefreshCw size={12} /></span>
                  <span className="flex-1"><strong>Recherche</strong><span className="block text-[10px] text-muted">Tous les jours à 06:00</span></span>
                  <span className="font-semibold">{dashboard?.counts.discovered ?? campaign.prospectCount}</span>
                </li>
                {campaign.steps.map((step) => (
                  <li className="flex items-center gap-2 text-xs" key={`${campaign.id}:${step.position}`}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-white font-bold">{step.position}</span>
                    <span className="flex-1"><strong>{sequenceStepLabel(step.kind, step.position)}</strong><span className="block text-[10px] text-muted">Personnalisation IA · J+{step.delayDays}</span></span>
                  </li>
                ))}
                <li className="flex items-center gap-2 text-xs">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-violet-200 bg-violet-50"><Bot size={12} /></span>
                  <span className="flex-1"><strong>Réponse & qualification</strong><span className="block text-[10px] text-muted">K3 répond, qualifie et propose le rendez-vous</span></span>
                </li>
              </ol>

              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                <JourneyMetric label="Envois" value={dashboard?.counts.sent ?? engagement?.metrics.contacted ?? 0} />
                <JourneyMetric label="Setter" value={dashboard?.counts.setterReplies ?? 0} />
                <JourneyMetric label="RDV" value={dashboard?.counts.bookedMeetings ?? 0} />
              </div>
              {pendingFollowUps > 0 ? <p className="mt-2 text-center text-[10px] text-muted">{pendingFollowUps} relance{pendingFollowUps > 1 ? "s" : ""} planifiée{pendingFollowUps > 1 ? "s" : ""}</p> : null}
              {dashboard?.exceptions.length ? (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-800">
                  {dashboard.exceptions.reduce((total, item) => total + item.count, 0)} exception{dashboard.exceptions.length > 1 ? "s" : ""} technique{dashboard.exceptions.length > 1 ? "s" : ""} détectée{dashboard.exceptions.length > 1 ? "s" : ""}.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function autopilotStepLabel(step: CampaignAutopilotDashboard["currentStep"]): string {
  return ({
    research: "Recherche de prospects",
    enrichment: "Enrichissement et déduplication",
    composition: "Personnalisation par K3",
    outreach: "Envois et relances",
    setter: "Qualification des réponses",
    meeting: "Prise de rendez-vous",
    completed: "Campagne terminée",
    attention: "Correction automatique en cours",
  } as const)[step];
}

function JourneyMetric({ label, value }: { label: string; value: number }) {
  return <div><strong className="block text-sm">{value}</strong><span className="text-[10px] text-muted">{label}</span></div>;
}

function sequenceStepLabel(kind: string, position: number): string {
  if (kind === "linkedin_invite") return "Invitation LinkedIn";
  if (kind === "linkedin_message") return position === 1 ? "Premier message" : "Relance LinkedIn";
  if (kind === "email") return position === 1 ? "Premier email" : "Relance email";
  if (kind === "whatsapp") return position === 1 ? "Premier WhatsApp" : "Relance WhatsApp";
  return "Action automatique";
}

function EmailAutopilotSummary({ campaign }: { campaign: CampaignDetail }) {
  const policy = resolveCampaignAutopilotPolicy(campaign.autopilotPolicy, "email");
  const activeDays = policy.schedule.activeDays.map((day) => ({
    1: "lun",
    2: "mar",
    3: "mer",
    4: "jeu",
    5: "ven",
    6: "sam",
    7: "dim",
  })[day] ?? String(day)).join(", ");
  return (
    <div className="border-t border-line bg-slate-50/60 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <strong className="flex items-center gap-2 text-xs"><Mail size={14} />Autopilote email</strong>
        <span className={policy.enabled ? "badge badge-success" : "badge"}>{policy.enabled ? "automatique" : "en pause"}</span>
      </div>
      <div className="grid gap-2 text-[11px] sm:grid-cols-2 xl:grid-cols-1">
        <AutopilotSetting label="Planning" value={`${activeDays} · ${policy.schedule.windowStart}–${policy.schedule.windowEnd} · heure destinataire`} />
        <AutopilotSetting label="Premier email" value={`IA personnalisée · langue ${policy.email.language === "auto" ? "automatique" : policy.email.language.toUpperCase()}`} />
        <AutopilotSetting label="Relances" value={`${policy.email.followUpDelaysBusinessDays.length} · J+${policy.email.followUpDelaysBusinessDays.join(" et J+")} ouvrés`} />
        <AutopilotSetting
          label="Réponses"
          value={policy.email.autoReplyEnabled
            ? `K3 automatique · délai ${policy.email.replyDelayMinutes} min${policy.email.stopOnHumanActivity ? " · arrêt si humain" : ""}`
            : "Réponses automatiques désactivées"}
        />
      </div>
    </div>
  );
}

function AutopilotSetting({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <span className="font-semibold text-navy">{label}</span>
      <span className="mt-0.5 block text-muted">{value}</span>
    </div>
  );
}

function ProspectConversationPanel({
  campaignPath,
  conversation,
  engagement,
  prospect,
  workspaceSlug,
}: {
  campaignPath: string;
  conversation: CampaignConversationDetail | null;
  engagement: CampaignProspectEngagement | null;
  prospect: AggregatedProspect | null;
  workspaceSlug: string;
}) {
  const fullName = prospect?.fullName ?? engagement?.fullName ?? "Prospect";
  return (
    <section className="panel overflow-hidden">
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{fullName}</h2>
          <p className="mt-1 truncate text-xs text-muted">{prospect?.companyName ?? engagement?.companyName ?? "Entreprise à confirmer"}</p>
        </div>
        <Link aria-label="Fermer le panneau" className="button h-8 min-h-8 w-8 p-0" href={campaignPath} scroll={false}><X size={14} /></Link>
      </div>

      {conversation ? (
        <>
          <div className="max-h-[460px] space-y-3 overflow-y-auto bg-slate-50/70 p-4">
            {conversation.messages.map((message) => (
              <div className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`} key={message.id}>
                <div className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-5 ${message.direction === "outbound" ? "bg-navy text-white" : "border border-line bg-white text-ink"}`}>
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  <p className={`mt-1 text-[10px] ${message.direction === "outbound" ? "text-slate-300" : "text-muted"}`}>
                    {message.direction === "outbound" ? message.senderType === "ai" ? "Réponse IA" : "Outbound" : "Prospect"} · {formatDate(message.occurredAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3 border-t border-line p-4">
            {conversation.decision ? (
              <div className="rounded-lg border border-brand-blue/20 bg-blue-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-xs">Décision K3</strong>
                  <span className="badge badge-signal">{Math.round(conversation.decision.confidence * 100)}%</span>
                </div>
                <p className="mt-2 text-xs"><strong>{intentLabel(conversation.decision.intent)}</strong> · {actionLabel(conversation.decision.action)}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted">{conversation.decision.rationale}</p>
                <p className="mt-2 text-[10px] text-muted">{conversation.decision.provider ?? "IA"} · {conversation.decision.model ?? "modèle configuré"}</p>
              </div>
            ) : null}

            {conversation.automatedReply ? (
              <div className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-xs">Réponse automatique</strong>
                  <span className={conversation.automatedReply.status === "sent" ? "badge badge-success" : conversation.automatedReply.status === "failed" ? "badge badge-danger" : "badge badge-warning"}>
                    {replyStatusLabel(conversation.automatedReply.status)}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">{conversation.automatedReply.body}</p>
              </div>
            ) : null}

            {conversation.relaunchesCancelled ? (
              <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700"><CheckCircle2 size={14} />{conversation.cancelledFollowUps} relance{conversation.cancelledFollowUps > 1 ? "s" : ""} annulée{conversation.cancelledFollowUps > 1 ? "s" : ""}</p>
            ) : conversation.pendingFollowUps > 0 ? (
              <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><Clock size={14} />{conversation.pendingFollowUps} relance{conversation.pendingFollowUps > 1 ? "s" : ""} planifiée{conversation.pendingFollowUps > 1 ? "s" : ""}</p>
            ) : null}

            {conversation.opportunity ? (
              <p className="flex items-center gap-2 rounded-lg bg-lime-50 px-3 py-2 text-xs text-lime-900"><Calendar size={14} />{opportunityLabel(conversation.opportunity.stage)}</p>
            ) : null}

            {conversation.meeting ? (
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="flex items-center gap-1.5 text-xs"><Calendar size={13} />Rendez-vous</strong>
                  <span className={conversation.meeting.status === "booked" || conversation.meeting.status === "rescheduled" ? "badge badge-success" : conversation.meeting.status === "cancelled" ? "badge" : "badge badge-signal"}>
                    {meetingStatusLabel(conversation.meeting.status)}
                  </span>
                </div>
                {conversation.meeting.bookedStartAt ? (
                  <p className="mt-2 text-xs font-medium">{formatDate(conversation.meeting.bookedStartAt)}</p>
                ) : null}
                {conversation.meeting.status === "offered" && conversation.meeting.proposedSlots.length ? (
                  <ol className="mt-2 space-y-1 text-[11px] text-muted">
                    {conversation.meeting.proposedSlots.map((slot) => <li key={slot.position}>{slot.position}. {slot.label}</li>)}
                  </ol>
                ) : null}
                {conversation.meeting.meetingUrl ? <a className="mt-2 inline-flex text-[11px] font-semibold text-brand-blue" href={conversation.meeting.meetingUrl} rel="noreferrer" target="_blank">Ouvrir le rendez-vous <ExternalLink className="ml-1" size={11} /></a> : null}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="panel-body py-8 text-center">
          <Clock className="mx-auto text-muted" size={22} />
          <h3 className="mt-3 text-sm font-semibold">Aucune réponse reçue</h3>
          <p className="mt-2 text-xs leading-5 text-muted">
            {engagement?.sentCount
              ? `${engagement.sentCount} message${engagement.sentCount > 1 ? "s" : ""} envoyé${engagement.sentCount > 1 ? "s" : ""}. ${engagement.pendingFollowUps} relance${engagement.pendingFollowUps > 1 ? "s" : ""} encore planifiée${engagement.pendingFollowUps > 1 ? "s" : ""}.`
              : "Ce prospect n’a pas encore été contacté."}
          </p>
          {prospect?.contactId ? <Link className="mt-4 inline-flex text-xs font-semibold text-brand-blue" href={prospectDetailHref(workspaceSlug, prospect.contactId, campaignPath)}>Ouvrir la fiche CRM</Link> : null}
        </div>
      )}
    </section>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Target; label: string; value: number; tone?: "success" | "signal" }) {
  return (
    <div className={`panel p-4 ${tone === "success" ? "border-emerald-200" : tone === "signal" ? "border-lime-300" : ""}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted"><Icon size={14} />{label}</div>
      <div className="metric-value mt-2">{value}</div>
    </div>
  );
}

function aggregateProspects(campaigns: readonly CampaignDetail[]): AggregatedProspect[] {
  const prospects = new Map<string, AggregatedProspect>();
  for (const campaign of campaigns) {
    if (!campaign.channel) continue;
    for (const prospect of campaign.prospects) {
      const key = prospectKey(prospect);
      const current = prospects.get(key);
      const campaignChannels = Array.from(new Set([...(current?.campaignChannels ?? []), campaign.channel]));
      if (!current || (prospect.score ?? 0) > (current.score ?? 0)) prospects.set(key, { ...prospect, campaignChannels });
      else prospects.set(key, { ...current, campaignChannels });
    }
  }
  return Array.from(prospects.values()).sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

function prospectKey(prospect: CampaignProspect): string {
  return prospect.contactId
    ?? prospect.linkedinUrl
    ?? prospect.channels.email.normalizedValue
    ?? prospect.channels.whatsapp.normalizedValue
    ?? prospect.candidateId;
}

function ContactLink({ href, icon: Icon, label }: { href: string; icon: typeof Mail; label: string }) {
  return <a className="inline-flex max-w-full items-center gap-1 rounded border border-line px-2 py-1 text-brand-blue hover:border-brand-blue" href={href} rel="noreferrer" target="_blank"><Icon size={12} /><span className="truncate">{label}</span></a>;
}

function ProspectStateBadge({ eligible, state }: { eligible: boolean; state: ProspectEngagementState }) {
  if (!eligible) return <span className="badge">exclu</span>;
  const className = state === "meeting" || state === "qualified"
    ? "badge badge-success"
    : state === "refused"
      ? "badge badge-danger"
      : state === "replied"
        ? "badge badge-signal"
        : state === "sent"
          ? "badge badge-warning"
          : "badge";
  return <span className={className}>{stateLabel(state)}</span>;
}

function stateLabel(state: ProspectEngagementState): string {
  return ({ not_contacted: "non contacté", sent: "envoyé", replied: "répondu", qualified: "qualifié", refused: "refus", meeting: "rendez-vous" })[state];
}

function meetingStatusLabel(status: string): string {
  return ({
    offered: "créneaux proposés",
    booked: "réservé",
    rescheduled: "déplacé",
    cancelled: "annulé",
    expired: "expiré",
    superseded: "remplacé",
  } as Record<string, string>)[status] ?? status;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(value));
}

function channelIcon(channel: Channel) {
  return channel === "linkedin" ? AtSign : channel === "email" ? Mail : MessageCircle;
}

function channelLabel(channel: Channel): string {
  return channel === "linkedin" ? "LinkedIn" : channel === "email" ? "Email" : "WhatsApp";
}

function campaignBadge(campaigns: readonly CampaignDetail[]): string {
  if (campaigns.some(isActionableCampaignException)) return "badge badge-danger";
  if (campaigns.some((campaign) => ["running", "completed"].includes(campaign.automationStage))) return "badge badge-success";
  return "badge badge-warning";
}

function campaignStatus(planStatus: string, campaigns: readonly CampaignDetail[]): string {
  if (campaigns.some(isActionableCampaignException)) return "Exception technique";
  if (campaigns.some((campaign) => campaign.automationStage === "running")) return "Prospection active";
  if (campaigns.some((campaign) => campaign.automationStage === "scheduled")) return "Envois planifiés";
  if (campaigns.some((campaign) => campaign.automationStage === "composing")) return "Personnalisation IA";
  if (campaigns.some((campaign) => campaign.automationStage === "enriching")) return "Enrichissement";
  if (campaigns.some((campaign) => campaign.discoveryStatus === "running")) return "Recherche en cours";
  if (campaigns.length && campaigns.every((campaign) => campaign.automationErrorCode === "NO_PROSPECTS_FOUND")) return "Aucune cible trouvée";
  if (campaigns.length && campaigns.every((campaign) => ["completed", "attention"].includes(campaign.automationStage))) return "Prospection terminée";
  if (campaigns.some((campaign) => campaign.automationStage === "sourcing")) return "Recherche non lancée";
  return planStatus === "assessing" ? "Préparation" : "Prête";
}

function channelBadge(recommendation: string | null | undefined, campaign: CampaignSummary | undefined): string {
  if (campaign && isActionableCampaignException(campaign)) return "badge badge-danger";
  if (campaign?.automationErrorCode === "NO_PROSPECTS_FOUND") return "badge";
  if (campaign) return "badge badge-success";
  return recommendation === "optional" ? "badge" : "badge";
}

function channelStatus(status: string | undefined, recommendation: string | null | undefined, campaign: CampaignSummary | undefined): string {
  if (campaign && isActionableCampaignException(campaign)) return "incident";
  if (campaign?.automationErrorCode === "NO_PROSPECTS_FOUND") return "aucune cible";
  if (campaign?.discoveryStatus === "running") return "recherche";
  if (campaign?.automationStage === "sourcing" && !campaign.discoveryRunId) return "non lancée";
  if (campaign) return "actif";
  if (status === "running" || status === "pending") return "évaluation";
  if (status === "failed") return "indisponible";
  return recommendation === "optional" ? "optionnel" : "non retenu";
}

function channelDescription(status: string | undefined, campaign: CampaignDetail | undefined): string {
  if (!campaign) return status === "running" ? "Faisabilité en cours de mesure." : "Canal non retenu par l’autopilote.";
  if (campaign.discoveryStatus === "running") return "La recherche de prospects est réellement en cours.";
  if (campaign.automationStage === "sourcing" && !campaign.discoveryRunId) return "La recherche n’a pas encore été lancée.";
  if (campaign.automationErrorCode === "NO_PROSPECTS_FOUND") return "Recherche terminée sans prospect suffisamment fiable.";
  return `${campaign.prospects.length} cibles · ${campaign.steps.length} étapes · score ${campaign.assessmentScore ?? 0}/100`;
}

function intentLabel(intent: string): string {
  return ({ positive: "Intérêt positif", question: "Question", objection: "Objection", not_interested: "Pas intéressé", unsubscribe: "Désinscription", meeting_request: "Demande de rendez-vous", other: "Autre" } as Record<string, string>)[intent] ?? intent;
}

function actionLabel(action: string): string {
  return ({ reply: "réponse", stop: "arrêt", booking: "réservation" } as Record<string, string>)[action] ?? action;
}

function replyStatusLabel(status: string): string {
  return ({ scheduled: "planifiée", sending: "envoi", sent: "envoyée", failed: "échec", cancelled: "annulée" } as Record<string, string>)[status] ?? status;
}

function opportunityLabel(stage: string): string {
  return stage === "meeting_requested" ? "Rendez-vous demandé" : stage === "meeting_booked" ? "Rendez-vous réservé" : "Prospect qualifié";
}
