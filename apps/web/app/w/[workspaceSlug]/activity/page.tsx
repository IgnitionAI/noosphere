import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Radio, Settings2, Sparkles } from "lucide-react";
import Link from "next/link";
import { NoosphereAxis } from "@/components/noosphere-axis";
import { getActivity, type ActivityWorkspacePage, type NoosphereLens } from "@/lib/api";

export const metadata = { title: "Activité — Noosphere" };
export const dynamic = "force-dynamic";

type Query = { lens?: string; cursor?: string };

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Query>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const lens = validLens(query.lens);
  try {
    const activity = await getActivity(workspaceSlug, lens, query.cursor);
    return (
      <>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="badge badge-signal w-fit"><Radio size={13} /> Projection en lecture seule</div>
            <h1 className="page-title mt-3">{titleFor(lens)}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">{descriptionFor(lens)}</p>
          </div>
          {lens === "outbound" ? <div className="flex flex-wrap gap-2"><Link className="button" href={`/w/${workspaceSlug}/campaigns`}>Toutes les campagnes</Link><Link className="button button-primary" href={`/w/${workspaceSlug}/strategy/product-reading`}>Lancer un ICP <ArrowRight size={14} /></Link></div> : <Link className="button" href={`/w/${workspaceSlug}/settings`}><Settings2 size={14} /> Configuration</Link>}
        </header>

        <NoosphereAxis lens={lens} searchParams={{}} workspaceSlug={workspaceSlug} />

        <section className={statusClass(activity.state)}>
          <div className="flex items-start gap-3"><StatusIcon state={activity.state} /><div><strong className="block text-sm">{statusLabel(activity)}</strong><p className="mt-1 text-xs leading-5 text-inherit opacity-80">{activity.headline}</p></div></div>
          <span className="text-xs opacity-75">Mis à jour {formatTime(activity.asOf)}</span>
        </section>

        <section aria-label="Indicateurs de la lens" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {activity.counters.map((counter) => <article className="panel p-4" key={counter.key}><p className="text-xs text-muted">{counter.label}</p><strong className="metric-value mt-2 block text-navy">{counter.value}</strong></article>)}
        </section>

        <ActivityContent activity={activity} workspaceSlug={workspaceSlug} />
      </>
    );
  } catch {
    return <ActivityError lens={lens} workspaceSlug={workspaceSlug} />;
  }
}

function ActivityContent({ activity, workspaceSlug }: { activity: ActivityWorkspacePage; workspaceSlug: string }) {
  if (activity.state === "not_configured") {
    return (
      <section className="panel mt-4 py-16 text-center">
        <Sparkles className="mx-auto text-muted" size={30} />
        <h2 className="mt-4 font-semibold">{activity.lens === "inbound" ? "Inbound LinkedIn sera le prochain moteur activé" : "La Symbiose attend une première preuve Inbound"}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">{activity.lens === "inbound" ? "La stratégie, les idées sourcées, le pipeline éditorial et la publication durable seront installés sans perturber Outbound." : "Elle reliera ensuite publications, interactions, conversations et appels sans modifier l’origine campagne/hors campagne."}</p>
        <Link className="button mt-5" href={`/w/${workspaceSlug}/settings`}>Vérifier les prérequis</Link>
      </section>
    );
  }
  return (
    <section className="panel mt-4 overflow-hidden">
      <div className="panel-header"><div><h2 className="font-semibold">Flux opérationnel</h2><p className="mt-1 text-xs text-muted">Quitter cette page ne change aucun job, lease ou prochaine action.</p></div><span className="badge">{activity.items.length}</span></div>
      {activity.items.length ? <div className="divide-y divide-line">{activity.items.map((item) => (
        <Link className="grid gap-3 p-4 transition hover:bg-slate-50 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center" href={workspaceHref(workspaceSlug, item.href)} key={item.id}>
          <span className={item.status === "attention" ? "h-2.5 w-2.5 rounded-full bg-amber-500" : item.status === "running" ? "h-2.5 w-2.5 rounded-full bg-signal" : "h-2.5 w-2.5 rounded-full bg-slate-300"} />
          <span className="min-w-0"><strong className="block truncate text-sm">{item.title}</strong><span className="mt-1 block truncate text-xs text-muted">{item.detail}</span></span>
          <span className="text-xs font-semibold text-muted">{formatDate(item.occurredAt)}</span>
        </Link>
      ))}</div> : <div className="panel-body py-14 text-center"><CheckCircle2 className="mx-auto text-success" size={28} /><h2 className="mt-3 font-semibold">Aucune activité dans cette projection</h2><p className="mt-2 text-sm text-muted">Le moteur est sain et attend sa prochaine échéance.</p></div>}
      {activity.pagination.nextCursor ? <footer className="border-t border-line p-3 text-right"><Link className="button" href={`/w/${workspaceSlug}/activity?lens=${activity.lens}&cursor=${encodeURIComponent(activity.pagination.nextCursor)}`}>Afficher la suite</Link></footer> : null}
    </section>
  );
}

function ActivityError({ lens, workspaceSlug }: { lens: NoosphereLens; workspaceSlug: string }) {
  return <section className="panel border-red-200 bg-red-50"><div className="panel-body py-14 text-center"><AlertTriangle className="mx-auto text-danger" size={30} /><h1 className="mt-4 text-lg font-semibold">Impossible de charger cette activité</h1><p className="mx-auto mt-2 max-w-lg text-sm text-muted">Les opérations en cours continuent. La lens ne pilote aucune mutation.</p><Link className="button mt-5" href={`/w/${workspaceSlug}/activity?lens=${lens}`}>Réessayer</Link></div></section>;
}

function StatusIcon({ state }: { state: ActivityWorkspacePage["state"] }) {
  if (state === "attention") return <AlertTriangle className="mt-0.5 shrink-0" size={16} />;
  if (state === "active") return <Radio className="mt-0.5 shrink-0" size={16} />;
  return <Clock3 className="mt-0.5 shrink-0" size={16} />;
}

function statusClass(state: ActivityWorkspacePage["state"]): string {
  if (state === "attention") return "flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between";
  if (state === "not_configured") return "flex flex-col gap-3 rounded-xl border border-line bg-white p-4 text-navy sm:flex-row sm:items-center sm:justify-between";
  return "flex flex-col gap-3 rounded-xl bg-navy p-4 text-white sm:flex-row sm:items-center sm:justify-between";
}

function statusLabel(activity: ActivityWorkspacePage): string {
  if (activity.state === "not_configured") return "Moteur non configuré";
  if (activity.state === "attention") return "Une exception est localisée";
  if (activity.state === "active") return "Moteur actif";
  return "Moteur en veille";
}

function validLens(value?: string): NoosphereLens {
  return value === "inbound" || value === "outbound" ? value : "symbiosis";
}

function titleFor(lens: NoosphereLens): string {
  if (lens === "inbound") return "Créer la demande";
  if (lens === "outbound") return "Capter la demande";
  return "Relier contenu et revenu";
}

function descriptionFor(lens: NoosphereLens): string {
  if (lens === "inbound") return "De l’idée sourcée à la conversation, sans contenu générique.";
  if (lens === "outbound") return "Des ICP aux appels, avec chaque campagne et chaque job observables.";
  return "Des signaux sociaux prouvés aux conversations et appels attribués.";
}

function workspaceHref(workspaceSlug: string, href: string): string {
  if (href.startsWith("/w/")) return href;
  return `/w/${workspaceSlug}${href.startsWith("/") ? href : `/${href}`}`;
}

function formatTime(value: string): string { return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value)); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value)); }
