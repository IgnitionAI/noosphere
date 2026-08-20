import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  Settings2,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import { NoosphereAxis } from "@/components/noosphere-axis";
import { getOperationalSummary, type AttentionItem, type EngineOperationalState, type NextOutcome } from "@/lib/api";

export const metadata = { title: "Aujourd’hui — Noosphere" };
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
      attentionLimit: 8,
    });
    const stale = Date.now() - Date.parse(summary.asOf) > 5 * 60_000;
    return (
      <>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="page-title">Aujourd’hui</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">Le système travaille. Voici ce qui mérite réellement votre attention.</p>
          </div>
          <Link className="button" href={`/w/${workspaceSlug}/settings`}><Settings2 size={14} /> Configuration</Link>
        </header>

        <NoosphereAxis lens="symbiosis" workspaceSlug={workspaceSlug} />

        {stale ? (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <Clock3 className="mt-0.5 shrink-0" size={16} />
            <p><strong>Dernier état connu.</strong> Les données n’ont pas été actualisées depuis plus de cinq minutes ; les jobs continuent en arrière-plan.</p>
          </div>
        ) : null}

        <EngineBar inbound={summary.engines.inbound} outbound={summary.engines.outbound} workspaceSlug={workspaceSlug} />

        <section aria-label="Indicateurs opérationnels" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Users} label="Prospects actifs" value={summary.counts.prospects} />
          <Metric icon={MessageSquareText} label="Conversations ouvertes" value={summary.counts.openConversations} />
          <Metric icon={CalendarCheck2} label="Appels réservés" value={summary.counts.bookedCalls} tone="signal" />
          <Metric icon={Target} label="Jobs en cours" value={summary.jobs.active} />
        </section>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
          <AttentionPanel attention={summary.attention} nextCursor={summary.attentionPagination.nextCursor} workspaceSlug={workspaceSlug} />
          <OutcomesPanel outcomes={summary.nextOutcomes} workspaceSlug={workspaceSlug} />
        </div>
      </>
    );
  } catch {
    return <TodayError workspaceSlug={workspaceSlug} />;
  }
}

function EngineBar({ inbound, outbound, workspaceSlug }: { inbound: EngineOperationalState; outbound: EngineOperationalState; workspaceSlug: string }) {
  return (
    <section aria-label="Santé des moteurs" className="grid gap-4 rounded-xl bg-navy p-4 text-white md:grid-cols-[1fr_auto_1fr] md:items-center">
      <Engine engine={inbound} href={engineHref(workspaceSlug, "inbound", inbound)} />
      <div className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-signal">Symbiose en attente d’Inbound</div>
      <Engine align="right" engine={outbound} href={engineHref(workspaceSlug, "outbound", outbound)} />
    </section>
  );
}

function Engine({ engine, href, align = "left" }: { engine: EngineOperationalState; href: string; align?: "left" | "right" }) {
  const dotClass = engine.status === "degraded" ? "bg-amber-400" : engine.status === "not_configured" ? "bg-slate-500" : "bg-signal";
  return (
    <Link className={`group flex min-w-0 items-start gap-3 ${align === "right" ? "md:flex-row-reverse md:text-right" : ""}`} href={href}>
      <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="min-w-0"><strong className="block text-sm">{engine.label}</strong><span className="mt-1 block text-xs leading-5 text-slate-300 group-hover:text-white">{engine.summary}</span></span>
    </Link>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: number; tone?: "signal" }) {
  return <article className={`panel p-4 ${tone === "signal" ? "border-lime-300" : ""}`}><div className="flex items-center justify-between text-muted"><span className="text-xs">{label}</span><Icon size={15} /></div><strong className="metric-value mt-2 block text-navy">{value}</strong></article>;
}

