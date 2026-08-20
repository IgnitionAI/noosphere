import { AtSign, Filter, Mail, MessageCircle, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { getProspectView, listProspectViews, listSignals, OutboundApiError, type IntentSignal, type SignalType } from "@/lib/api";
import { ProspectActivityDrawer } from "@/components/prospect-activity-drawer";

export const metadata = { title: "Prospects" };
export const dynamic = "force-dynamic";

export default async function ProspectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    search?: string;
    icp?: string;
    campaign?: string;
    campaignScope?: "in_campaign" | "outside_campaign";
    channel?: string;
    status?: "active" | "suppressed";
    period?: "today" | "7d" | "30d" | "90d";
    signalType?: SignalType;
    signalFreshness?: "current" | "history";
    prospect?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const result = await listProspectViews(workspaceSlug, {
    ...(query.search ? { search: query.search } : {}),
    ...(query.icp ? { icpVersionId: query.icp } : {}),
    ...(query.campaign ? { campaignId: query.campaign } : {}),
    ...(!query.campaign && query.campaignScope ? { campaignScope: query.campaignScope } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.period ? { period: query.period } : {}),
  });
  let signals: IntentSignal[] = [];
  try { signals = (await listSignals(workspaceSlug)).data; }
  catch (error) { if (!(error instanceof OutboundApiError && (error.status === 401 || error.status === 403))) throw error; }
  const signalIds = query.signalType || query.signalFreshness ? new Set((await listSignals(workspaceSlug, { ...(query.signalType ? { signalType: query.signalType } : {}), includeExpired: query.signalFreshness === "history" })).data.map((signal) => signal.entityId)) : null;
  const visibleProspects = signalIds ? result.data.filter((prospect) => signalIds.has(prospect.id)) : result.data;
  const signalsByContact = new Map<string, IntentSignal[]>();
  for (const signal of signals) signalsByContact.set(signal.entityId, [...(signalsByContact.get(signal.entityId) ?? []), signal]);
  const selected = query.prospect ? await getProspectView(workspaceSlug, query.prospect) : null;
  const listHref = prospectListHref(workspaceSlug, query);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Prospects</h1>
          <p className="mt-2 text-sm text-muted">
            ICP, canaux disponibles, avis IA et conversations dans une seule vue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge">{visibleProspects.length} affiché{visibleProspects.length > 1 ? "s" : ""}</span>
          <Link className="button button-signal" href={`/w/${workspaceSlug}/prospects/discover`}>Nouvelle recherche</Link>
        </div>
      </header>

      <section className="panel mb-5">
        <form className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5" method="get">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 text-muted" size={15} />
            <input className="control w-full pl-9" name="search" defaultValue={query.search ?? ""} placeholder="Nom ou prénom…" />
          </label>
          <select className="control" name="icp" defaultValue={query.icp ?? ""}>
            <option value="">Tous les ICP</option>
            {result.filters.icps.map((icp) => <option value={icp.id} key={icp.id}>{icp.name}</option>)}
          </select>
          <select className="control" name="campaignScope" defaultValue={query.campaignScope ?? ""}>
            <option value="">Tous les prospects</option>
            <option value="in_campaign">En campagne</option>
            <option value="outside_campaign">Hors campagne</option>
          </select>
          <select className="control" name="campaign" defaultValue={query.campaign ?? ""}>
            <option value="">Toutes les campagnes</option>
            {result.filters.campaigns.map((campaign) => (
              <option value={campaign.id} key={campaign.id}>{campaign.name}</option>
            ))}
          </select>
          <select className="control" name="channel" defaultValue={query.channel ?? ""}>
            <option value="">Tous les canaux</option>
            <option value="linkedin">LinkedIn</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <select className="control" name="signalType" defaultValue={query.signalType ?? ""}>
            <option value="">Tous les signaux</option>
            <option value="hiring">Recrute</option><option value="funding">Levée de fonds</option><option value="job_change">Changement de poste</option><option value="leadership_change">Changement de direction</option><option value="geographic_expansion">Expansion géographique</option><option value="public_activity">Activité publique</option><option value="technology">Technologie</option><option value="competitor">Concurrent</option>
          </select>
          <select className="control" name="signalFreshness" defaultValue={query.signalFreshness ?? ""}><option value="">Fraîcheur indifférente</option><option value="current">Signaux actuels</option><option value="history">Inclure l’historique</option></select>
          <select aria-label="Statut du contact" className="control" name="status" defaultValue={query.status ?? ""}>
            <option value="">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="suppressed">Suspendus</option>
          </select>
          <select aria-label="Période prospect" className="control" name="period" defaultValue={query.period ?? ""}>
            <option value="">Toute la période</option>
            <option value="today">Ajoutés ou actualisés aujourd’hui</option>
            <option value="7d">7 derniers jours</option>
            <option value="30d">30 derniers jours</option>
            <option value="90d">90 derniers jours</option>
          </select>
          <button className="button" type="submit"><Filter size={14} /> Filtrer</button>
        </form>
      </section>

      <div className="grid items-start gap-5">
        <section className="panel min-w-0 overflow-hidden">
          {visibleProspects.length === 0 ? (
            <div className="panel-body py-12 text-center">
              <UserRound className="mx-auto text-muted" size={28} />
              <h2 className="mt-3 font-semibold">Aucun prospect avec ces filtres</h2>
              <p className="mt-2 text-sm text-muted">La recherche quotidienne ajoutera automatiquement les nouvelles cibles qualifiées.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {visibleProspects.map((prospect) => {
                const active = selected?.id === prospect.id;
                const bestIcp = prospect.icpMatches[0];
                return (
                  <Link
                    className={`block p-4 transition hover:bg-slate-50 ${active ? "bg-blue-50/70" : ""}`}
                    href={`${listHref}${listHref.includes("?") ? "&" : "?"}prospect=${prospect.id}`}
                    key={prospect.id}
                    scroll={false}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-navy"><UserRound size={17} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm">{prospect.firstName} {prospect.lastName}</strong>
                          {bestIcp?.score !== null && bestIcp?.score !== undefined ? <span className="badge badge-signal">{bestIcp.score}/100</span> : null}
                          {prospect.conversation?.decision?.intent === "positive" || prospect.conversation?.decision?.intent === "meeting_request" ? <span className="badge badge-success">chaud</span> : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted">
                          {prospect.currentEmployment ? `${prospect.currentEmployment.title} · ${prospect.currentEmployment.companyName}` : bestIcp?.headline ?? "Fonction à confirmer"}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {bestIcp ? <span className="badge">{bestIcp.icpName}</span> : <span className="badge">hors campagne</span>}
                          <ChannelBadges channels={prospect.channels} />
                        </div>
                        <p className="mt-3 truncate text-xs text-ink">
                          {prospect.conversation?.lastMessage?.body ?? prospect.aiOpinion?.summary ?? "Pas encore de conversation."}
                        </p>
                        <SignalPriorityExplanation signals={[...(signalsByContact.get(prospect.id) ?? []), ...(prospect.currentEmployment ? signalsByContact.get(prospect.currentEmployment.companyId) ?? [] : [])]} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {selected ? <ProspectActivityDrawer prospect={selected} workspaceSlug={workspaceSlug} closeHref={listHref} /> : null}
      </div>
    </>
  );
}

function ChannelBadges({ channels }: { channels: { linkedin: boolean; email: boolean; whatsapp: boolean } }) {
  return <>{channels.linkedin ? <span className="badge"><AtSign size={11} /> LinkedIn</span> : null}{channels.email ? <span className="badge"><Mail size={11} /> Email</span> : null}{channels.whatsapp ? <span className="badge"><MessageCircle size={11} /> WhatsApp</span> : null}</>;
}

function prospectListHref(workspaceSlug: string, query: { search?: string; icp?: string; campaign?: string; campaignScope?: string; channel?: string; signalType?: string; signalFreshness?: string; status?: string; period?: string }) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.icp) params.set("icp", query.icp);
  if (query.campaign) params.set("campaign", query.campaign);
  if (query.campaignScope) params.set("campaignScope", query.campaignScope);
  if (query.channel) params.set("channel", query.channel);
  if (query.signalType) params.set("signalType", query.signalType);
  if (query.signalFreshness) params.set("signalFreshness", query.signalFreshness);
  if (query.status) params.set("status", query.status);
  if (query.period) params.set("period", query.period);
  return `/w/${workspaceSlug}/prospects${params.size ? `?${params.toString()}` : ""}`;
}

function SignalPriorityExplanation({ signals }: { signals: readonly IntentSignal[] }) {
  const signal = signals[0];
  if (!signal) return null;
  const labels: Record<IntentSignal["signalType"], string> = { hiring: "recrute", funding: "levée de fonds", job_change: "changement de poste", leadership_change: "changement de direction", geographic_expansion: "expansion géographique", public_activity: "activité publique", technology: "technologie détectée", competitor: "signal concurrent" };
  return <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-brand-blue"><span className="badge badge-signal">Priorité</span> {labels[signal.signalType]} — observé le {formatSignalDate(signal.observedAt)}, source {signal.source}</p>;
}

function formatSignalDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)); }
