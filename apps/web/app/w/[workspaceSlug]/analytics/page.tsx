import Link from "next/link";
import {
  getAnalyticsBreakdown,
  getAnalyticsCosts,
  getAnalyticsFunnel,
  listCampaigns,
  listIcpVersions,
  listWorkspaces,
  type AnalyticsBreakdown,
  type AnalyticsBreakdownRow,
  type AnalyticsDimension,
  type AnalyticsFunnel,
  type AnalyticsQuery,
  type OutboundApiError,
} from "@/lib/api";
import { CrmPermissionState } from "@/components/crm-states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

const dimensions: readonly AnalyticsDimension[] = ["campaign", "icp", "channel", "role", "signal"];
const signalTypes = [
  ["hiring", "Recrutement"],
  ["funding", "Financement"],
  ["job_change", "Changement de poste"],
  ["leadership_change", "Changement de direction"],
  ["geographic_expansion", "Expansion géographique"],
  ["public_activity", "Activité publique"],
  ["technology", "Technologie"],
  ["competitor", "Concurrent"],
] as const;

const funnelLabels: readonly { key: keyof AnalyticsFunnel["metrics"]; label: string; description: string }[] = [
  { key: "prospectsFound", label: "Trouvés", description: "Prospects identifiés dans la période" },
  { key: "profilesEnriched", label: "Enrichis", description: "Profils enrichis" },
  { key: "actionsPlanned", label: "Planifiés", description: "Actions planifiées" },
  { key: "attempts", label: "Tentés", description: "Tentatives enregistrées" },
  { key: "actionsSent", label: "Envoyés", description: "Actions effectivement envoyées" },
  { key: "actionsAccepted", label: "Livrés", description: "Actions acceptées par le canal" },
  { key: "responded", label: "Répondus", description: "Contacts ayant répondu" },
  { key: "positiveReplies", label: "Réponses positives", description: "Réponses classées positives" },
  { key: "meetingsBooked", label: "Rendez-vous", description: "Rendez-vous pris" },
  { key: "opportunities", label: "Opportunités", description: "Opportunités enregistrées" },
  { key: "revenue", label: "Revenu", description: "Revenu attribué" },
];

const breakdownLabels: Record<AnalyticsDimension, string> = {
  campaign: "Campagnes",
  icp: "ICP",
  channel: "Canaux",
  role: "Rôles",
  signal: "Signaux",
};

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const filters: AnalyticsQuery = {
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.campaignId ? { campaignId: query.campaignId } : {}),
    ...(query.icpVersionId ? { icpVersionId: query.icpVersionId } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.role ? { role: query.role } : {}),
    ...(query.signalType ? { signalType: query.signalType } : {}),
  };
  let funnel: AnalyticsFunnel;
  let breakdowns: readonly AnalyticsBreakdown[];
  let campaigns: Awaited<ReturnType<typeof listCampaigns>>["data"] = [];
  let icpVersions: Awaited<ReturnType<typeof listIcpVersions>>["data"] = [];
  let costs: Awaited<ReturnType<typeof getAnalyticsCosts>> | null = null;

  try {
    const workspaceData = await listWorkspaces();
    const workspace = workspaceData.find((candidate) => candidate.slug === workspaceSlug);
    if (!workspace) return <CrmPermissionState resource="les analytics" />;
    const isPrivileged = workspace.role === "owner" || workspace.role === "admin";
    const [funnelData, campaignData, icpVersionData, ...breakdownData] = await Promise.all([
      getAnalyticsFunnel(workspaceSlug, filters),
      listCampaigns(workspaceSlug),
      listIcpVersions(workspaceSlug),
      ...dimensions.map((dimension) => getAnalyticsBreakdown(workspaceSlug, dimension, filters)),
    ]);
    funnel = funnelData;
    campaigns = campaignData.data;
    icpVersions = icpVersionData.data;
    breakdowns = breakdownData as AnalyticsBreakdown[];
    if (isPrivileged) costs = await getAnalyticsCosts(workspaceSlug, filters);
    return (
      <AnalyticsView
        workspaceSlug={workspaceSlug}
        query={query}
        funnel={funnel}
        breakdowns={breakdowns}
        campaigns={campaigns}
        icpVersions={icpVersions}
        costs={costs}
        isPrivileged={isPrivileged}
      />
    );
  } catch (error) {
    if (isForbidden(error)) return <CrmPermissionState resource="les analytics" />;
    throw error;
  }
}