function AttentionPanel({ attention, nextCursor, workspaceSlug }: { attention: readonly AttentionItem[]; nextCursor: string | null; workspaceSlug: string }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="font-semibold">À traiter</h2><p className="mt-1 text-xs text-muted">Uniquement les exceptions qui bloquent ou changent le résultat.</p></div><span className={attention.length ? "badge badge-warning" : "badge badge-success"}>{attention.length ? `${attention.length} action${attention.length > 1 ? "s" : ""}` : "Rien à traiter"}</span></div>
      {attention.length ? <div className="divide-y divide-line">{attention.map((item) => <AttentionRow item={item} key={item.id} workspaceSlug={workspaceSlug} />)}</div> : (
        <div className="panel-body py-12 text-center"><CheckCircle2 className="mx-auto text-success" size={28} /><h3 className="mt-3 font-semibold">L’automatisation peut continuer seule</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted">Aucun compte, job ou échange ne demande d’intervention.</p></div>
      )}
      {nextCursor ? <div className="border-t border-line p-3 text-right"><Link className="button" href={`/w/${workspaceSlug}?attentionCursor=${encodeURIComponent(nextCursor)}`}>Voir les suivantes</Link></div> : null}
    </section>
  );
}

function AttentionRow({ item, workspaceSlug }: { item: AttentionItem; workspaceSlug: string }) {
  const href = workspaceHref(workspaceSlug, item.action?.href ?? item.resourceHref ?? "/");
  return (
    <article className="grid gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
      <AlertTriangle className={item.severity === "critical" ? "mt-0.5 text-danger" : "mt-0.5 text-warning"} size={16} />
      <div className="min-w-0"><h3 className="text-sm font-semibold">{item.message}</h3><p className="mt-1 text-xs text-muted">{ageLabel(item.ageSeconds)}{item.correlationId ? ` · Réf. ${item.correlationId.slice(0, 12)}` : ""}</p></div>
      <Link className="button h-9 justify-self-start px-3" href={href}>{item.action?.label ?? "Ouvrir"}</Link>
    </article>
  );
}

function OutcomesPanel({ outcomes, workspaceSlug }: { outcomes: readonly NextOutcome[]; workspaceSlug: string }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="font-semibold">Prochains résultats</h2><p className="mt-1 text-xs text-muted">Des événements durables, pas des promesses décoratives.</p></div><span className="badge badge-success">Système observé</span></div>
      {outcomes.length ? <div className="divide-y divide-line">{outcomes.slice(0, 5).map((outcome) => (
        <Link className="group flex items-start gap-3 p-4 transition hover:bg-slate-50" href={workspaceHref(workspaceSlug, outcome.href)} key={outcome.id}>
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal" />
          <span className="min-w-0 flex-1"><strong className="block text-sm">{outcome.label}</strong><span className="mt-1 block text-xs leading-5 text-muted">{outcome.detail}</span></span>
          <span className="shrink-0 text-xs font-semibold text-muted">{outcome.expectedAt ? formatRelative(outcome.expectedAt) : "À définir"}</span>
        </Link>
      ))}</div> : <div className="panel-body py-12 text-center"><Clock3 className="mx-auto text-muted" size={28} /><h3 className="mt-3 font-semibold">Prochain résultat en préparation</h3><p className="mt-2 text-sm text-muted">Configurez un compte ou activez une campagne pour obtenir une prochaine échéance réelle.</p></div>}
    </section>
  );
}

function TodayError({ workspaceSlug }: { workspaceSlug: string }) {
  return <section className="panel border-red-200 bg-red-50"><div className="panel-body py-12 text-center"><AlertTriangle className="mx-auto text-danger" size={30} /><h1 className="mt-4 text-lg font-semibold text-navy">Le cockpit n’a pas pu être actualisé</h1><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Les moteurs continuent en arrière-plan. Réessayez sans perdre les opérations en cours.</p><Link className="button mt-5" href={`/w/${workspaceSlug}`}>Réessayer <ArrowRight size={14} /></Link></div></section>;
}

function engineHref(workspaceSlug: string, lens: "inbound" | "outbound", engine: EngineOperationalState): string {
  if (engine.status === "not_configured") return `/w/${workspaceSlug}/settings`;
  return `/w/${workspaceSlug}/activity?lens=${lens}`;
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
