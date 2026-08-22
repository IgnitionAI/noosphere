import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  Radio,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { getOperationalSummary, type AttentionItem, type NextOutcome } from "@/lib/api";

export const metadata = { title: "Accueil — Noosphere" };
export const dynamic = "force-dynamic";

export default async function TodayPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ attentionCursor?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  try {
    const summary = await getOperationalSummary(workspaceSlug, {
      ...(query.attentionCursor ? { attentionCursor: query.attentionCursor } : {}),
      attentionLimit: 6,
    });
    const stale = Date.now() - Date.parse(summary.asOf) > 5 * 60_000;
    const hasStarted = summary.counts.activeCampaigns > 0
      || summary.counts.prospects > 0
      || summary.counts.publishedContents > 0
      || summary.counts.openConversations > 0
      || summary.counts.bookedCalls > 0
      || summary.engines.inbound.status !== "not_configured";
    const working = summary.jobs.active > 0
      || summary.engines.inbound.status === "running"
      || summary.engines.outbound.status === "running";

    return (
      <>
        <header className="overflow-hidden rounded-2xl bg-navy text-white">
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-signal">
                <Sparkles size={14} /> Mode équilibré
              </span>
              <h1 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">Votre acquisition, en pilote automatique.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">Noosphere crée votre visibilité, trouve les bons prospects, lance les échanges et remplit votre agenda.</p>
              <Link className="button button-signal mt-6" href={hasStarted ? `/w/${workspaceSlug}/inbox` : `/w/${workspaceSlug}/strategy/product-reading`}>
                {hasStarted ? "Voir les messages" : "Lancer Noosphere"}<ArrowRight size={15} />
              </Link>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${summary.counts.attention ? "bg-amber-400" : "bg-signal"}`} />{hasStarted ? (working ? "Noosphere travaille" : "Noosphere est prêt") : "Prêt à démarrer"}</div>
              <p className="mt-2 text-xs leading-5 text-slate-300">{statusCopy({ hasStarted, working, attention: summary.counts.attention })}</p>
            </div>
          </div>
        </header>

        {stale ? (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <Clock3 className="mt-0.5 shrink-0" size={16} />
            <p><strong>Dernier état connu.</strong> Noosphere continue en arrière-plan et actualisera ces résultats automatiquement.</p>
          </div>
        ) : null}

        <section aria-label="Résultats de Noosphere" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric description="créés par Noosphere" icon={Radio} label="Contenus publiés" value={summary.counts.publishedContents} />
          <Metric description={`${summary.counts.contactedProspects} déjà contactés`} icon={Users} label="Prospects trouvés" value={summary.counts.prospects} />
          <Metric description="à poursuivre maintenant" icon={MessageSquareText} label="Conversations" value={summary.counts.openConversations} />
          <Metric description="confirmés dans l’agenda" icon={CalendarCheck2} label="Appels" tone="signal" value={summary.counts.bookedCalls} />
        </section>

        {summary.attention.length ? (
          <AttentionPanel attention={summary.attention} nextCursor={summary.attentionPagination.nextCursor} workspaceSlug={workspaceSlug} />
        ) : (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 shrink-0" size={16} />
            <p><strong>Rien à faire.</strong> Noosphere peut continuer seul.</p>
          </div>
        )}

        <OutcomesPanel outcomes={summary.nextOutcomes} workspaceSlug={workspaceSlug} />
      </>
    );
  } catch {
    return <TodayError workspaceSlug={workspaceSlug} />;
  }
}

function Metric({ icon: Icon, label, value, description, tone }: { icon: typeof Users; label: string; value: number; description: string; tone?: "signal" }) {
  return <article className={`panel p-4 ${tone === "signal" ? "border-lime-300" : ""}`}><div className="flex items-center justify-between text-muted"><span className="text-xs font-semibold">{label}</span><Icon size={15} /></div><strong className="metric-value mt-3 block text-navy">{value}</strong><p className="mt-1 text-xs text-muted">{description}</p></article>;
}

function AttentionPanel({ attention, nextCursor, workspaceSlug }: { attention: readonly AttentionItem[]; nextCursor: string | null; workspaceSlug: string }) {
  return (
    <section className="panel mt-4 overflow-hidden">
      <div className="panel-header"><div><h2 className="font-semibold">Votre attention est nécessaire</h2><p className="mt-1 text-xs text-muted">Seulement ce qui empêche Noosphere de continuer seul.</p></div><span className="badge badge-warning">{attention.length} action{attention.length > 1 ? "s" : ""}</span></div>
      <div className="divide-y divide-line">{attention.map((item) => <AttentionRow item={item} key={item.id} workspaceSlug={workspaceSlug} />)}</div>
      {nextCursor ? <div className="border-t border-line p-3 text-right"><Link className="button" href={`/w/${workspaceSlug}?attentionCursor=${encodeURIComponent(nextCursor)}`}>Voir les suivantes</Link></div> : null}
    </section>
  );
}

function AttentionRow({ item, workspaceSlug }: { item: AttentionItem; workspaceSlug: string }) {
  const href = workspaceHref(workspaceSlug, item.action?.href ?? item.resourceHref ?? "/");
  return (
    <article className="grid gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <AlertTriangle className={item.severity === "critical" ? "text-danger" : "text-warning"} size={16} />
      <div className="min-w-0"><h3 className="text-sm font-semibold">{attentionCopy(item)}</h3><p className="mt-1 text-xs text-muted">{ageLabel(item.ageSeconds)}</p></div>
      <Link className="button h-9 justify-self-start px-3" href={href}>{item.action?.label ?? "Corriger"}</Link>
    </article>
  );
}

function OutcomesPanel({ outcomes, workspaceSlug }: { outcomes: readonly NextOutcome[]; workspaceSlug: string }) {
  return (
    <section className="panel mt-4 overflow-hidden">
      <div className="panel-header"><div><h2 className="font-semibold">Ensuite</h2><p className="mt-1 text-xs text-muted">Noosphere enchaîne ces actions automatiquement.</p></div></div>
      {outcomes.length ? <div className="divide-y divide-line">{outcomes.slice(0, 4).map((outcome) => (
        <Link className="group flex items-center gap-3 p-4 transition hover:bg-slate-50" href={workspaceHref(workspaceSlug, outcome.href)} key={outcome.id}>
          <span className="h-2 w-2 shrink-0 rounded-full bg-signal" />
          <strong className="min-w-0 flex-1 truncate text-sm">{outcome.label}</strong>
          <span className="shrink-0 text-xs font-semibold text-muted">{outcome.expectedAt ? formatRelative(outcome.expectedAt) : "Automatique"}</span>
        </Link>
      ))}</div> : <div className="panel-body py-10 text-center"><Clock3 className="mx-auto text-muted" size={24} /><h3 className="mt-3 font-semibold">La prochaine action se prépare</h3><p className="mt-2 text-sm text-muted">Elle apparaîtra ici dès qu’elle sera planifiée.</p></div>}
    </section>
  );
}

function TodayError({ workspaceSlug }: { workspaceSlug: string }) {
  return <section className="panel border-red-200 bg-red-50"><div className="panel-body py-12 text-center"><AlertTriangle className="mx-auto text-danger" size={30} /><h1 className="mt-4 text-lg font-semibold text-navy">Les résultats ne sont pas disponibles</h1><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Noosphere continue en arrière-plan. Rechargez cette page sans perdre les opérations en cours.</p><Link className="button mt-5" href={`/w/${workspaceSlug}`}>Réessayer <ArrowRight size={14} /></Link></div></section>;
}

function statusCopy({ hasStarted, working, attention }: { hasStarted: boolean; working: boolean; attention: number }): string {
  if (!hasStarted) return "Ajoutez votre offre : Noosphere s’occupe ensuite de la stratégie, des campagnes et des contenus.";
  if (attention) return `${attention} blocage${attention > 1 ? "s" : ""} isolé${attention > 1 ? "s" : ""}. Le reste continue normalement.`;
  if (working) return "Recherche, contenu, prospection ou échanges en cours. Vous n’avez rien à piloter.";
  return "La prochaine action automatique sera lancée au bon moment.";
}

function attentionCopy(item: AttentionItem): string {
  if (item.type === "job") return item.message;
  if (item.type === "decision") return "Une conversation demande votre réponse.";
  return item.message;
}

function workspaceHref(workspaceSlug: string, href: string): string {
  if (href.startsWith("/w/")) return href;
  return `/w/${workspaceSlug}${href.startsWith("/") ? href : `/${href}`}`;
}

function ageLabel(seconds: number): string {
  if (seconds < 60) return "À l’instant";
  if (seconds < 3_600) return `Il y a ${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86_400) return `Il y a ${Math.round(seconds / 3_600)} h`;
  return `Il y a ${Math.round(seconds / 86_400)} j`;
}

function formatRelative(value: string): string {
  const delta = Date.parse(value) - Date.now();
  if (delta <= 0) return "Maintenant";
  const hours = Math.round(delta / 3_600_000);
  if (hours < 24) return `Dans ${Math.max(1, hours)} h`;
  return `Dans ${Math.round(hours / 24)} j`;
}