function AnalyticsView({
  workspaceSlug,
  query,
  funnel,
  breakdowns,
  campaigns,
  icpVersions,
  costs,
  isPrivileged,
}: {
  workspaceSlug: string;
  query: Record<string, string | undefined>;
  funnel: AnalyticsFunnel;
  breakdowns: readonly AnalyticsBreakdown[];
  campaigns: Awaited<ReturnType<typeof listCampaigns>>["data"];
  icpVersions: Awaited<ReturnType<typeof listIcpVersions>>["data"];
  costs: Awaited<ReturnType<typeof getAnalyticsCosts>> | null;
  isPrivileged: boolean;
}) {
  const metrics = funnel.metrics;
  const hasData = Object.entries(metrics).some(([key, value]) => key !== "revenue" && value > 0);
  const dateFrom = query.from ?? dateInputValue(funnel.period.from);
  const dateTo = query.to ?? dateInputValue(funnel.period.to);
  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) exportParams.set(key, value);
  const exportHref = `/w/${workspaceSlug}/analytics/export${exportParams.toString() ? `?${exportParams}` : ""}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-blue">Pilotage</p>
          <h1 className="page-title mt-1">Analytics</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Entonnoir déterministe du workspace, ventilé par période et dimensions disponibles.
          </p>
        </div>
        {isPrivileged ? <a className="button button-primary shrink-0" href={exportHref}>Exporter en CSV</a> : null}
      </header>

      <section className="panel">
        <div className="panel-header"><div><h2 className="font-semibold">Filtres</h2><p className="mt-1 text-xs text-muted">La période est interprétée comme [from, to).</p></div></div>
        <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <label className="text-xs font-medium text-navy">Du<input className="control mt-1 w-full" name="from" type="date" defaultValue={dateFrom} /></label>
          <label className="text-xs font-medium text-navy">Au (exclu)<input className="control mt-1 w-full" name="to" type="date" defaultValue={dateTo} /></label>
          <label className="text-xs font-medium text-navy">Campagne<select className="control mt-1 w-full" defaultValue={query.campaignId ?? ""} name="campaignId"><option value="">Toutes</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
          <label className="text-xs font-medium text-navy">ICP<select className="control mt-1 w-full" defaultValue={query.icpVersionId ?? ""} name="icpVersionId"><option value="">Tous</option>{icpVersions.map((icp) => <option key={icp.id} value={icp.id}>{icp.name} · v{icp.version}</option>)}</select></label>
          <label className="text-xs font-medium text-navy">Canal<select className="control mt-1 w-full" defaultValue={query.channel ?? ""} name="channel"><option value="">Tous</option><option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="whatsapp">WhatsApp</option></select></label>
          <label className="text-xs font-medium text-navy">Rôle / fonction<input className="control mt-1 w-full" name="role" placeholder="Ex. VP Sales" defaultValue={query.role ?? ""} /></label>
          <label className="text-xs font-medium text-navy">Signal<select className="control mt-1 w-full" defaultValue={query.signalType ?? ""} name="signalType"><option value="">Tous</option>{signalTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="flex items-end gap-2"><button className="button button-primary" type="submit">Appliquer</button><Link className="button" href={`/w/${workspaceSlug}/analytics`}>Réinitialiser</Link></div>
        </form>
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header"><div><h2 className="font-semibold">Entonnoir</h2><p className="mt-1 text-xs text-muted">{formatPeriod(funnel.period.from, funnel.period.to)}</p></div>{!hasData ? <span className="badge">Aucune donnée</span> : null}</div>
        {!hasData ? <p className="px-5 pb-5 text-sm text-muted">Aucun fait analytique ne correspond aux filtres choisis.</p> : null}
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {funnelLabels.filter(({ key }) => isPrivileged || key !== "revenue").map(({ key, label, description }) => <div className="rounded-lg border border-line bg-slate-50/60 p-4" key={key}><p className="text-xs font-medium text-muted">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-navy">{formatNumber(metrics[key])}</p><p className="mt-1 text-[11px] leading-4 text-muted">{description}</p></div>)}
        </div>
        {!isPrivileged ? <p className="px-5 pb-5 text-xs text-muted">Le revenu et les coûts sont réservés aux rôles owner/admin.</p> : null}
      </section>

      {isPrivileged && costs ? <section className="panel"><div className="panel-header"><div><h2 className="font-semibold">Coûts IA</h2><p className="mt-1 text-xs text-muted">Calculés sur la même période et les mêmes filtres.</p></div></div><div className="grid gap-3 p-4 sm:grid-cols-3"><CostCard label="Coût total IA" value={formatCurrency(costs.totalAiCost)} /><CostCard label="Coût par prospect" value={formatCurrency(costs.costPerProspect)} /><CostCard label="Coût par rendez-vous" value={formatCurrency(costs.costPerMeeting)} /></div></section> : null}

      <section className="space-y-4"><div><h2 className="text-lg font-semibold text-navy">Breakdown</h2><p className="mt-1 text-sm text-muted">Performance par dimension exposée par le contrat Analytics.</p></div>{breakdowns.map((breakdown) => <BreakdownTable breakdown={breakdown} isPrivileged={isPrivileged} key={breakdown.dimension} />)}</section>
      <p className="text-xs text-muted">Les endpoints Analytics exposent des agrégats. Aucun drill-down vers des faits individuels n’est disponible dans le contrat actuel.</p>
    </div>
  );
}

function CostCard({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-line bg-slate-50/60 p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-xl font-semibold text-navy">{value}</p></div>; }

function BreakdownTable({ breakdown, isPrivileged }: { breakdown: AnalyticsBreakdown; isPrivileged: boolean }) {
  return <div className="panel overflow-hidden"><div className="panel-header"><h3 className="font-semibold">{breakdownLabels[breakdown.dimension]}</h3><span className="badge">{breakdown.data.length} lignes</span></div>{breakdown.data.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Aucune donnée pour cette dimension.</p> : <div className="overflow-x-auto"><table className="data-table min-w-[760px]"><thead><tr><th>Élément</th><th>Trouvés</th><th>Enrichis</th><th>Envoyés</th><th>Répondus</th><th>RDV</th><th>Opportunités</th>{isPrivileged ? <th>Revenu</th> : null}</tr></thead><tbody>{breakdown.data.map((row) => <BreakdownRow isPrivileged={isPrivileged} key={row.key} row={row} />)}</tbody></table></div>}</div>;
}

function BreakdownRow({ row, isPrivileged }: { row: AnalyticsBreakdownRow; isPrivileged: boolean }) {
  return <tr><td className="font-medium text-navy">{row.label || row.key}</td><td>{formatNumber(row.prospectsFound)}</td><td>{formatNumber(row.profilesEnriched)}</td><td>{formatNumber(row.actionsSent)}</td><td>{formatNumber(row.responded)}</td><td>{formatNumber(row.meetingsBooked)}</td><td>{formatNumber(row.opportunities)}</td>{isPrivileged ? <td>{formatCurrency(row.revenue)}</td> : null}</tr>;
}

function isForbidden(error: unknown): boolean { return Boolean(error && typeof error === "object" && "status" in error && (error as OutboundApiError).status === 403); }
function formatNumber(value: number | null): string {
  return value === null ? "n/d" : new Intl.NumberFormat("fr-FR").format(value);
}
function formatCurrency(value: number | null): string {
  return value === null ? "n/d" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);
}
function dateInputValue(value: string): string { return value.slice(0, 10); }
function formatPeriod(from: string, to: string): string { return `Période : ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(from))} → ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(to))}`; }
