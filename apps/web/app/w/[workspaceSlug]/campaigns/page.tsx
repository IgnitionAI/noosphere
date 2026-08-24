import {
  AtSign,
  ArrowRight,
  Archive,
  CheckCircle2,
  LoaderCircle,
  Mail,
  MessageCircle,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import {
  getProspectingPlan,
  listCampaigns,
  listProspectingPlans,
  type CampaignSummary,
  type ProspectingPlanDetail,
} from "@/lib/api";
import { CampaignAutoRefresh } from "./campaign-auto-refresh";

export const metadata = { title: "Prospection" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ runId?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { runId } = await searchParams;
  const [planList, campaignList] = await Promise.all([
    listProspectingPlans(workspaceSlug),
    listCampaigns(workspaceSlug),
  ]);
  const planSummaries = planList.data.filter((plan) => !runId || plan.icpRunId === runId);
  const plans = await Promise.all(
    planSummaries.map((plan) => getProspectingPlan(workspaceSlug, plan.id)),
  );
  const campaigns = campaignList.data.filter((campaign) => campaign.status !== "archived");
  const assessingCount = plans.filter((plan) => plan.status === "assessing").length;
  const legacyCount = campaignList.data.filter(
    (campaign) => campaign.status === "archived" && campaign.planId === null,
  ).length;

  return (
    <>
      <CampaignAutoRefresh enabled={
        assessingCount > 0
        || campaigns.some((campaign) => ["sourcing", "enriching", "composing"].includes(campaign.automationStage))
      } />
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="badge badge-signal w-fit"><Target size={13} /> Pipeline autonome</div>
          <h1 className="page-title mt-3">Prospection</h1>
          <p className="mt-2 text-sm text-muted">
            Lancez un ICP. La plateforme crée les campagnes, trouve les prospects, les contacte et réserve les appels.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="button" href={`/w/${workspaceSlug}/prospects`}><Users size={14} /> Tous les prospects</Link>
          <Link className="button button-primary" href={`/w/${workspaceSlug}/strategy/product-reading`}>Lancer un nouvel ICP <ArrowRight size={14} /></Link>
        </div>
      </header>

      {assessingCount > 0 ? (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-brand-blue/25 bg-blue-50 px-4 py-3 text-xs text-ink">
          <LoaderCircle className="shrink-0 animate-spin text-brand-blue" size={16} />
          L’autopilote évalue encore les canaux de {assessingCount} ICP. Les campagnes retenues apparaîtront ici automatiquement.
        </div>
      ) : null}

      {plans.length === 0 ? (
        <section className="panel">
          <div className="panel-body py-12 text-center">
            <Target className="mx-auto text-muted" size={28} />
            <h2 className="mt-3 text-sm font-semibold">Aucune campagne prête</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Lancez une étude ICP. L’autopilote choisira les canaux utiles et créera les campagnes sans configuration manuelle.
            </p>
            <Link className="button button-primary mt-5 inline-flex" href={`/w/${workspaceSlug}/strategy/product-reading`}>
              Lancer mon premier ICP
            </Link>
          </div>
        </section>
      ) : (
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div>
              <h2 className="font-semibold">Prospection en pilote automatique</h2>
              <p className="mt-1 text-xs text-muted">Recherche, enrichissement, personnalisation et relances sont suivis campagne par campagne.</p>
            </div>
            <span className="badge badge-success"><CheckCircle2 size={12} /> Autopilote actif</span>
          </div>
          <div className="hidden grid-cols-[minmax(220px,1.5fr)_150px_130px_130px_24px] border-b border-line bg-slate-50/70 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted md:grid">
            <span>Campagne</span>
            <span>État</span>
            <span>Canal</span>
            <span>Prospects · score</span>
            <span />
          </div>
          <div className="divide-y divide-line">
            {plans.map((plan) => {
              const activeCampaigns = campaigns.filter((campaign) => campaign.planId === plan.id);
              const channels = activeCampaigns
                .map((campaign) => campaign.channel)
                .filter((channel): channel is NonNullable<CampaignSummary["channel"]> => channel !== null);
              const prospectCount = plan.campaigns
                .filter((campaign) => campaign.status !== "archived")
                .reduce((total, campaign) => total + campaign.prospectCount, 0);
              const score = bestScore(activeCampaigns);
              return (
                <Link
                  className="group grid gap-4 px-5 py-4 transition hover:bg-slate-50 md:grid-cols-[minmax(220px,1.5fr)_150px_130px_130px_24px] md:items-center"
                  href={`/w/${workspaceSlug}/campaigns/plans/${plan.id}`}
                  key={plan.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-ink">
                      <Target size={17} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{plan.icpName}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted">{plan.name}</p>
                    </div>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted md:hidden">État</span>
                    <span className={planBadge(activeCampaigns)}>{planStatus(plan, activeCampaigns)}</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted md:hidden">Canal</span>
                    <span className="flex flex-wrap gap-1.5">
                      {channels.length ? channels.map((channel) => {
                        const ChannelIcon = channelIcon(channel);
                        return <span className="inline-flex items-center gap-1 text-xs font-medium capitalize" key={channel}><ChannelIcon size={13} /><span className="sr-only">{channel}</span></span>;
                      }) : <span className="text-xs text-muted">en préparation</span>}
                    </span>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted md:hidden">Prospects</span>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><Users size={14} />{prospectCount}</span>
                    <span className="ml-2 text-xs text-muted">· {score}/100</span>
                  </div>
                  <ArrowRight className="hidden text-muted transition group-hover:translate-x-0.5 group-hover:text-brand-blue md:block" size={16} />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {legacyCount ? (
        <div className="mt-6 flex items-center gap-2 text-xs text-muted"><Archive size={14} />{legacyCount} campagnes historiques archivées et conservées pour audit.</div>
      ) : null}
    </>
  );
}

function channelIcon(channel: CampaignSummary["channel"]) {
  if (channel === "linkedin") return AtSign;
  if (channel === "email") return Mail;
  if (channel === "whatsapp") return MessageCircle;
  return Target;
}

function planBadge(campaigns: readonly CampaignSummary[]): string {
  if (campaigns.some((campaign) => campaign.automationStage === "attention")) return "badge badge-danger";
  if (campaigns.some((campaign) => ["running", "completed"].includes(campaign.automationStage))) return "badge badge-success";
  return "badge badge-warning";
}

function planStatus(plan: ProspectingPlanDetail, campaigns: readonly CampaignSummary[]): string {
  if (campaigns.some((campaign) => campaign.automationStage === "attention")) return "À surveiller";
  if (campaigns.some((campaign) => campaign.automationStage === "running")) return "Active";
  if (campaigns.length && campaigns.every((campaign) => campaign.automationStage === "completed")) return "Terminée";
  if (campaigns.some((campaign) => campaign.automationStage === "scheduled")) return "Planifiée";
  if (campaigns.some((campaign) => campaign.automationStage === "composing")) return "Personnalisation";
  if (campaigns.some((campaign) => campaign.automationStage === "enriching")) return "Enrichissement";
  if (campaigns.some((campaign) => campaign.discoveryStatus === "running")) return "Recherche en cours";
  if (campaigns.some((campaign) => campaign.automationStage === "sourcing")) return "Recherche continue";
  return plan.status === "assessing" ? "Préparation" : "Prête";
}

function bestScore(campaigns: readonly CampaignSummary[]): number {
  return campaigns.reduce((best, campaign) => Math.max(best, campaign.assessmentScore ?? 0), 0);
}
