import { Activity, ArrowRight, Bot, CheckCircle2, Clock3, Inbox, Kanban, Megaphone, RefreshCw, ShieldAlert, UsersRound } from "lucide-react";
import Link from "next/link";
import { getOperationalSummary, getSetupReadiness, OutboundApiError, type AttentionItem } from "@/lib/api";

export const metadata = { title: "À traiter" };
export const dynamic = "force-dynamic";

export default async function WorkspaceHomePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  let summary: Awaited<ReturnType<typeof getOperationalSummary>> | null = null;
  let readiness: Awaited<ReturnType<typeof getSetupReadiness>> | null = null;
  let loadError: string | null = null;
  try {
    [summary, readiness] = await Promise.all([getOperationalSummary(workspaceSlug), getSetupReadiness(workspaceSlug)]);
  } catch (error) {
    loadError = error instanceof OutboundApiError ? error.message : "Les données opérationnelles sont temporairement indisponibles.";
  }

  if (loadError || !summary || !readiness) {
    return <section className="panel"><div className="panel-body flex flex-col items-start gap-4"><div className="grid h-10 w-10 place-items-center rounded-full bg-red-50 text-danger"><RefreshCw size={18} /></div><div><h1 className="page-title">À traiter</h1><p className="mt-2 text-sm text-muted">{loadError ?? "Impossible de charger le workspace."}</p></div><Link className="button button-primary" href={`/w/${workspaceSlug}`}>Réessayer</Link></div></section>;
  }

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="badge badge-signal w-fit"><Activity size={13} /> Pilotage opérationnel</div>
          <h1 className="page-title mt-3">À traiter</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Les campagnes tournent en continu. Voici les exceptions, décisions et résultats qui méritent votre attention maintenant.</p>
        </div>
        <span className="badge"><Clock3 size={12} /> Mis à jour {formatDate(summary.asOf)}</span>
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <HomeMetric icon={Megaphone} label="Campagnes actives" value={summary.counts.activeCampaigns} href={`/w/${workspaceSlug}/campaigns`} />
        <HomeMetric icon={UsersRound} label="Prospects" value={summary.counts.prospects} href={`/w/${workspaceSlug}/prospects`} />
        <HomeMetric icon={Inbox} label="Conversations ouvertes" value={summary.counts.openConversations} href={`/w/${workspaceSlug}/inbox`} />
        <HomeMetric icon={Kanban} label="Opportunités" value={summary.counts.openOpportunities} href={`/w/${workspaceSlug}/pipeline`} />
        <HomeMetric icon={ShieldAlert} label="À surveiller" value={summary.counts.attention} href={`/w/${workspaceSlug}/approvals`} tone={summary.counts.attention ? "warning" : "success"} />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel overflow-hidden">
          <div className="panel-header"><div><h2 className="font-semibold">File d’attention</h2><p className="mt-1 text-xs text-muted">Les décisions autonomes restent traçables et les exceptions sont actionnables.</p></div><span className="badge">{summary.attention.length}</span></div>
          {summary.attention.length ? <div className="divide-y divide-line">{summary.attention.map((item) => <AttentionRow item={item} key={item.id} workspaceSlug={workspaceSlug} />)}</div> : <div className="panel-body py-14 text-center"><CheckCircle2 className="mx-auto text-success" size={30} /><h2 className="mt-3 font-semibold">Rien à traiter</h2><p className="mt-2 text-sm text-muted">L’automatisation surveille les campagnes et reviendra ici dès qu’une décision sera nécessaire.</p></div>}
        </section>

        <aside className="space-y-5">
          <section className="panel"><div className="panel-header"><div><h2 className="flex items-center gap-2 font-semibold"><Bot size={16} /> Automatisation</h2><p className="mt-1 text-xs text-muted">Le prochain passage est planifié automatiquement.</p></div><span className="badge badge-success">{summary.jobs.active} actif{summary.jobs.active > 1 ? "s" : ""}</span></div><div className="panel-body"><p className="text-sm font-semibold">{summary.nextAutomaticResearch ? `Prochaine recherche · ${formatDate(summary.nextAutomaticResearch)}` : "Recherche quotidienne à configurer"}</p><p className="mt-2 text-xs leading-5 text-muted">Les jobs restent durables lorsque vous changez de page. Les erreurs sont retentées selon leur policy.</p><Link className="button mt-4 w-full" href={`/w/${workspaceSlug}/settings/console`}>Voir les jobs</Link></div></section>
          <section className="panel"><div className="panel-header"><div><h2 className="font-semibold">Configuration</h2><p className="mt-1 text-xs text-muted">Un seul endroit pour connaître l’état du lancement.</p></div><span className={readiness.ready ? "badge badge-success" : "badge badge-warning"}>{readiness.ready ? "Prêt" : "À compléter"}</span></div><div className="divide-y divide-line">{readiness.items.map((item) => <Link className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50" href={item.action ? `/w/${workspaceSlug}${item.action.href}` : `/w/${workspaceSlug}/settings`} key={item.key}><span className={`grid h-7 w-7 place-items-center rounded-full ${item.state === "ready" ? "bg-emerald-50 text-success" : item.state === "optional" ? "bg-slate-100 text-muted" : "bg-amber-50 text-warning"}`}>{item.state === "ready" ? <CheckCircle2 size={14} /> : <ArrowRight size={14} />}</span><span className="min-w-0 flex-1"><strong className="block text-xs">{item.label}</strong><span className="mt-0.5 block truncate text-[11px] text-muted">{item.reason}</span></span><ArrowRight className="shrink-0 text-muted" size={13} /></Link>)}</div></section>
        </aside>
      </div>
    </>
  );
}

function AttentionRow({ item, workspaceSlug }: { item: AttentionItem; workspaceSlug: string }) {
  const href = item.resourceHref?.startsWith("/") ? `/w/${workspaceSlug}${item.resourceHref}` : `/w/${workspaceSlug}/prospects`;
  const tone = item.severity === "critical" ? "border-l-danger" : item.severity === "warning" ? "border-l-warning" : "border-l-brand-blue";
  return <div className={`flex flex-col gap-3 border-l-4 ${tone} p-4 sm:flex-row sm:items-center sm:justify-between`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={item.severity === "critical" ? "badge badge-danger" : item.severity === "warning" ? "badge badge-warning" : "badge"}>{severityLabel(item.severity)}</span><span className="text-[11px] text-muted">il y a {formatAge(item.ageSeconds)}</span></div><p className="mt-2 text-sm">{item.message}</p></div><Link className="button shrink-0" href={href}>{item.action?.label ?? "Ouvrir"}<ArrowRight size={14} /></Link></div>;
}

function HomeMetric({ icon: Icon, label, value, href, tone }: { icon: typeof Activity; label: string; value: number; href: string; tone?: "warning" | "success" }) {
  return <Link className={`panel p-4 transition hover:-translate-y-0.5 hover:shadow-md ${tone === "warning" ? "border-amber-200" : tone === "success" ? "border-emerald-200" : ""}`} href={href}><div className="flex items-center gap-2 text-xs text-muted"><Icon size={14} />{label}</div><strong className="metric-value mt-2 block">{value}</strong></Link>;
}

function severityLabel(value: AttentionItem["severity"]): string { return ({ critical: "Prioritaire", warning: "Surveillance", info: "Information" })[value]; }
function formatAge(seconds: number): string { if (seconds < 60) return "moins d’une minute"; if (seconds < 3_600) return `${Math.round(seconds / 60)} min`; if (seconds < 86_400) return `${Math.round(seconds / 3_600)} h`; return `${Math.round(seconds / 86_400)} j`; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value)); }
